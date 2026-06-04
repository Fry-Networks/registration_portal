import { NextApiRequest, NextApiResponse } from 'next';
import { Buffer } from 'buffer';
import { getServerSession } from 'next-auth';
import clientPromise from '../../../lib/mongoclient';
import { authOptions } from '../auth/[...nextauth]';
import { hydrateDeviceWithPosition } from '../../../lib/devicePosition';
import { loggers } from '../../../lib/logger';
import {
  CommonErrors,
  createApiError,
  ErrorCodes,
  handleApiError
} from '../../../lib/api-errors';
import { indexerClient } from '../../../lib/utils';
import type { Collection, Document, UpdateFilter, ObjectId } from 'mongodb';
import type { Device } from '../../../lib/types';
import { shouldForceLegacyUnverified } from '../../../lib/legacyStake';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const session = await getServerSession(req, res, authOptions);

  if (!session || !session.user) {
    return res.status(401).json(CommonErrors.noSession());
  }

  const walletAddress = session.user.address;

  const { address } = req.body ?? {};

  const testMode =
    process.env.NEXT_PUBLIC_TEST_MODE &&
    process.env.NEXT_PUBLIC_TEST_MODE === 'true';
  const { miner_key } = req.query;

  if (!miner_key || typeof miner_key !== 'string') {
    return res.status(400).json(
      createApiError(
        ErrorCodes.INVALID_INPUT,
        'Invalid or missing miner key',
        'Please provide the device miner key.'
      )
    );
  }

  try {
    const client = await clientPromise;
    const db = client.db('main');
    const collection: Collection<Document> = db.collection(
      testMode ? 'test-devices' : 'devices'
    );

    const device = (await collection.findOne<{ _id: ObjectId } & Device>({ miner_key })) || null;

    if (!device) {
      return res.status(404).json(
        createApiError(
          ErrorCodes.DEVICE_NOT_FOUND,
          'Device not found',
          'Please verify the miner key and try again.'
        )
      );
    }

    if (device && shouldForceLegacyUnverified(device) && device.verified) {
        await collection.updateOne(
          { _id: device._id },
          { $set: { verified: false } }
        );
        device.verified = false;
    }

    const hydratedDevice = await hydrateDeviceWithPosition(client, device as any);

    await enrichLegacyStakeData(collection, miner_key, hydratedDevice);

    // Compute is_active for tracked device prefixes (14-day poc_reward_dailies lookback)
    const TRACKED_PREFIXES = ['AEM', 'BM', 'RDN', 'SDN', 'SVN', 'CN'];
    const prefix = miner_key.split('-')[0];
    if (TRACKED_PREFIXES.includes(prefix)) {
      const cutoff = new Date(Date.now() - 14 * 86400000);
      const found = await db.collection('poc_reward_dailies').findOne({ miner_key, date: { $gte: cutoff } });
      (hydratedDevice as any).is_active = !!found;
    }

    if (address) {
      if (walletAddress !== address) {
        loggers.apiError('/api/devices/[miner_key]', new Error('Wallet mismatch loading device detail'), {
          sessionAddress: walletAddress,
          address,
          miner_key,
          issueType: 'DEVICE_DETAIL_WALLET_MISMATCH',
          part: 'devices.miner-key.auth',
        });
        return res.status(401).json(CommonErrors.walletMismatch());
      }

      if (device.address && device.address !== walletAddress) {
        return res.status(401).json(CommonErrors.walletMismatch());
      }
      return res.status(200).json({ device: hydratedDevice });
    }

    return res.status(200).json({
      device: {
        is_registered: hydratedDevice.is_registered,
        registered_portal_model: hydratedDevice?.registered_portal_model,
        position: hydratedDevice?.position
      }
    });
  } catch (error) {
    handleApiError(res, '/api/devices/[miner_key]', error, {
      response: createApiError(
        ErrorCodes.INTERNAL_ERROR,
        'Unable to load device information',
        'Please try again. If the problem persists, contact support.'
      ),
      minerKey: miner_key,
      walletAddress,
      issueType: 'DEVICE_FETCH_ERROR',
      part: 'devices.miner-key.handler',
      metadata: {
        miner_key,
        address,
        hasAddressFilter: Boolean(address),
      },
    });
  }
}

type StakeSegment = {
  amount?: number | null;
  time?: Date | string | null;
  txId?: string | null;
  asset_id?: string | null;
  type?: string | null;
  history?: Array<Record<string, unknown>>;
  withdrawals?: Array<Record<string, unknown>>;
  lastWithdrawal?: Record<string, unknown> | null;
};

