import type { Collection, Document, WithId } from 'mongodb';
import type { ObjectId } from 'mongodb';
import clientPromise from '../mongoclient';

export type DeviceAction =
  | 'claim'
  | 'boost'
  | 'stake:registration'
  | 'stake:node'
  | 'stake:verification'
  | 'withdraw:registration'
  | 'withdraw:node'
  | 'withdraw:verification'
  | 'withdraw:verification_check'
  | 'fee:withdraw'
  | 'fee:verify';

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
