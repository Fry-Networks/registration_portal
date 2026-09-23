import type { Collection, Document, Filter, UpdateFilter, WithId } from 'mongodb';
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
  /**
   * The settled identifier for this attempt. For a user-pays claim group this is the
   * ASSET-TRANSFER leg (the transaction that actually moved the reward), which is NOT the id
   * algod answers `sendRawTransaction` with - that one is group member 0, the user's ALGO gas
   * payment. `txIdSource` says which of the two ended up here, and the gas id is kept beside it
   * at `metadata.gasTxId` so the audit row and the weekly/daily reward entries (which still
   * store the gas id) remain joinable.
   */
  txId?: string;
  txIdSource?: 'asset-transfer' | 'group-gas-fallback';
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
  /**
   * `open` starts the attempt: it allocates the row this request will write to and returns its
   * key. `update` (the default) writes to a row an `open` already returned, and never creates
   * one. Only `withDeviceActionLock` calls this, and only in that order.
   */
  phase?: 'open' | 'update';
}

/** A row in this status is a settled record of a finished attempt: it is never rewritten. */
const SETTLED_JOURNAL_STATUS: DeviceTransactionJournal['status'] = 'confirmed';

/** Bound on the attempt escalation below; far above any device's 90-day settled-claim count. */
const MAX_JOURNAL_ATTEMPTS = 50;

/**
 * The journal key for attempt N of a base idempotency key. Attempt 1 keeps the bare base key, so
 * every row written before this change keeps its identity and nothing needs backfilling.
 */
export const attemptIdempotencyKey = (baseKey: string, attempt: number): string =>
  attempt <= 1 ? baseKey : `${baseKey}#${attempt}`;

/**
 * One journal row records ONE attempt, and a settled attempt is immutable.
 *
 * The idempotency key derived in lib/api/deviceAction.ts is a pure hash of the request body, and
 * Claim.tsx posts the identical body `{miner_key}` for every claim-all, so every claim a device
 * ever makes hashes to the same key. Because this collection is keyed unique(miner_key,
 * idempotencyKey), the old unconditional upsert meant the next claim $set status:'pending',
 * txId:null straight back over the settlement /api/rewards/confirm had written: measured in the
 * R12 sweep, 2490 claim rows across 976 devices, 260 of them reused after more than 24 h and one
 * after 1529.7 h. The settled record simply did not survive.
 *
 * The `open` phase therefore refuses to touch a row that is already `confirmed`. Because the
 * filter excludes it, the upsert's insert collides with the unique index (E11000) and the attempt
 * escalates to the next key (`<base>`, `<base>#2`, `<base>#3`, ...), leaving the settled row
 * exactly as it was. A row that is NOT settled (`pending`/`submitted`/`failed`) is still reused,
 * so a genuine duplicate or abandoned submit collapses into a single attempt row exactly as
 * before - the only thing that changed is that a settlement is now permanent.
 *
 * `open` also stamps `createdAt`, rather than `$setOnInsert`-ing it. The 90-day TTL index is on
 * `createdAt`, so a settlement landing in a reused months-old row used to expire on the ORIGINAL
 * row's clock; every attempt now starts its own retention window.
 *
 * Returns the key of the row this attempt owns. `withDeviceActionLock` passes it back on the
 * later `update` calls so a single request always writes exactly one row.
 */