type StakeKey = 'staked' | 'registration' | 'node';

const MICRO_FACTOR = 1_000_000;

type ParsedNoteMeta = {
  lockType: string | null;
  amount: number | null;
  assetId: string | null;
};

const parseWithdrawalNote = (note?: string | Uint8Array | null): ParsedNoteMeta => {
  if (!note) {
    return { lockType: null, amount: null, assetId: null };
  }
  let decoded: string;
  try {
    if (typeof note === 'string') {
      decoded = Buffer.from(note, 'base64').toString('utf8').trim();
    } else {
      decoded = Buffer.from(note).toString('utf8').trim();
    }
    if (!decoded) return { lockType: null, amount: null, assetId: null };
    let lockType: string | null = null;
    let amount: number | null = null;
    let assetId: string | null = null;
    try {
      const parsed = JSON.parse(decoded);
      if (typeof parsed?.type === 'string') lockType = parsed.type;
      if (!lockType && typeof parsed?.stake_type === 'string') lockType = parsed.stake_type;
      if (!lockType && typeof parsed?.lockType === 'string') lockType = parsed.lockType;

      if (typeof parsed?.amount === 'number' && Number.isFinite(parsed.amount)) {
        amount = parsed.amount;
      } else if (typeof parsed?.amount === 'string') {
        const parsedAmount = Number(parsed.amount);
        if (Number.isFinite(parsedAmount)) amount = parsedAmount;
      }

      if (typeof parsed?.asset_id === 'string' && parsed.asset_id.length > 0) {
        assetId = parsed.asset_id;
      } else if (typeof parsed?.assetId === 'string' && parsed.assetId.length > 0) {
        assetId = parsed.assetId;
      }
    } catch {
      // Non-JSON notes fall back to regex extraction
    }
    const match = decoded.match(/\"type\"\s*:\s*\"(one|two)\"/i);
    const derivedLock = match && match[1] ? match[1].toLowerCase() : null;
    if (!lockType) lockType = derivedLock;
    return { lockType, amount, assetId };
  } catch {
    // ignore
    return { lockType: null, amount: null, assetId: null };
  }
  return { lockType: null, amount: null, assetId: null };
};

const normaliseAmount = (input: unknown): number | null => {
  if (typeof input === 'number') return input / MICRO_FACTOR;
  if (typeof input === 'bigint') return Number(input) / MICRO_FACTOR;
  if (typeof input === 'string') {
    const parsed = Number(input);
    if (!Number.isNaN(parsed)) return parsed / MICRO_FACTOR;
  }
  return null;
};

async function fetchWithdrawalSnapshot(txId: string) {
  try {
    const response = await indexerClient.lookupTransactionByID(txId).do();
    const transaction = response?.transaction as any;
    if (!transaction) return null;

    const assetTransfer = transaction['asset-transfer-transaction'];
    const payment = transaction['payment-transaction'];
    const amountRaw =
      assetTransfer?.amount ?? payment?.amount ?? transaction?.amount ?? null;
    const noteMeta = parseWithdrawalNote(transaction.note);
    const amount =
      noteMeta.amount ??
      normaliseAmount(amountRaw);
    const lockType = noteMeta.lockType;
    const timestamp = transaction['round-time']
      ? new Date(transaction['round-time'] * 1000)
      : null;
    const assetId =
      assetTransfer?.['asset-id'] ??
      (typeof transaction['asset-index'] !== 'undefined'
        ? transaction['asset-index']
        : null) ??
      noteMeta.assetId ??
      null;

    return {
      amount,
      asset_id: assetId ? String(assetId) : null,
      time: timestamp,
      type: lockType
    };
  } catch (error) {
    loggers.apiError('/api/devices/[miner_key]#fetchWithdrawalSnapshot', error as Error, {
      txId,
      issueType: 'INDEXER_LOOKUP_FAILED',
      part: 'devices.miner-key.fetchWithdrawalSnapshot'
    });
    return null;
  }
}

async function ensureWithdrawalMetadata(
  collection: Collection<Document>,
  minerKey: string,
  stakeKey: StakeKey,
  segment?: StakeSegment | null
) {
  if (!segment) return;

  const amount = typeof segment.amount === 'number' ? segment.amount : null;
  const hasActiveStake = amount !== null && amount > 0;

  const lastWithdrawal =
    segment.lastWithdrawal && typeof segment.lastWithdrawal === 'object'
      ? (segment.lastWithdrawal as Record<string, unknown>)
      : null;

  const lastWithdrawalTx =
    typeof lastWithdrawal?.txId === 'string' && lastWithdrawal.txId
      ? lastWithdrawal.txId
      : null;
  const lastWithdrawalAmount =
    typeof lastWithdrawal?.amount === 'number' && Number.isFinite(lastWithdrawal.amount)
      ? lastWithdrawal.amount
      : null;
  const lastWithdrawalAsset =
    typeof lastWithdrawal?.asset_id === 'string' && lastWithdrawal.asset_id
      ? lastWithdrawal.asset_id
      : null;
  const lastWithdrawalTime = lastWithdrawal?.time
    ? new Date(lastWithdrawal.time as string | number | Date)
    : null;
  const lastWithdrawalType =
    typeof lastWithdrawal?.type === 'string' && lastWithdrawal.type
      ? lastWithdrawal.type
      : null;

  const requiresSnapshot =
    !hasActiveStake &&
    (lastWithdrawalTx
      ? !lastWithdrawalAmount ||
        lastWithdrawalAmount <= 0 ||
        !lastWithdrawalAsset ||
        !lastWithdrawalTime
      : Boolean(segment.txId));

  if (!requiresSnapshot) {
    return;
  }

  const txId = lastWithdrawalTx ?? segment.txId ?? null;
  if (!txId) return;

  const snapshot = await fetchWithdrawalSnapshot(txId);
  if (!snapshot || snapshot.amount === null) {
    return;
  }

  const resolvedAmount =
    snapshot.amount ??
    (lastWithdrawalAmount && lastWithdrawalAmount > 0 ? lastWithdrawalAmount : null) ??
    (amount && amount > 0 ? amount : null);
  if (resolvedAmount === null) {
    return;
  }

  const resolvedAsset =
    snapshot.asset_id ?? lastWithdrawalAsset ?? segment.asset_id ?? null;
  const resolvedTime =
    snapshot.time ??
    lastWithdrawalTime ??
    (segment.time ? new Date(segment.time) : new Date());
  const resolvedType =
    snapshot.type ?? lastWithdrawalType ?? segment.type ?? null;

  const withdrawalRecord: Record<string, unknown> = {
    txId,
    amount: resolvedAmount,
    asset_id: resolvedAsset,
    time: resolvedTime
  };
  if (resolvedType) {
    withdrawalRecord.type = resolvedType;
  }

  segment.lastWithdrawal = withdrawalRecord;

  const withdrawalsArray = Array.isArray(segment.withdrawals)
    ? [...segment.withdrawals]
    : [];
  const existingIndex = withdrawalsArray.findIndex(
    (entry) => entry?.txId === txId
  );
  if (existingIndex >= 0) {
    withdrawalsArray[existingIndex] = {
      ...withdrawalsArray[existingIndex],
      ...withdrawalRecord
    };
  } else {
    withdrawalsArray.push(withdrawalRecord);
  }
  segment.withdrawals = withdrawalsArray;

  if (!segment.amount || segment.amount <= 0) {
    segment.amount = null;
  }
  segment.txId = null;

  const update: UpdateFilter<Document> = {
    $set: {
      [`${stakeKey}.lastWithdrawal`]: withdrawalRecord,
      [`${stakeKey}.amount`]: null,
      [`${stakeKey}.txId`]: null
    }
  };

  if (existingIndex >= 0) {
    update.$set![`${stakeKey}.withdrawals.${existingIndex}`] =
      withdrawalsArray[existingIndex];
  } else {
    if (!update.$push) {
      update.$push = {} as UpdateFilter<Document>['$push'];
    }
    (update.$push as Record<string, unknown>)[`${stakeKey}.withdrawals`] =
      withdrawalRecord;
  }

  // Remove empty $set/$push to avoid unnecessary writes.
  if (update.$set && Object.keys(update.$set).length === 0) {
    delete update.$set;
  }
  if (update.$push && Object.keys(update.$push).length === 0) {
    delete update.$push;
  }

  if (update.$set || update.$push) {
    await collection.updateOne({ miner_key: minerKey }, update);
  }
}

export async function enrichLegacyStakeData(
  collection: Collection<Document>,
  minerKey: string,
  device: any
) {
  await ensureWithdrawalMetadata(collection, minerKey, 'staked', device?.staked);
  await ensureWithdrawalMetadata(
    collection,
    minerKey,
    'registration',
    device?.registration
  );
  await ensureWithdrawalMetadata(collection, minerKey, 'node', device?.node);
}
