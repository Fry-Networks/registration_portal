import crypto from 'node:crypto';
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
   *
   * The server-pays (custodial) claim path has no user gas leg at all: it signs the whole group
   * itself and stores the id algod answered `sendRawTransaction` with, i.e. group member 0. That
   * id is discriminated as `custodial-group`, so `txIdSource` is set on EVERY settled claim row
   * and a reader never has to infer the path from the absence of a field.
   */
  txId?: string;
  txIdSource?: 'asset-transfer' | 'group-gas-fallback' | 'custodial-group';
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
  txIdSource?: DeviceTransactionJournal['txIdSource'];
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

const ATTEMPT_KEY_SEPARATOR = '#';

/**
 * Collision backstop for the minted attempt key below. It is NOT an attempt budget: the key is
 * unique by construction, so the first insert is the one that succeeds and this loop does not run
 * in normal operation. See `mintAttemptKey`.
 */
const MAX_MINTED_KEY_COLLISIONS = 5;

/**
 * A monotonic, per-process millisecond stamp. `Date.now()` repeats within a millisecond (and steps
 * backwards across an NTP correction); this never does, so two attempts opened by the same process
 * in the same millisecond still mint different keys without reading the collection first.
 */
let lastMintedAttemptStamp = 0;
const nextAttemptStamp = (): number => {
  const now = Date.now();
  lastMintedAttemptStamp = now > lastMintedAttemptStamp ? now : lastMintedAttemptStamp + 1;
  return lastMintedAttemptStamp;
};

/**
 * The key for a NEW attempt on `baseKey`: `<base>#<monotonic ms, base36>-<64 bits of CSPRNG>`.
 *
 * It is unique by construction rather than by search, which is the whole point. The previous
 * scheme walked a SEQUENCE (`<base>`, `<base>#2`, `<base>#3`, ...) and every settled row on the
 * way was a permanent occupant for its 90-day TTL, so the walk got one step longer per settled
 * claim and hit its ceiling at 50. Nothing here depends on how many rows the device already owns.
 *
 * Two attempts can only mint the same key if they land in the same millisecond in DIFFERENT
 * processes (the stamp is monotonic within one) and independently draw the same 64-bit random
 * value - about 1 in 1.8e19 per same-millisecond pair. That is why the retry loop below is a
 * backstop and not a budget.
 */
const mintAttemptKey = (baseKey: string): string =>
  `${baseKey}${ATTEMPT_KEY_SEPARATOR}${nextAttemptStamp().toString(36)}-${crypto.randomBytes(8).toString('hex')}`;

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Matches exactly the escalated keys this module can ever have minted for `baseKey`: the legacy
 * `#2`..`#50` sequence written before this change, and the `#<base36 ms>-<16 hex>` form above.
 * Anchored, and always paired with an equality on `miner_key`, so mongo serves it from
 * unique(miner_key, idempotencyKey) rather than scanning.
 *
 * Deliberately NOT a bare `^<base>#` prefix: a client may pin its own key with `x-idempotency-key`,
 * and two client keys of which one is a `#`-prefix of the other must not reach each other's rows.
 */
const escalatedAttemptKeyPattern = (baseKey: string): RegExp =>
  new RegExp(`^${escapeRegExp(baseKey)}${ATTEMPT_KEY_SEPARATOR}([0-9]+|[0-9a-z]+-[0-9a-f]{16})$`);

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
 * takes a key of its own, leaving the settled row exactly as it was. A row that is NOT settled
 * (`pending`/`submitted`/`failed`) is still reused, so a genuine duplicate or abandoned submit
 * collapses into a single attempt row exactly as before - the only thing that changed is that a
 * settlement is now permanent.
 *
 * That escalation must not itself be a budget. It originally walked a sequence (`<base>#2`,
 * `<base>#3`, ...) bounded at 50 while the rows it walked past were only removed by the 90-day
 * TTL, so every settled claim consumed one key for 90 days and the 51st claim in that window threw
 * - an availability hole on the money path, and 90 daily claims in a 90-day window is ordinary
 * use. The escalated key is now MINTED (`mintAttemptKey`) instead of searched for, so the first
 * insert succeeds regardless of how many settled rows the device already owns.
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
    txIdSource: params.txIdSource,
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

  // Attempt 1 is the BARE base key: every row written before the attempt scheme existed keeps its
  // identity, nothing needs backfilling, and a still-open attempt (pending/submitted/failed) under
  // that key is REUSED, so a genuine duplicate or an abandoned submit still collapses into one row.
  try {
    await collection.updateOne(
      {
        miner_key: params.miner_key,
        idempotencyKey: params.idempotencyKey,
        status: { $ne: SETTLED_JOURNAL_STATUS }
      } as Filter<DeviceTransactionJournal>,
      { $set: { ...fields, createdAt: now } } as UpdateFilter<DeviceTransactionJournal>,
      { upsert: true }
    );
    return params.idempotencyKey;
  } catch (error: any) {
    // The only way this upsert can collide is a SETTLED row holding the base key: the filter
    // excluded it, so mongo tried to insert a second row with the same unique key.
    if (error?.code !== 11000) {
      throw error;
    }
  }

  // The base key belongs to that settled row for the rest of its 90 days. If an EARLIER escalated
  // attempt is still open, reuse it, so the reuse property holds past the first settlement too and
  // an abandoned submit still does not multiply rows.
  const openAttempt = await collection.findOne({
    miner_key: params.miner_key,
    idempotencyKey: escalatedAttemptKeyPattern(params.idempotencyKey),
    status: { $ne: SETTLED_JOURNAL_STATUS }
  } as Filter<DeviceTransactionJournal>);

  if (openAttempt?.idempotencyKey) {
    const reused = await collection.updateOne(
      {
        miner_key: params.miner_key,
        idempotencyKey: openAttempt.idempotencyKey,
        status: { $ne: SETTLED_JOURNAL_STATUS }
      } as Filter<DeviceTransactionJournal>,
      { $set: { ...fields, createdAt: now } } as UpdateFilter<DeviceTransactionJournal>,
      { upsert: false }
    );
    if ((reused.matchedCount ?? 0) > 0) {
      return openAttempt.idempotencyKey;
    }
    // It settled between the read and the write. Fall through and take a key of this attempt's own
    // rather than touching it.
  }

  // Mint a key that is unique by construction, so the FIRST insert succeeds however many settled
  // rows this device already owns. There is no sequence to walk and therefore no ceiling: a device
  // can settle an unbounded number of claims inside one 90-day TTL window.
  for (let collision = 0; collision < MAX_MINTED_KEY_COLLISIONS; collision += 1) {
    const idempotencyKey = mintAttemptKey(params.idempotencyKey);
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
      // Unreachable in normal operation (see `mintAttemptKey`): it needs a same-millisecond,
      // cross-process, 64-bit random collision with a SETTLED row. Re-mint rather than reopen it.
      if (error?.code === 11000) {
        continue;
      }
      throw error;
    }
  }

  throw new Error(
    `Unable to open a device_transactions attempt row for ${params.miner_key}: ` +
      `${MAX_MINTED_KEY_COLLISIONS} independently minted attempt keys collided`
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
