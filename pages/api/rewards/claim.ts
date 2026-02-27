import type { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import type { Transaction } from 'algosdk';

import { authOptions } from '../auth/[...nextauth]';
import clientPromise from '../../../lib/mongoclient';
import rewardsClientPromise from '../../../lib/rewardsMongoClient';
import type { Device } from '../../../lib/types';
import { getAssetDecimals, fNODE, tFRY, getRewardsVaultAddress } from '../../../lib/utils';
import { loggers } from '../../../lib/logger';
import { verifyClientToken } from '../../../lib/clientTokenMiddleware';
import { verifyRequestSignatureAsync } from '../../../lib/requestSignature.server';
import { isAdminRequest } from '../../../lib/adminCheck';
import { verifyDeviceFingerprintMiddleware } from '../../../lib/deviceFingerprint';
import { withDeviceActionLock } from '../../../lib/api/deviceAction';
import { createApiError, ErrorCodes } from '../../../lib/api-errors';
// Modern wallet infrastructure imports for consistent network handling
import { getAlgodClient } from '../../../lib/wallet/clients';
import { buildAssetTransferTxn } from '../../../lib/wallet/transactions';
import {
  decodeUnsignedTransaction,
  loadMnemonicAccountPair,
  signAndSubmitCustodialTransactions
} from '../../../lib/algorand/admin';
import { monitorWalletHealth } from '../../../lib/monitoring/walletHealth';
import { monitorTransaction } from '../../../lib/monitoring/transactionMonitor';
import { ensureWalletAssetOptIn } from '../../../lib/algorand/optIn';
import {
  getDailyRewardDate,
  getWeeklyRewardDate,
  isBeforeRewardsCutoff,
  isOnOrAfterRewardsCutoff,
  resolveRewardsCollectionName,
  RewardsDbSource
} from '../../../lib/rewardsDb';
import { withRetry } from '../../../lib/algorand/withRetry';

const testMode = process.env.NEXT_PUBLIC_TEST_MODE === 'true';

const NODE_PREFIXES = new Set(['RDN', 'SVN', 'SDN', 'CN']);
const AEM_PREFIX = 'AEM';

type DeviceClaimTarget = {
  source: 'weekly' | 'daily';
  reward_number: number;
  asset_id: string;
  amount: number;
  // Track origin DB so updates are routed correctly.
  reward_db: RewardsDbSource;
  reward_id?: string;
  reward_date?: Date | null;
};

// Define proper types for the claim response variants
type ClaimPreviewResponse = {
  success: boolean;
  preview: true;
  totals: { asset_id: number; amount: number; }[];
};

type ClaimExecuteResponse = {
  success: boolean;
  preview: false;
  message: string;
  txId: string;
  totals: { asset_id: number; amount: number; }[];
};

type ClaimResponse = ClaimPreviewResponse | ClaimExecuteResponse;

const PRECISION_DECIMALS = 6;
const DISPLAY_DECIMALS = 2;

const toError = (err: unknown): Error => {
  if (err instanceof Error) return err;
  try {
    return new Error(JSON.stringify(err));
  } catch {
    return new Error(String(err));
  }
};

const roundAmount = (value: number, decimals = PRECISION_DECIMALS) =>
  Math.round(value * 10 ** decimals) / 10 ** decimals;

const quantizeForStorage = (value: number) => roundAmount(value, DISPLAY_DECIMALS);

const parseCurrencyValue = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (typeof value === 'bigint') {
    return Number(value);
  }
  return 0;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions);
  if (session?.user?.address) {
    (req as NextApiRequest & { _sessionWalletAddress?: string })._sessionWalletAddress =
      session.user.address;
  }

  // Preserve the admin bypass + client token + request signature layers we had previously.
  const isAdmin = await isAdminRequest(req);

  if (!isAdmin) {
    const tokenVerified = await verifyClientToken(req, res);
    if (!tokenVerified) return;

    const signature = req.headers['x-request-signature'] as string;
    const timestamp = Number(req.headers['x-request-timestamp']);

    if (!signature || Number.isNaN(timestamp)) {
      res.status(403).json(
        createApiError('MISSING_SIGNATURE', 'Request signature or timestamp missing')
      );
      return;
    }

    const signatureValid = await verifyRequestSignatureAsync(
      'POST',
      '/api/rewards/claim',
      req.body,
      timestamp,
      signature,
      req
    );

    if (!signatureValid) {
      res.status(403).json(
        createApiError('INVALID_SIGNATURE', 'Invalid or expired request signature')
      );
      return;
    }
  }

  if (!session || !session.user) {
    res.status(401).json(createApiError(ErrorCodes.UNAUTHORIZED, 'Unauthorized'));
    return;
  }

  // Input validation mirrors the legacy handler (miner key required, optional reward number).
  const { miner_key, no, preview, reward_db, reward_id } = req.body ?? {};
  // Normalize optional reward routing hints to avoid ambiguous claims.
  const normalizedRewardDb = reward_db === 'main' || reward_db === 'dbrewards' ? reward_db : undefined;
  if (reward_db && !normalizedRewardDb) {
    res.status(400).json(
      createApiError(ErrorCodes.INVALID_INPUT, 'Invalid reward database selection')
    );
    return;
  }
  if (typeof miner_key !== 'string' || miner_key.length === 0) {
    res.status(400).json(
      createApiError(ErrorCodes.INVALID_INPUT, 'Missing miner key for claim request')
    );
    return;
  }

  const fingerprintStatus = await verifyDeviceFingerprintMiddleware(req, session, isAdmin, {
    walletAddress: session.user.address,
    minerKey: miner_key
  });

  if (fingerprintStatus === 'retry') {
    res.status(409).json(
      createApiError('DEVICE_FINGERPRINT_REFRESH', 'Security check refreshed your session. Please retry the request.')
    );
    return;
  }

  if (fingerprintStatus === 'blocked') {
    res.status(403).json(
      createApiError('DEVICE_MISMATCH', 'Request from unauthorized device. This operation requires the original browser.')
    );
    return;
  }

  if (!isAdmin) {
    void monitorWalletHealth(session.user.address, { minerKey: miner_key, operation: 'claim' });
  }

  // Acquire a durable lock/idempotency record before touching database state.
  await withDeviceActionLock<ClaimResponse>(req, res, {
    action: 'claim',
    miner_key,
    address: session.user.address,
    metadata: {
      preview: preview === true,
      rewardSelection: typeof no === 'number' ? 'single' : 'all'
    }
  }, async () => {
    try {
      // Load the same device + rewards data the previous handler inspected.
      const client = await clientPromise;
      const db = client.db('main');
      // Rewards are split post-cutoff; load both collections for routing.
      const rewardsClient = await rewardsClientPromise;
      const rewardsDb = rewardsClient.db('dbrewards');
      const mainRewardsCollection = db.collection(resolveRewardsCollectionName('main', testMode));
      const newRewardsCollection = rewardsDb.collection(resolveRewardsCollectionName('dbrewards', testMode));
      const deviceCollection = db.collection<Device>(testMode ? 'test-devices' : 'devices');
      const device = await deviceCollection.findOne({ miner_key });
      if (!device) {
        throw {
          status: 404,
          response: createApiError(ErrorCodes.DEVICE_NOT_FOUND, 'Device not found', 'Verify the miner key and try again.')
        };
      }

      if (!device.reward_wallet) {
        throw {
          status: 400,
          response: createApiError(ErrorCodes.INVALID_INPUT, 'No reward wallet configured for this device.')
        };
      }

      if (device.address !== session.user.address) {
        throw {
          status: 401,
          response: createApiError(ErrorCodes.WALLET_MISMATCH, 'Wallet mismatch detected. Sign in with the owning wallet to claim rewards.')
        };
      }

      const [mainRewardsDoc, newRewardsDoc] = await Promise.all([
        mainRewardsCollection.findOne({ miner_key }),
        newRewardsCollection.findOne({ miner_key })
      ]);
      const algodClient = getAlgodClient();
      const rewardsVaultAddress = getRewardsVaultAddress();
      const rewardDocs: Array<{ source: RewardsDbSource; doc: any | null }> = [
        { source: 'main', doc: mainRewardsDoc },
        { source: 'dbrewards', doc: newRewardsDoc }
      ];
      const weeklyClaimables = rewardDocs.flatMap(({ source, doc }) =>
        (doc?.weekly_rewards || [])
          .filter((r: any) => {
            const rewardDate = getWeeklyRewardDate(r);
            if (!r?.unlock_at || !rewardDate) return false;
            const inRange = source === 'main'
              ? isBeforeRewardsCutoff(rewardDate)
              : isOnOrAfterRewardsCutoff(rewardDate);
            return r.status === 'claimable' && inRange;
          })
          .map((r: any) => ({
            ...r,
            reward_db: source,
            reward_id: r?._id ? String(r._id) : undefined,
            reward_date: getWeeklyRewardDate(r)
          }))
      );
      const dailyClaimables = rewardDocs.flatMap(({ source, doc }) =>
        (doc?.daily_rewards || [])
          .filter((r: any) => {
            const rewardDate = getDailyRewardDate(r);
            const inRange = source === 'main'
              ? isBeforeRewardsCutoff(rewardDate)
              : isOnOrAfterRewardsCutoff(rewardDate);
            return r.status === 'claimable' && inRange;
          })
          .map((r: any) => ({
            ...r,
            reward_db: source,
            reward_id: r?._id ? String(r._id) : undefined,
            reward_date: getDailyRewardDate(r)
          }))
      );

      const records: DeviceClaimTarget[] = [];
      // Filter helpers to avoid ambiguous reward_number collisions across databases.
      const matchesSelection = (reward: any): boolean => {
        if (typeof no === 'number' && reward.reward_number !== no) return false;
        if (reward_id && String(reward.reward_id) !== String(reward_id)) return false;
        if (normalizedRewardDb && reward.reward_db !== normalizedRewardDb) return false;
        return true;
      };

      if (typeof no === 'number' || reward_id) {
        const weeklyTargets = weeklyClaimables.filter(matchesSelection);
        const dailyTargets = dailyClaimables.filter(matchesSelection);
        if (!weeklyTargets.length && !dailyTargets.length) {
          throw {
            status: 404,
            response: createApiError(ErrorCodes.NO_REWARDS, 'No rewards available to claim.', 'Wait for new rewards to unlock and try again or refresh the page if you believe this is not right.')
          };
        }
        if (!normalizedRewardDb && typeof no === 'number') {
          const sources = new Set<string>([
            ...weeklyTargets.map((r: any) => r.reward_db),
            ...dailyTargets.map((r: any) => r.reward_db)
          ]);
          if (sources.size > 1) {
            throw {
              status: 409,
              response: createApiError(
                ErrorCodes.INVALID_INPUT,
                'Ambiguous reward number across reward databases',
                'Refresh the page and retry the claim for this specific reward.'
              )
            };
          }
        }
        weeklyTargets.forEach((wr: any) =>
          records.push({
            source: 'weekly',
            reward_number: wr.reward_number,
            asset_id: wr.asset_id,
            amount: wr.amount,
            reward_db: wr.reward_db as RewardsDbSource,
            reward_id: wr.reward_id,
            reward_date: wr.reward_date
          })
        );
        dailyTargets.forEach((dr: any) =>
          records.push({
            source: 'daily',
            reward_number: dr.reward_number,
            asset_id: dr.asset_id,
            amount: dr.amount,
            reward_db: dr.reward_db as RewardsDbSource,
            reward_id: dr.reward_id,
            reward_date: dr.reward_date
          })
        );
      } else {
        if (!weeklyClaimables.length && !dailyClaimables.length) {
          throw {
            status: 404,
            response: createApiError(ErrorCodes.NO_REWARDS, 'No rewards available to claim.', 'Wait for new rewards to unlock and try again or refresh the page if you believe this is not right.')
          };
        }
        weeklyClaimables.forEach((wr: any) =>
          records.push({
            source: 'weekly',
            reward_number: wr.reward_number,
            asset_id: wr.asset_id,
            amount: wr.amount,
            reward_db: wr.reward_db as RewardsDbSource,
            reward_id: wr.reward_id,
            reward_date: wr.reward_date
          })
        );
        dailyClaimables.forEach((dr: any) =>
          records.push({
            source: 'daily',
            reward_number: dr.reward_number,
            asset_id: dr.asset_id,
            amount: dr.amount,
            reward_db: dr.reward_db as RewardsDbSource,
            reward_id: dr.reward_id,
            reward_date: dr.reward_date
          })
        );
      }

      const decimalsCache = new Map<number, number>();
      const totals = new Map<number, bigint>();

      for (const reward of records) {
        const assetId = Number(reward.asset_id);
        let decimals = decimalsCache.get(assetId);
        if (decimals === undefined) {
          const fetched = await getAssetDecimals(assetId);
          decimals = typeof fetched === 'number' ? fetched : 0;
          decimalsCache.set(assetId, decimals);
        }
        const microAmount = BigInt(
          Math.round(reward.amount * Math.pow(10, decimals))
        );
        const previous = totals.get(assetId) ?? BigInt(0);
        totals.set(assetId, previous + microAmount);
      }

      const summary = Array.from(totals.entries()).map(([asset_id, totalMicro]) => ({
        asset_id,
        totalMicro,
        decimals: decimalsCache.get(asset_id) ?? 0
      }));

      // Ensure the custodial rewards vault has enough liquidity for each asset
      for (const entry of summary) {
        try {
          const holding = await withRetry(
            () => algodClient
            .accountAssetInformation(rewardsVaultAddress, entry.asset_id)
            .do(),
            { maxAttempts: 3 }
          )
            .catch((error: any) => {
              const statusCode = error?.response?.status ?? error?.status;
              if (statusCode === 404) {
                return null;
              }
              throw error;
            });
          const availableMicro = holding
            ? BigInt(
                (holding['asset-holding']?.amount ??
                  holding.assetHolding?.amount ??
                  0) as number | string | bigint
              )
            : BigInt(0);

          if (availableMicro < entry.totalMicro) {
            throw {
              status: 503,
              response: createApiError(
                ErrorCodes.REWARD_VAULT_DEPLETED,
                'Rewards vault needs to be refilled for this asset.',
                'Admins have already been alerted. Please try again shortly.',
                {
                  assetId: entry.asset_id,
                  availableMicro: availableMicro.toString(),
                  requiredMicro: entry.totalMicro.toString()
                }
              )
            };
          }
        } catch (error) {
          if ((error as { status?: number })?.status === 503) {
            throw error;
          }
          loggers.apiError('/api/rewards/claim', error as Error, {
            minerKey: miner_key,
            issueType: 'REWARD_VAULT_CHECK_FAILED',
            part: 'vault-liquidity',
            assetId: entry.asset_id
          });
          throw {
            status: 500,
            response: createApiError(
              ErrorCodes.INTERNAL_ERROR,
              'Unable to verify rewards vault balance. Please try again shortly.'
            )
          };
        }
      }

      // Guard: ensure the configured reward wallet is opted into each reward asset before we send funds.
      const rewardWallet = device.reward_wallet;
      if (!rewardWallet) {
        throw {
          status: 400,
          response: createApiError(
            ErrorCodes.INVALID_INPUT,
            'This device does not have a reward wallet configured.',
            'Update the device reward wallet and try again.'
          )
        };
      }
      for (const assetId of summary.map((entry) => String(entry.asset_id))) {
        await ensureWalletAssetOptIn(rewardWallet, assetId, 'claiming rewards');
      }

      const minerPrefix = device.miner_key.split('-')[0];
      const isNodeDevice = NODE_PREFIXES.has(minerPrefix);
      const isAemDevice = minerPrefix === AEM_PREFIX;
      // Pre-compute totals for preview (and to store alongside journal records).
      const totalsDisplay = summary.map((entry) => ({
        asset_id: entry.asset_id,
        amount: quantizeForStorage(Number(entry.totalMicro) / Math.pow(10, entry.decimals))
      }));

      const totalAmountNumeric = quantizeForStorage(
        totalsDisplay.reduce((acc, curr) => acc + curr.amount, 0)
      );

      // Preview path still returns without touching Algorand or Mongo writes.
      if (preview === true) {
        return {
          response: {
            success: true,
            preview: true,
            totals: totalsDisplay
          } as ClaimPreviewResponse,
          journal: {
            status: 'pending' as const,
            metadata: { totals: totalsDisplay, mode: 'preview' }
          }
        };
      }

      // Modern reward broadcast using centralized wallet infrastructure
      // Use the custodial helper to load the reward vault + signer (respects rekey).
      const { account } = loadMnemonicAccountPair({
        mnemonicEnv: 'REWARD_MNEMONIC',
        rekeyEnv: 'REWARD_REKEY',
        label: 'reward sender'
      });

      const unsignedTxns: Transaction[] = [];

      // Build individual ASA transfer transactions for each reward asset with modern transaction builder
      for (const entry of summary) {
        const noteInfo = {
          miner_key: `${miner_key.split('-')[0]}-${miner_key.split('-')[1].slice(0, 6)}`,
          asset_id: entry.asset_id,
          amount: Number(entry.totalMicro) / Math.pow(10, entry.decimals),
          operation: 'reward_claim',
          timestamp: new Date().toISOString()
        };
        const note = new TextEncoder().encode(JSON.stringify(noteInfo));

        if (!testMode) {
          const safeMax = BigInt(Number.MAX_SAFE_INTEGER);
          if (entry.totalMicro > safeMax) {
            throw new Error('Aggregated reward amount exceeds Number.MAX_SAFE_INTEGER');
          }
        }

        // Use modern transaction builder for consistent handling - note: amount is already in microunits
        const encodedTxn = await buildAssetTransferTxn({
          sender: account.addr.toString(),
          receiver: device.reward_wallet,
          assetId: entry.asset_id,
          amount: testMode ? 0 : Number(entry.totalMicro),
          note,
          useRawAmount: true, // Amount is already in microunits, don't apply decimal conversion
          decimals: entry.decimals // Pass decimals for validation but useRawAmount=true skips conversion
        });

        unsignedTxns.push(decodeUnsignedTransaction(encodedTxn));
      }

      // Broadcast all reward transfers via the centralized custodial pipeline.
      const { txId } = await signAndSubmitCustodialTransactions({
        mnemonicEnv: 'REWARD_MNEMONIC',
        rekeyEnv: 'REWARD_REKEY',
        label: 'reward claim',
        algod: algodClient,
        transactions: unsignedTxns
      });
      if (!txId) {
        throw new Error('Reward transfer could not be submitted to Algorand.');
      }

      // Group updates per database so totals and statuses remain consistent.
      const totalsBySource = records.reduce((acc, record) => {
        const prev = acc.get(record.reward_db) ?? 0;
        acc.set(record.reward_db, quantizeForStorage(prev + record.amount));
        return acc;
      }, new Map<RewardsDbSource, number>());
      monitorTransaction(txId, {
        minerKey: miner_key,
        walletAddress: session.user.address,
        operation: 'reward_claim',
        amount: totalAmountNumeric,
        preconfirmed: true
      }).catch((error) => {
        console.warn('[claim] monitorTransaction failed', error);
      });

      let modifiedAny = false;
      const sourceContexts: Array<{ source: RewardsDbSource; collection: any; doc: any | null }> = [
        { source: 'main', collection: mainRewardsCollection, doc: mainRewardsDoc },
        { source: 'dbrewards', collection: newRewardsCollection, doc: newRewardsDoc }
      ];
      for (const ctx of sourceContexts) {
        const delta = totalsBySource.get(ctx.source) ?? 0;
        if (!delta) continue;
        if (!ctx.doc) {
          throw {
            status: 409,
            response: createApiError(
              ErrorCodes.INTERNAL_ERROR,
              'Reward document missing for claim routing',
              'Please refresh and retry your claim.'
            )
          };
        }
        const weeklyNos = records
          .filter((r) => r.source === 'weekly' && r.reward_db === ctx.source)
          .map((r) => r.reward_number);
        const dailyNos = records
          .filter((r) => r.source === 'daily' && r.reward_db === ctx.source)
          .map((r) => r.reward_number);

        if (weeklyNos.length > 0) {
          const updateWeekly = await ctx.collection.updateOne(
            { miner_key },
            {
              $set: {
                'weekly_rewards.$[elem].status': 'claimed',
                'weekly_rewards.$[elem].tx_id': txId,
                'weekly_rewards.$[elem].claimed_at': new Date()
              }
            },
            { arrayFilters: [{ 'elem.reward_number': { $in: weeklyNos }, 'elem.status': 'claimable' }] }
          );
          if (updateWeekly.modifiedCount) modifiedAny = true;
        }

        if (dailyNos.length > 0) {
          const updateDaily = await ctx.collection.updateOne(
            { miner_key },
            {
              $set: {
                'daily_rewards.$[elem].status': 'claimed',
                'daily_rewards.$[elem].tx_id': txId,
                'daily_rewards.$[elem].claimed_at': new Date()
              }
            },
            { arrayFilters: [{ 'elem.reward_number': { $in: dailyNos }, 'elem.status': 'claimable' }] }
          );
          if (updateDaily.modifiedCount) modifiedAny = true;
        }

        const currentClaimable = quantizeForStorage(parseCurrencyValue(ctx.doc?.total_claimable));
        const currentClaimed = quantizeForStorage(parseCurrencyValue(ctx.doc?.total_claimed));
        const nextClaimable = Math.max(0, quantizeForStorage(currentClaimable - delta));
        const nextClaimed = quantizeForStorage(currentClaimed + delta);

        await ctx.collection.updateOne(
          { miner_key },
          {
            $set: {
              total_claimable: nextClaimable,
              total_claimed: nextClaimed
            }
          }
        );
      }

      if (!modifiedAny) {
        throw {
          status: 409,
          response: createApiError(
            'ALREADY_TRANSITIONED',
            'Selected rewards are no longer claimable. Refresh to view the current status.'
          )
        };
      }

      return {
        response: {
          success: true,
          preview: false,
          message: `Claim submitted for ${miner_key}`,
          txId,
          totals: totalsDisplay
        } as ClaimExecuteResponse,
        journal: {
          status: 'confirmed' as const,
          txId,
          metadata: {
            totals: totalsDisplay,
            rewardCount: records.length,
            totalAmount: totalAmountNumeric
          }
        }
      };
    } catch (error) {
      // Ensure operational logging remains intact for support investigations.
      loggers.apiError('/api/rewards/claim', toError(error), {
        miner_key,
        address: session.user.address,
        issueType: 'REWARD_CLAIM_ERROR',
        metadata: {
          preview: preview === true,
          rewardSelection: typeof no === 'number' ? 'single' : 'all'
        }
      });
      throw error;
    }
  });
}
