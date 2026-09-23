import type { Collection, Document, Filter, WithId } from 'mongodb';
import type { ObjectId } from 'mongodb';
import clientPromise from '../mongoclient';

export type DeviceAction =
  | 'claim'
  | 'boost'
  | 'dimo:claim'
  | 'dimo:sync'
  | 'stake:registration'
  | 'stake:node'
  | 'stake:verification'
  | 'withdraw:registration'
  | 'withdraw:node'
  | 'withdraw:verification'
  | 'withdraw:verification_check'
  | 'fee:withdraw'
  | 'fee:verify'
  | 'event:claim-free-fem';

export interface DeviceRequestLock {
  _id?: ObjectId;
  action: DeviceAction;
  miner_key: string;
  address: string;
  idempotencyKey: string;
  expiresAt: Date;
  createdAt: Date;
  metadata?: Record<string, unknown>;
}

const COLLECTION_NAME = 'device_request_locks';

const DEFAULT_LOCK_TTL_MS = 2 * 60 * 1000;

const ensureCollection = async (): Promise<Collection<DeviceRequestLock>> => {
  const client = await clientPromise;
  const db = client.db('main');
  const collection = db.collection<DeviceRequestLock>(COLLECTION_NAME);

  await collection.createIndex({ miner_key: 1, action: 1 }, { unique: true });
  await collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });

  return collection;
};

export interface AcquireLockParams {
  action: DeviceAction;
  miner_key: string;
  address: string;
  idempotencyKey: string;
  ttlMs?: number;
  metadata?: Record<string, unknown>;
}

export const acquireDeviceLock = async ({
  action,
  miner_key,
  address,
  idempotencyKey,
  ttlMs,
  metadata
}: AcquireLockParams): Promise<boolean> => {
  const collection = await ensureCollection();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + (ttlMs ?? DEFAULT_LOCK_TTL_MS));

  try {
    await collection.insertOne({
      action,
      miner_key,
      address,
      idempotencyKey,
      expiresAt,
      createdAt: now,
      metadata
    });
    return true;
  } catch (error: any) {
    if (error?.code === 11000) {
      return false;
    }
    throw error;
  }
};

export const releaseDeviceLock = async (
  action: DeviceAction,
  miner_key: string
): Promise<void> => {
  const collection = await ensureCollection();
  await collection.deleteOne({ action, miner_key });
};

export const forceReleaseLocksForAddress = async (
  address: string
): Promise<number> => {
  const collection = await ensureCollection();
  const result = await collection.deleteMany({ address });
  return result.deletedCount ?? 0;
};

export interface DeviceTransactionJournal {
  _id?: ObjectId;
  miner_key: string;
  action: DeviceAction;
  idempotencyKey: string;
  walletAddress: string;
  request: Record<string, unknown>;
  status: 'pending' | 'submitted' | 'confirmed' | 'failed';
  txId?: string;
  error?: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const JOURNAL_COLLECTION = 'device_transactions';

const ensureJournal = async (): Promise<Collection<DeviceTransactionJournal>> => {
  const client = await clientPromise;
  const db = client.db('main');
  const collection = db.collection<DeviceTransactionJournal>(JOURNAL_COLLECTION);
  await collection.createIndex({ miner_key: 1, idempotencyKey: 1 }, { unique: true });
  await collection.createIndex({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 90 });
  await collection.createIndex({ walletAddress: 1, createdAt: -1 });
  return collection;
};

export interface AppendJournalEntryParams {
  miner_key: string;
  action: DeviceAction;
  idempotencyKey: string;
  walletAddress: string;
  request: Record<string, unknown>;
  status?: DeviceTransactionJournal['status'];
  txId?: string;
  error?: string;
  metadata?: Record<string, unknown>;
}

export const appendJournalEntry = async (params: AppendJournalEntryParams): Promise<void> => {
  const collection = await ensureJournal();
  const now = new Date();

  await collection.updateOne(
    { miner_key: params.miner_key, idempotencyKey: params.idempotencyKey },
    {
      $set: {
        action: params.action,
        walletAddress: params.walletAddress,
        request: params.request,
        status: params.status ?? 'pending',
        txId: params.txId,
        error: params.error,
        metadata: params.metadata,
        updatedAt: now
      },
      $setOnInsert: {
        createdAt: now
      }
    },
    { upsert: true }
  );
};

export interface ConfirmJournalByGroupParams {
  miner_key: string;
  groupId: string;
  txId: string;
}

/**
 * Forward-only writeback for the user-pays claim path.
 *
 * /api/rewards/claim mints the pre-signed envelope and deliberately leaves the audit row
 * `pending` — nothing is on chain at that point. The group is submitted later by
 * /api/rewards/confirm, which consumed the envelope and moved the reward entries to `claimed`
 * but never came back to the audit row: measured in the R12 sweep, 0 of 1855 `pending` rows
 * carried a txId while 747 of them already had `claimed` entries.
 *
 * Only a row that is still `pending` or `submitted` is moved, so an already-`confirmed` (or
 * `failed`) row can never be reopened or rewritten. Nothing is upserted either — an absent row
 * stays absent rather than being backfilled.
 */
export const confirmJournalEntryByGroupId = async ({
  miner_key,
  groupId,
  txId
}: ConfirmJournalByGroupParams): Promise<boolean> => {
  if (!miner_key || !groupId || !txId) {
    return false;
  }

  const collection = await ensureJournal();
  const result = await collection.updateOne(
    {
      miner_key,
      'metadata.groupId': groupId,
      status: { $in: ['pending', 'submitted'] }
    } as Filter<DeviceTransactionJournal>,
    {
      $set: {
        status: 'confirmed',
        txId,
        updatedAt: new Date()
      }
    }
  );

  return (result.modifiedCount ?? 0) > 0;
};
