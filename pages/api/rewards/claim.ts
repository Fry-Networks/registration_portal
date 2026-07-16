import type { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import type { Transaction } from 'algosdk';

import { authOptions } from '../auth/[...nextauth]';
import clientPromise from '../../../lib/mongoclient';
import type { Device } from '../../../lib/types';
import { getAssetDecimals, fNODE, tFRY, getRewardsVaultAddress } from '../../../lib/utils';
import { loggers } from '../../../lib/logger';
import { verifyClientToken } from '../../../lib/clientTokenMiddleware';
import { verifyRequestSignatureAsync } from '../../../lib/requestSignature.server';
import { isAdminRequest } from '../../../lib/adminCheck';
import { verifyDeviceFingerprintMiddleware } from '../../../lib/deviceFingerprint';
import { withDeviceActionLock } from '../../../lib/api/deviceAction';
import { createApiError, ErrorCodes } from '../../../lib/api-errors';
import { effectiveAmount, isHeld } from '../../../lib/rewards/effective';
import { loadEvidence, hasEvidenceInWindow } from '../../../lib/rewards/pocEvidence';
// Modern wallet infrastructure imports for consistent network handling
import { getAlgodClient } from '../../../lib/wallet/clients';
import { buildAssetTransferTxn } from '../../../lib/wallet/transactions';
import {
  decodeUnsignedTransaction,
  loadMnemonicAccountPair,
  signAndSubmitCustodialTransactions,
  buildUserPaysClaimGroup
} from '../../../lib/algorand/admin';
import { monitorWalletHealth } from '../../../lib/monitoring/walletHealth';
import { monitorTransaction } from '../../../lib/monitoring/transactionMonitor';
import { ensureWalletAssetOptIn } from '../../../lib/algorand/optIn';
import { withRetry } from '../../../lib/algorand/withRetry';

const testMode = process.env.NEXT_PUBLIC_TEST_MODE === 'true';

const NODE_PREFIXES = new Set(['RDN', 'SVN', 'SDN', 'CN']);
const AEM_PREFIX = 'AEM';
const FEM_PREFIX = 'FEM';

type DeviceClaimTarget = {
  source: 'weekly' | 'daily';
  reward_number: number;
  asset_id: string;
  amount: number;
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
  const { miner_key, no, preview } = req.body ?? {};
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
      const rewardsCollection = db.collection('device-rewards');
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

      const rewardsDoc = await rewardsCollection.findOne({ miner_key });
      const algodClient = getAlgodClient();
      const rewardsVaultAddress = getRewardsVaultAddress();
      let weeklyClaimables = (rewardsDoc?.weekly_rewards || []).filter((r: any) => r.status === 'claimable' && !isHeld(r));
      let dailyClaimables = (rewardsDoc?.daily_rewards || []).filter((r: any) => r.status === 'claimable' && !isHeld(r));
      // A-gate (forward PoC guard): rows WITH corrected_by (f3y/f3z) are already evidence-verdicted → trust.
      // Rows WITHOUT corrected_by (new post-F3-z) must have live PoC evidence in their epoch window, else held.
      // Virtual-mining product: activated virtual devices have no hardware → PoC-exempt by design (dbRewards reward.ts:1594).
      const _deviceExempt = (device as any).virtual === true && (device as any).activated === true;
      const _ev = _deviceExempt ? { dates: new Set<string>(), leases: [] as Array<[Date, Date]> } : await loadEvidence(client, miner_key);
      const _aGateDenied = new Set<number>();
      const _aGateOk = (r: any, start: any, end: any): boolean => {
        if (_deviceExempt || r.corrected_by) return true;
        const ok = hasEvidenceInWindow(_ev, new Date(start), new Date(end));
        if (!ok) {
          _aGateDenied.add(r.reward_number);
          loggers.apiError('/api/rewards/claim', new Error('A-gate: no PoC evidence'), { miner_key, address: session.user.address, issueType: 'REWARD_NO_POC_EVIDENCE', part: 'claim.aGate', metadata: { reward_number: r.reward_number, asset_id: r.asset_id, window: [start, end] } });
        }
        return ok;
      };
      weeklyClaimables = weeklyClaimables.filter((r: any) => _aGateOk(r, r.week_start, r.week_end));
      dailyClaimables = dailyClaimables.filter((r: any) => _aGateOk(r, r.date, r.date));

      const records: DeviceClaimTarget[] = [];
      if (typeof no === 'number') {
        const weeklyTargets = weeklyClaimables.filter((wr: any) => wr.reward_number === no);
        const dailyTargets = weeklyTargets.length ? [] : dailyClaimables.filter((dr: any) => dr.reward_number === no);
        // F3-y hold enforcement: a specifically-requested reward under review is refused explicitly (never sent).
        if (!weeklyTargets.length && !dailyTargets.length) {
          const heldRequested =
            (rewardsDoc?.weekly_rewards || []).some((wr: any) => wr.reward_number === no && wr.status === 'claimable' && isHeld(wr)) ||
            (rewardsDoc?.daily_rewards || []).some((dr: any) => dr.reward_number === no && dr.status === 'claimable' && isHeld(dr));
          if (heldRequested || _aGateDenied.has(no)) {
            throw {
              status: 403,
              response: createApiError('REWARD_ON_HOLD', 'These rewards are under review and cannot be claimed yet.', 'This reward is being verified and will become claimable once review completes.')
            };
          }
        }
        if (!weeklyTargets.length && !dailyTargets.length) {
          throw {
            status: 404,
            response: createApiError(ErrorCodes.NO_REWARDS, 'No rewards available to claim.', 'Wait for new rewards to unlock and try again or refresh the page if you believe this is not right.')
          };
        }
        weeklyTargets.forEach((wr: any) =>
          records.push({ source: 'weekly', reward_number: wr.reward_number, asset_id: wr.asset_id, amount: effectiveAmount(wr) })
        );
        dailyTargets.forEach((dr: any) =>
          records.push({ source: 'daily', reward_number: dr.reward_number, asset_id: dr.asset_id, amount: effectiveAmount(dr) })
        );
      } else {
        if (!weeklyClaimables.length && !dailyClaimables.length) {
          throw {
            status: 404,
            response: createApiError(ErrorCodes.NO_REWARDS, 'No rewards available to claim.', 'Wait for new rewards to unlock and try again or refresh the page if you believe this is not right.')
          };
        }
        weeklyClaimables.forEach((wr: any) =>
          records.push({ source: 'weekly', reward_number: wr.reward_number, asset_id: wr.asset_id, amount: effectiveAmount(wr) })
        );
        dailyClaimables.forEach((dr: any) =>
          records.push({ source: 'daily', reward_number: dr.reward_number, asset_id: dr.asset_id, amount: effectiveAmount(dr) })
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
            const availableDisplay = Number(availableMicro) / Math.pow(10, entry.decimals);
            const requiredDisplay = Number(entry.totalMicro) / Math.pow(10, entry.decimals);
            const decimalsFixed = Math.min(6, entry.decimals);
            throw {
              status: 503,
              response: createApiError(
                ErrorCodes.REWARD_VAULT_DEPLETED,
                `Rewards vault for asset ${entry.asset_id} is depleted.`,
                `Shortage: ${availableDisplay.toFixed(decimalsFixed)} available, ${requiredDisplay.toFixed(decimalsFixed)} required. Claims will resume once the vault is refilled.`,
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
      const isAemDevice = minerPrefix === AEM_PREFIX || minerPrefix === FEM_PREFIX;
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

      // User-pays-gas dark-launch. Default OFF: the LIVE path stays custodial (below).
      // ON only when the global flag is "true" OR the claiming wallet is in the test allowlist.
      const _userPaysGlobal = process.env.REWARD_USER_PAYS_GAS === 'true';
      const _userPaysAllow = (process.env.REWARD_USER_PAYS_GAS_TEST_WALLETS || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const userPays = _userPaysGlobal || _userPaysAllow.includes(session.user.address);

      if (userPays) {
        // Build a user-signed atomic group [user->vault ALGO payment, vault->user ASA...].
        // The vault signs only its own legs here; the user leg is returned unsigned for the
        // wallet to sign, then /confirm reassembles + submits. No claimed-write happens yet.
        const gasPaymentMicroAlgo = Number(process.env.USER_GAS_PAYMENT_MICROALGO ?? 10000) || 10000;
        const assetLegs = summary.map((entry) => ({
          assetId: entry.asset_id,
          rewardAmount: Number(entry.totalMicro)
        }));
        const group = await buildUserPaysClaimGroup({
          mnemonicEnv: 'REWARD_MNEMONIC',
          rekeyEnv: 'REWARD_REKEY',
          label: 'reward claim',
          algod: algodClient,
          claimingAddress: session.user.address,
          assetLegs,
          gasPaymentMicroAlgo
        });

        await db.collection('reward_pending_claims').insertOne({
          groupId: group.groupId,
          miner_key,
          claimingAddress: session.user.address,
          assetLegs,
          gasPaymentMicroAlgo,
          signedServerLegsB64: group.signedServerLegsB64,
          records,
          totalsDisplay,
          totalAmount: totalAmountNumeric,
          status: 'pending',
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + 300000)
        });

        return {
          response: {
            success: true,
            preview: false,
            mode: 'user_pays',
            groupId: group.groupId,
            unsignedUserLeg: group.unsignedUserLegB64,
            unsignedServerLegs: group.unsignedServerLegsB64,
            expected: group.expected,
            totals: totalsDisplay
          } as unknown as ClaimResponse,
          journal: {
            status: 'pending' as const,
            metadata: { totals: totalsDisplay, mode: 'user_pays', groupId: group.groupId }
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

      const weeklyNos = records.filter((r) => r.source === 'weekly').map((r) => r.reward_number);
      const dailyNos = records.filter((r) => r.source === 'daily').map((r) => r.reward_number);
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
      if (weeklyNos.length > 0) {
        const updateWeekly = await rewardsCollection.updateOne(
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
        const updateDaily = await rewardsCollection.updateOne(
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

      // add-only: record the effective amount actually claimed, per row (F3-y truthful accounting)
      for (const r of records) {
        const arr = r.source === 'weekly' ? 'weekly_rewards' : 'daily_rewards';
        await rewardsCollection.updateOne(
          { miner_key },
          { $set: { [`${arr}.$[elem].claimed_amount`]: r.amount } },
          { arrayFilters: [{ 'elem.reward_number': r.reward_number, 'elem.status': 'claimed', 'elem.tx_id': txId }] }
        );
      }

      const currentClaimable = quantizeForStorage(parseCurrencyValue(rewardsDoc?.total_claimable));
      const currentClaimed = quantizeForStorage(parseCurrencyValue(rewardsDoc?.total_claimed));
      const nextClaimable = Math.max(0, quantizeForStorage(currentClaimable - totalAmountNumeric));
      const nextClaimed = quantizeForStorage(currentClaimed + totalAmountNumeric);

      await rewardsCollection.updateOne(
        { miner_key },
        {
          $set: {
            total_claimable: nextClaimable,
            total_claimed: nextClaimed
          }
        }
      );

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