export const appendJournalEntry = async (params: AppendJournalEntryParams): Promise<string> => {
  const collection = await ensureJournal();
  const now = new Date();
  const phase = params.phase ?? 'update';

  const fields = {
    action: params.action,
    walletAddress: params.walletAddress,
    request: params.request,
    status: params.status ?? 'pending',
    txId: params.txId,
    error: params.error,
    metadata: params.metadata,
    updatedAt: now
  };

  if (phase === 'update') {
    // Addresses the row `open` already returned. Never upserts (an absent row stays absent) and
    // never moves a row out of `confirmed` - if the settlement writeback won the race, the
    // in-flight status is simply dropped rather than undoing it.
    await collection.updateOne(
      {
        miner_key: params.miner_key,
        idempotencyKey: params.idempotencyKey,
        status: { $ne: SETTLED_JOURNAL_STATUS }
      } as Filter<DeviceTransactionJournal>,
      { $set: fields } as UpdateFilter<DeviceTransactionJournal>,
      { upsert: false }
    );
    return params.idempotencyKey;
  }

  for (let attempt = 1; attempt <= MAX_JOURNAL_ATTEMPTS; attempt += 1) {
    const idempotencyKey = attemptIdempotencyKey(params.idempotencyKey, attempt);
    try {
      await collection.updateOne(
        {
          miner_key: params.miner_key,
          idempotencyKey,
          status: { $ne: SETTLED_JOURNAL_STATUS }
        } as Filter<DeviceTransactionJournal>,
        { $set: { ...fields, createdAt: now } } as UpdateFilter<DeviceTransactionJournal>,
        { upsert: true }
      );
      return idempotencyKey;
    } catch (error: any) {
      // The only way this upsert can collide is a SETTLED row holding this key: the filter
      // excluded it, so mongo tried to insert a second row with the same unique key. Step to the
      // next attempt key instead of reopening the settlement.
      if (error?.code === 11000) {
        continue;
      }
      throw error;
    }
  }

  throw new Error(
    `Unable to open a device_transactions attempt row for ${params.miner_key} after ${MAX_JOURNAL_ATTEMPTS} attempts`
  );
};

export interface ConfirmJournalByGroupParams {
  miner_key: string;
  groupId: string;
  /** The identifier that belongs on the audit row: the asset-transfer leg when it is known. */
  txId: string;
  /** Group member 0 - the user's gas payment - which is what algod returned and what the
   *  weekly/daily reward entries and the 200 response carry. Stored so the two surfaces join. */
  gasTxId?: string;
  /** Every reward leg of this group that paid the claimer, in group order. */
  assetTxIds?: string[];
  /** Says which leg `txId` came from, so a reader never has to guess. */
  txIdSource?: DeviceTransactionJournal['txIdSource'];
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
 *
 * Two identifiers exist for one settled group and they are NOT interchangeable: `txId` is the
 * asset-transfer leg that moved the reward, `gasTxId` is group member 0 (the user's ALGO
 * payment), which is what algod returns and what the reward entries and the 200 response store.
 * Both are persisted here, discriminated by `txIdSource`, so the two surfaces can be joined.
 */
export const confirmJournalEntryByGroupId = async ({
  miner_key,
  groupId,
  txId,
  gasTxId,
  assetTxIds,
  txIdSource
}: ConfirmJournalByGroupParams): Promise<boolean> => {
  if (!miner_key || !groupId || !txId) {
    return false;
  }

  // Dotted paths: the row's metadata already carries what /claim wrote (groupId, totals, mode)
  // and a whole-object $set would drop it - including the groupId this very filter matches on.
  const settlement: Record<string, unknown> = {
    status: 'confirmed',
    txId,
    updatedAt: new Date()
  };
  if (txIdSource) {
    settlement.txIdSource = txIdSource;
  }
  if (gasTxId) {
    settlement['metadata.gasTxId'] = gasTxId;
  }
  if (assetTxIds && assetTxIds.length > 0) {
    settlement['metadata.assetTxIds'] = assetTxIds;
  }

  const collection = await ensureJournal();
  const result = await collection.updateOne(
    {
      miner_key,
      'metadata.groupId': groupId,
      status: { $in: ['pending', 'submitted'] }
    } as Filter<DeviceTransactionJournal>,
    { $set: settlement } as UpdateFilter<DeviceTransactionJournal>,
    { upsert: false }
  );

  return (result.modifiedCount ?? 0) > 0;
};
