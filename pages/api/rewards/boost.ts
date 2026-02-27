import { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import clientPromise from '../../../lib/mongoclient';
import rewardsClientPromise from '../../../lib/rewardsMongoClient';
import { getFRYPrice } from '../../../lib/price';
import type { Account, Transaction } from 'algosdk';
import { fixedInputSwap, FRY_2, fNODE, fVPN, ALGO, FRYALGO_WALLET, tFRY } from '../../../lib/utils';
import { createApiError, ErrorCodes } from '../../../lib/api-errors';
import { loggers } from '../../../lib/logger';
import { verifyClientToken } from '../../../lib/clientTokenMiddleware';
import { verifyRequestSignatureAsync } from '../../../lib/requestSignature.server';
import { isAdminRequest } from '../../../lib/adminCheck';
import { verifyDeviceFingerprintMiddleware } from '../../../lib/deviceFingerprint';
import { withDeviceActionLock } from '../../../lib/api/deviceAction';
import { getAlgodClient } from '../../../lib/wallet/clients';
import { buildAssetTransferTxn } from '../../../lib/wallet/transactions';
import {
  decodeUnsignedTransaction,
  loadMnemonicAccountPair,
  signAndSubmitCustodialTransactions
} from '../../../lib/algorand/admin';
import { Document } from 'mongodb';
import { AssetWithIdAndAmount } from '@tinymanorg/tinyman-js-sdk';
import { notifyDiscordError } from '../../../lib/discord-webhook';
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

// Normalize test mode flag to a strict boolean for type safety.
const testMode = process.env.NEXT_PUBLIC_TEST_MODE === 'true';
const WEEKLY_FLAG =
  process.env.NEXT_PUBLIC_WEEKLY_REWARDS_ENABLED === 'true' ||
  process.env.WEEKLY_REWARDS_ENABLED === 'true';
const PRECISION_DECIMALS = 6;
const DISPLAY_DECIMALS = 2;
const roundAmount = (value: number, decimals = PRECISION_DECIMALS) =>
  Math.round(value * 10 ** decimals) / 10 ** decimals;
const quantizeForStorage = (value: number) => roundAmount(value, DISPLAY_DECIMALS);
const addInc = (inc: Record<string, number>, key: string, delta: number) => {
  if (!Number.isFinite(delta)) {
    return;
  }
  const quantizedDelta = quantizeForStorage(delta);
  if (quantizedDelta === 0) {
    return;
  }
  const next = quantizeForStorage((inc[key] ?? 0) + quantizedDelta);
  inc[key] = next;
};

const computeBoostedAmount = (amount: number): number => {
  return quantizeForStorage(amount * 0.7);
};

const toError = (err: unknown): Error => {
  if (err instanceof Error) return err;
  try {
    return new Error(JSON.stringify(err));
  } catch {
    return new Error(String(err));
  }
};

type BoostRecord = {
  reward_number: number;
  asset_id: string;
  amount: number;
  // Track origin DB so updates are routed correctly.
  reward_db: RewardsDbSource;
  reward_id?: string;
  reward_date?: Date | null;
  source: 'weekly' | 'daily';
};

const buildBoostTotals = (records: BoostRecord[]) => {
  let sumOriginal = 0;
  let sumBoosted = 0;

  for (const record of records) {
    const amount = typeof record.amount === 'number' ? record.amount : 0;
    const original = quantizeForStorage(amount);
    const boosted = quantizeForStorage(original * 0.7);
    sumOriginal = quantizeForStorage(sumOriginal + original);
    sumBoosted = quantizeForStorage(sumBoosted + boosted);
  }

  return {
    sumOriginal,
    sumBoosted
  };
};

const swapWithInputAsset = async (
  acc: Account,
  asset: string,
  amount: number,
  signer: Account
): Promise<AssetWithIdAndAmount | undefined> => {
  if (asset === tFRY.id) {
    const res1 = await fixedInputSwap({
      account: acc,
        asset_1: tFRY,
      asset_2: ALGO,
      amount,
      rekey: signer
    });
    if (res1?.assetOut) {
      const algoAmount = Number(res1.assetOut.amount) / 10 ** ALGO.decimals;
      const res2 = await fixedInputSwap({
        account: acc,
        asset_1: ALGO,
        asset_2: FRY_2,
        amount: algoAmount,
        rekey: signer
      });
      return res2?.assetOut;
    }
    return undefined;
  }

  if (asset === fNODE.id) {
    const res = await fixedInputSwap({
      account: acc,
      asset_1: fNODE,
      asset_2: FRY_2,
      amount,
      rekey: signer
    });
    return res?.assetOut;
  }

  if (asset === fVPN.id) {
    const res = await fixedInputSwap({
      account: acc,
      asset_1: fVPN,
      asset_2: FRY_2,
      amount,
      rekey: signer
    });
    return res?.assetOut;
  }

  return undefined;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const session = await getServerSession(req, res, authOptions);
  if (session?.user?.address) {
    (req as NextApiRequest & { _sessionWalletAddress?: string })._sessionWalletAddress =
      session.user.address;
  }

  const isAdmin = await isAdminRequest(req);

  if (!isAdmin) {
    const tokenVerified = await verifyClientToken(req, res);
    if (!tokenVerified) {
      return;
    }

    const signature = req.headers['x-request-signature'] as string;
    const timestamp = parseInt(req.headers['x-request-timestamp'] as string, 10);

    if (!signature || !timestamp) {
      res.status(403).json({
        success: false,
        code: 'MISSING_SIGNATURE',
        message: 'Request signature or timestamp missing'
      });
      return;
    }

    const signatureValid = await verifyRequestSignatureAsync(
      req.method || 'POST',
      req.url || '/api/rewards/boost',
      req.body,
      timestamp,
      signature,
      req
    );
    if (!signatureValid) {
      res.status(403).json({
        success: false,
        code: 'INVALID_SIGNATURE',
        message: 'Invalid request signature'
      });
      return;
    }
  }


  if (!session || !session.user) {
    res.status(401).json({ success: false, code: 'UNAUTHORIZED', message: 'Unauthorized' });
    return;
  }

  const data: {
    miner_key: string;
    no?: number;
    reward_db?: 'main' | 'dbrewards';
    reward_id?: string;
  } = req.body;

  const { miner_key, no, reward_db, reward_id } = data;
  // Normalize optional reward routing hints to avoid ambiguous boosts.
  const normalizedRewardDb = reward_db === 'main' || reward_db === 'dbrewards' ? reward_db : undefined;
  if (reward_db && !normalizedRewardDb) {
    res.status(400).json(createApiError(ErrorCodes.INVALID_INPUT, 'Invalid reward database selection'));
    return;
  }

  const fingerprintStatus = await verifyDeviceFingerprintMiddleware(req, session, isAdmin, {
    walletAddress: session.user.address,
    minerKey: miner_key
  });
  if (fingerprintStatus === 'retry') {
    res.status(409).json({
      success: false,
      code: 'DEVICE_FINGERPRINT_REFRESH',
      message: 'Security check refreshed your session. Please retry the request.'
    });
    return;
  }
  if (fingerprintStatus === 'blocked') {
    res.status(403).json({
      success: false,
      code: 'DEVICE_MISMATCH',
      message: 'Request originated from different device or script'
    });
    return;
  }

  if (!isAdmin) {
    void monitorWalletHealth(session.user.address, { minerKey: miner_key, operation: 'boost' });
  }

  await withDeviceActionLock(req, res, {
    action: 'boost',
    miner_key,
    address: session.user.address,
    metadata: {
      rewardSelection: typeof no === 'number' ? 'single' : 'all'
    }
  }, async () => {
    try {
      const client = await clientPromise;
      const db = client.db('main');
      // Rewards are split post-cutoff; load both collections for routing.
      const rewardsClient = await rewardsClientPromise;
      const rewardsDb = rewardsClient.db('dbrewards');

      const device = await db
        .collection(testMode ? 'test-devices' : 'devices')
        .findOne({ miner_key });

      if (!device) {
        throw {
          status: 404,
          response: createApiError(
            ErrorCodes.DEVICE_NOT_FOUND,
            'Device not found',
            'Refresh your devices and try again.'
          )
        };
      }

      if (!device.address || device.address !== session.user.address) {
        throw {
          status: 401,
          response: createApiError(
            ErrorCodes.UNAUTHORIZED,
            'Unauthorized',
            'Sign in with the wallet that owns this device.'
          )
        };
      }

      const mainRewardsCollection = db.collection(resolveRewardsCollectionName('main', testMode));
      const newRewardsCollection = rewardsDb.collection(resolveRewardsCollectionName('dbrewards', testMode));
      const bCollection = db.collection('reward-boosts');

      let records: BoostRecord[] = [];
      let mode: 'weekly' | 'daily' = 'weekly';
      const [mainDoc, newDoc] = await Promise.all([
        mainRewardsCollection.findOne({ miner_key }),
        newRewardsCollection.findOne({ miner_key })
      ]);
      const rewardDocs: Array<{ source: RewardsDbSource; doc: any | null }> = [
        { source: 'main', doc: mainDoc },
        { source: 'dbrewards', doc: newDoc }
      ];
      const weeklyPendings = rewardDocs.flatMap(({ source, doc }) =>
        (doc?.weekly_rewards || [])
          .filter((wr: any) => {
            const rewardDate = getWeeklyRewardDate(wr);
            if (!wr?.unlock_at || !rewardDate) return false;
            const inRange = source === 'main'
              ? isBeforeRewardsCutoff(rewardDate)
              : isOnOrAfterRewardsCutoff(rewardDate);
            return wr.status === 'pending' && inRange;
          })
          .map((wr: any) => ({
            reward_number: wr.reward_number,
            asset_id: wr.asset_id,
            amount: wr.amount,
            reward_db: source,
            reward_id: wr?._id ? String(wr._id) : undefined,
            reward_date: getWeeklyRewardDate(wr),
            source: 'weekly' as const
          }))
      );
      const dailyPendings = rewardDocs.flatMap(({ source, doc }) =>
        (doc?.daily_rewards || [])
          .filter((dr: any) => {
            const rewardDate = getDailyRewardDate(dr);
            const inRange = source === 'main'
              ? isBeforeRewardsCutoff(rewardDate)
              : isOnOrAfterRewardsCutoff(rewardDate);
            return dr.status === 'pending' && inRange;
          })
          .map((dr: any) => ({
            reward_number: dr.reward_number,
            asset_id: dr.asset_id,
            amount: dr.amount,
            reward_db: source,
            reward_id: dr?._id ? String(dr._id) : undefined,
            reward_date: getDailyRewardDate(dr),
            source: 'daily' as const
          }))
      );

      // Filter helpers to avoid ambiguous reward_number collisions across databases.
      const matchesSelection = (reward: BoostRecord): boolean => {
        if (typeof no === 'number' && reward.reward_number !== no) return false;
        if (reward_id && String(reward.reward_id) !== String(reward_id)) return false;
        if (normalizedRewardDb && reward.reward_db !== normalizedRewardDb) return false;
        return true;
      };

      if (typeof no === 'number' || reward_id) {
        const weeklyRecords = weeklyPendings.filter(matchesSelection);
        const dailyRecords = dailyPendings.filter(matchesSelection);
        if (!weeklyRecords.length && !dailyRecords.length) {
          throw {
            status: 404,
            response: createApiError(
              ErrorCodes.NO_REWARDS,
              'No pending reward with that number. If it shows claimable, please use Claim.'
            )
          };
        }
        if (!normalizedRewardDb && typeof no === 'number') {
          const sources = new Set<string>([
            ...weeklyRecords.map((r) => `${r.reward_db}:${r.source}`),
            ...dailyRecords.map((r) => `${r.reward_db}:${r.source}`)
          ]);
          if (sources.size > 1) {
            throw {
              status: 409,
              response: createApiError(
                ErrorCodes.INVALID_INPUT,
                'Ambiguous reward number across reward databases',
                'Refresh the page and retry the instant claim for this specific reward.'
              )
            };
          }
        }
        if (weeklyRecords.length > 0 && dailyRecords.length > 0 && !reward_id) {
          throw {
            status: 409,
            response: createApiError(
              ErrorCodes.INVALID_INPUT,
              'Ambiguous reward selection across weekly and daily records',
              'Refresh the page and retry the instant claim for this specific reward.'
            )
          };
        }
        records = weeklyRecords.length > 0 ? weeklyRecords : dailyRecords;
        mode = weeklyRecords.length > 0 ? 'weekly' : 'daily';
      } else {
        if (weeklyPendings.length === 0 && dailyPendings.length === 0) {
          throw {
            status: 404,
            response: createApiError(
              ErrorCodes.NO_REWARDS,
              'No pending rewards available. If rewards show claimable, please use Claim.'
            )
          };
        }
        if (WEEKLY_FLAG) {
          records = weeklyPendings;
          mode = 'weekly';
        } else {
          records = dailyPendings;
          mode = 'daily';
        }
      }
      const { sumOriginal, sumBoosted } = buildBoostTotals(records);

      type Result = {
        asset_id: number;
        totalAmount: number;
      };

      const sumByAssetId = records.reduce((acc, record) => {
        const asset_id = Number(record.asset_id);
        const amount = record.amount;
        const existingAmount = acc.get(asset_id) || 0;
        acc.set(asset_id, existingAmount + amount);
        return acc;
      }, new Map<number, number>());

      const resultArray: Result[] = Array.from(sumByAssetId.entries()).map(([asset_id, totalAmount]) => ({
        asset_id,
        totalAmount
      }));

      // Guard: require the reward wallet to be opted into each asset before we deliver the 70% payout.
      const rewardWallet = device.reward_wallet;
      if (!rewardWallet) {
        throw {
          status: 400,
          response: createApiError(
            ErrorCodes.INVALID_INPUT,
            'This device does not have a reward wallet configured.',
            'Update the reward wallet before using instant claim.'
          )
        };
      }
      for (const assetId of resultArray.map((entry) => entry.asset_id)) {
        await ensureWalletAssetOptIn(rewardWallet, assetId, 'running instant claim');
      }

      const algodClient = getAlgodClient();
      const suggestedParams = await algodClient.getTransactionParams().do();
      const { account, signer } = loadMnemonicAccountPair({
        mnemonicEnv: 'REWARD_MNEMONIC',
        rekeyEnv: 'REWARD_REKEY',
        label: 'reward boost'
      });

      const from = account.addr;
      const unsignedTxns: Transaction[] = [];
      let totalFeeAmount = 0;
      const feeTotals: Record<string, number> = {};

      for (let i = 0; i < resultArray.length; i++) {
        const feeAmount = Math.round((resultArray[i].totalAmount * 100 * 30) / 100) / 100;

        const sourceAssetId = Number(resultArray[i].asset_id);
        const isFry2Source = sourceAssetId === Number(FRY_2.id);
        const isTfrySource = sourceAssetId === Number(tFRY.id);
        const requiresSwap =
          sourceAssetId === Number(fNODE.id) || sourceAssetId === Number(fVPN.id);

        let feeTransferAssetId = isTfrySource ? Number(tFRY.id) : Number(FRY_2.id);
        let feeTransferDecimals = isTfrySource ? tFRY.decimals : FRY_2.decimals;
        let feeAmountMicro = Math.round(feeAmount * Math.pow(10, feeTransferDecimals));
        let feeAmountForLog = feeAmount;
        let swappedAsset: AssetWithIdAndAmount | undefined;

        if (requiresSwap) {
          swappedAsset = await swapWithInputAsset(account, resultArray[i].asset_id.toString(), feeAmount, signer);

          if (!swappedAsset) {
            loggers.apiError('/api/rewards/boost', new Error('Swap to FRY 2.0 failed'), {
              miner_key,
              address: session.user.address,
              asset_id: resultArray[i].asset_id,
              amount: feeAmount,
              issueType: 'REWARD_BOOST_SWAP_ERROR',
              part: 'boost.swap.alt'
            });
            throw {
              status: 500,
              response: createApiError(
                ErrorCodes.SWAP_FAILED,
                'Unable to convert reward asset for instant claim',
                'Please try again later.'
              )
            };
          }

          feeTransferAssetId = Number(FRY_2.id);
          feeTransferDecimals = FRY_2.decimals;
          feeAmountMicro = Number(swappedAsset.amount);
          feeAmountForLog = Number(swappedAsset.amount) / Math.pow(10, FRY_2.decimals);
        } else if (!isFry2Source && !isTfrySource) {
          throw {
            status: 400,
            response: createApiError(
              ErrorCodes.INVALID_INPUT,
              'Unsupported asset for instant claim',
              'Please refresh and try again.'
            )
          };
        } else if (isFry2Source) {
          feeAmountMicro = Math.round(feeAmount * Math.pow(10, FRY_2.decimals));
          feeAmountForLog = feeAmount;
        } else if (isTfrySource) {
          feeAmountMicro = Math.round(feeAmount * Math.pow(10, tFRY.decimals));
          feeAmountForLog = feeAmount;
        }

        if (!testMode && (!Number.isFinite(feeAmountMicro) || feeAmountMicro <= 0)) {
          throw {
            status: 500,
            response: createApiError(
              ErrorCodes.INTERNAL_ERROR,
              'Calculated boost fee is invalid',
              'Please try again later.'
            )
          };
        }

        const noteInfo = {
          action: 'Instant Claim',
          miner_key: miner_key.split('-')[0] + '-' + miner_key.split('-')[1].slice(0, 6),
          asset_id: feeTransferAssetId,
          fee_amount: feeAmountForLog,
          date: new Date(Date.now())
        };
        const enc = new TextEncoder();
        const note = enc.encode(JSON.stringify(noteInfo));

        const encodedTxn = await buildAssetTransferTxn({
          sender: String(from),
          receiver: String(FRYALGO_WALLET),
          assetId: feeTransferAssetId,
          amount: testMode ? 0 : feeAmountMicro,
          note,
          useRawAmount: true,
          suggestedParams
        });

        const txn = decodeUnsignedTransaction(encodedTxn);
        unsignedTxns.push(txn);
        totalFeeAmount += feeAmountForLog;
        const feeKey = String(feeTransferAssetId);
        feeTotals[feeKey] = quantizeForStorage((feeTotals[feeKey] ?? 0) + feeAmountForLog);
      }

      const { txId } = await signAndSubmitCustodialTransactions({
        mnemonicEnv: 'REWARD_MNEMONIC',
        rekeyEnv: 'REWARD_REKEY',
        label: 'reward boost',
        algod: algodClient,
        transactions: unsignedTxns
      });
      if (!txId) {
        loggers.apiError('/api/rewards/boost', new Error('Broadcast returned empty response'), {
          miner_key,
          address: session.user.address,
          txCount: unsignedTxns.length,
          issueType: 'REWARD_BOOST_BROADCAST_ERROR',
          part: 'boost.broadcast.submit'
        });
        throw {
          status: 500,
          response: createApiError(
            ErrorCodes.TRANSACTION_FAILED,
            'Instant claim could not be submitted',
            'Please try again later.'
          )
        };
      }

      let rewards_nos: number[] = [];
      let totalOriginalAmount = sumOriginal;
      let totalBoostedAmount = sumBoosted;
      // Apply boosts per source database to keep totals consistent.
      const perSource = records.reduce((acc, record) => {
        const entry = acc.get(record.reward_db) ?? {
          weekly: [] as BoostRecord[],
          daily: [] as BoostRecord[],
          sumOriginal: 0,
          sumBoosted: 0
        };
        const original = quantizeForStorage(record.amount);
        const boosted = computeBoostedAmount(record.amount);
        entry.sumOriginal = quantizeForStorage(entry.sumOriginal + original);
        entry.sumBoosted = quantizeForStorage(entry.sumBoosted + boosted);
        if (record.source === 'weekly') {
          entry.weekly.push(record);
        } else {
          entry.daily.push(record);
        }
        acc.set(record.reward_db, entry);
        return acc;
      }, new Map<RewardsDbSource, { weekly: BoostRecord[]; daily: BoostRecord[]; sumOriginal: number; sumBoosted: number }>());

      let modifiedAny = false;
      const sourceContexts: Array<{ source: RewardsDbSource; collection: any; doc: any | null }> = [
        { source: 'main', collection: mainRewardsCollection, doc: mainDoc },
        { source: 'dbrewards', collection: newRewardsCollection, doc: newDoc }
      ];
      for (const ctx of sourceContexts) {
        const payload = perSource.get(ctx.source);
        if (!payload) continue;
        if (!ctx.doc) {
          throw {
            status: 409,
            response: createApiError(
              ErrorCodes.INTERNAL_ERROR,
              'Reward document missing for boost routing',
              'Please refresh and retry your instant claim.'
            )
          };
        }
        for (const record of payload.daily) {
          const boostedAmount = computeBoostedAmount(record.amount);
          const devRes = await ctx.collection.updateOne(
            { miner_key },
            {
              $set: {
                'daily_rewards.$[elem].status': 'claimable',
                'daily_rewards.$[elem].amount': boostedAmount
              }
            },
            { arrayFilters: [{ 'elem.reward_number': record.reward_number, 'elem.status': 'pending' }] }
          );
          if (devRes.modifiedCount && devRes.modifiedCount > 0) modifiedAny = true;
          rewards_nos.push(record.reward_number);
        }

        for (const record of payload.weekly) {
          const boostedAmount = computeBoostedAmount(record.amount);
          const updateRes = await ctx.collection.updateOne(
            { miner_key },
            {
              $set: {
                'weekly_rewards.$[elem].status': 'claimable',
                'weekly_rewards.$[elem].amount': boostedAmount
              }
            },
            { arrayFilters: [{ 'elem.reward_number': record.reward_number, 'elem.status': 'pending' }] }
          );
          if (updateRes.modifiedCount && updateRes.modifiedCount > 0) modifiedAny = true;
          rewards_nos.push(record.reward_number);
        }

        await ctx.collection.updateOne(
          { miner_key },
          { $inc: { total_pending: -payload.sumOriginal, total_claimable: payload.sumBoosted } }
        );
      }

      if (!modifiedAny) {
        throw {
          status: 409,
          response: createApiError(
            ErrorCodes.UPDATE_FAILED,
            'Nothing to boost — selected rewards are no longer pending',
            'Please refresh and try again.'
          )
        };
      }

      const feeAssetIds = Object.keys(feeTotals);
      const boostFeeAssetId = feeAssetIds.length === 1 ? feeAssetIds[0] : FRY_2.id;
      const boostFeeAmount =
        feeAssetIds.length === 1 ? feeTotals[boostFeeAssetId] : totalFeeAmount;

      const boostReward = {
        miner_key,
        address: String(session.user.address),
        rewards_nos,
        fee_amount: boostFeeAmount,
        asset_id: boostFeeAssetId,
        fee_assets: feeTotals,
        price: await getFRYPrice(boostFeeAssetId),
        createdAt: new Date(),
        txID: txId
      };
      await bCollection.insertOne(boostReward as Document);

      await notifyDiscordError({
        minerKey: miner_key,
        walletAddress: session.user.address,
        issueType: 'BOOST_METRIC',
        part: 'boost.analytics',
        errorMessage: `Instant claim submitted (${rewards_nos.length} rewards)`,
        severity: 'info',
        metadata: {
          rewards_nos,
          totalOriginalAmount,
          totalBoostedAmount,
          totalFeeAmount,
          feeAssets: feeTotals,
          mode,
          txId
        }
      });

      const monitoredAssetId = records.length === 1 ? Number(records[0].asset_id) : undefined;
      monitorTransaction(txId, {
        minerKey: miner_key,
        walletAddress: session.user.address,
        operation: 'instant_boost',
        amount: totalBoostedAmount,
        assetId: monitoredAssetId,
        preconfirmed: true
      }).catch((monitorError) => {
        console.warn('[boost] monitorTransaction failed', monitorError);
      });

      return {
        response: { success: true, message: `Boost submitted for ${miner_key}`, txId },
        journal: {
          txId,
          metadata: {
            miner_key,
            rewards: rewards_nos,
            totalFeeAmount
          }
        }
      };
    } catch (error) {
      loggers.apiError(
        '/api/rewards/boost',
        toError(error),
        {
          miner_key,
          address: session.user.address,
          issueType: 'REWARD_BOOST_ERROR',
          part: 'boost.handler'
        }
      );
      throw error;
    }
  });
}
