/**
 * Stake History Migration
 * -----------------------
 * Purpose:
 *   - Retrofits legacy stake documents in the `devices` collection so they
 *     match the new audit schema used by the dashboard.
 *   - Reconstructs missing withdrawal history (`lastWithdrawal` + `withdrawals[]`) for
 *     verification, registration, and node stakes by looking up the original Algorand
 *     transactions. The script decodes transaction notes to recover the lock type, amount,
 *     and asset id whenever those fields were zeroed out during earlier withdrawals.
 *   - Backfills the stake `type` for active stakes when it was never recorded.
 *
 * How it works:
 *   1. Iterates every device in `devices` whose stake/state suggests legacy data.
 *   2. For each stake segment (`staked`, `registration`, `node`), it:
 *        - Fetches the stake transaction from the Algorand indexer to infer the lock type if missing.
 *        - Detects withdrawn stakes that still have `txId` but `amount <= 0`. For these, it retrieves
 *          the withdrawal transaction, decodes the note/amount, and appends a structured withdrawal
 *          entry while clearing the active stake fields.
 *   3. Updates MongoDB in batches of 100 documents (unless running in dry-run mode).
 *
 * Usage:
 *    op run --env-file=.env -- \
  npm run migrate-stake-history -- --dry-run [options]
 *
 * Options:
 *   --dry-run, -n       : Analyze and log changes without writing to MongoDB.
 *   --verbose, -v       : (Default) Print per-device actions that would be taken.
 *   --no-verbose        : Disable per-device action logs.
 *   --quiet, -q         : Suppress all non-error logs (overrides verbose).
 *
 * Notes:
 *   - Requires Algorand indexer access (env vars: ALGONAND_INDEXER_URL/TOKEN optional).
 *   - Ensure Mongo credentials in `clientPromise` are configured before running.
 */
import axios from 'axios';
import { Buffer } from 'buffer';
import type { Collection, Document, WithId, UpdateFilter } from 'mongodb';
import clientPromise from '../lib/mongoclient';

const COLLECTIONS = ['devices'] as const;
const BATCH_SIZE = 100;
const INDEXER_URL =
  process.env.ALGORAND_INDEXER_URL?.replace(/\/+$/, '') || 'https://mainnet-idx.algonode.cloud';
const INDEXER_TOKEN = process.env.ALGORAND_INDEXER_TOKEN;

type DeviceDoc = WithId<Document> & {
  staked?: any;
  registration?: any;
  node?: any;
};

type StakeKey = 'staked' | 'registration' | 'node';

type MutableUpdate = UpdateFilter<Document> & {
  $push?: Record<string, { $each: any[] }>;
};

const MICRO_FACTOR = 1_000_000;

type TransactionMeta = {
  amount: number | null;
  assetId: string | null;
  timestamp: Date | null;
  lockType: string | null;
};

const indexer = axios.create({
  baseURL: INDEXER_URL,
  headers: INDEXER_TOKEN ? { 'X-API-Key': INDEXER_TOKEN } : undefined,
  timeout: 15_000
});

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run') || args.has('-n');
const quiet = args.has('--quiet') || args.has('-q');
const suppressVerbose = args.has('--no-verbose');
const verbose = quiet ? false : (args.has('--verbose') || args.has('-v') || !suppressVerbose);

async function fetchTransaction(txId: string): Promise<any | null> {
  if (!txId) return null;
  try {
    const { data } = await indexer.get(`/v2/transactions/${txId}`);
    return data?.transaction ?? null;
  } catch (error) {
    console.warn(`[indexer] Failed to fetch ${txId}: ${(error as Error).message}`);
    return null;
  }
}

type ParsedNoteMeta = {
  lockType: string | null;
  amount: number | null;
  assetId: string | null;
};

function parseNoteForMeta(note: string | undefined): ParsedNoteMeta {
  if (!note) return { lockType: null, amount: null, assetId: null };
  try {
    const decoded = Buffer.from(note, 'base64').toString('utf8').trim();
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
      // Not JSON; fall through to regex checks
    }
    const match = decoded.match(/\"type\"\s*:\s*\"(one|two)\"/i);
    if (!lockType && match && match[1]) lockType = match[1].toLowerCase();
    return { lockType, amount, assetId };
  } catch {
    return { lockType: null, amount: null, assetId: null };
  }
}

const normaliseAmount = (value: unknown): number | null => {
  if (typeof value === 'number') {
    return value / MICRO_FACTOR;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed / MICRO_FACTOR : null;
  }
  if (typeof value === 'bigint') {
    return Number(value) / MICRO_FACTOR;
  }
  return null;
};

function extractMetaFromTransaction(tx: any): TransactionMeta {
  if (!tx) {
    return { amount: null, assetId: null, timestamp: null, lockType: null };
  }

  const assetTransfer = tx['asset-transfer-transaction'];
  const noteMeta = parseNoteForMeta(tx?.note);
  const amount =
    noteMeta.amount ??
    normaliseAmount(
      typeof assetTransfer?.amount !== 'undefined'
        ? assetTransfer.amount
        : typeof tx?.amount !== 'undefined'
        ? tx.amount
        : undefined
    );
  const assetId = noteMeta.assetId
    ? String(noteMeta.assetId)
    : assetTransfer?.['asset-id']
    ? String(assetTransfer['asset-id'])
    : typeof tx?.['asset-index'] !== 'undefined'
    ? String(tx['asset-index'])
    : null;

  const roundTime =
    typeof tx['round-time'] === 'number' ? new Date(tx['round-time'] * 1000) : null;

  const lockType = noteMeta.lockType;

  return { amount, assetId, timestamp: roundTime, lockType };
}

function ensurePushContainer(update: MutableUpdate, key: string) {
  if (!update.$push) update.$push = {};
  if (!update.$push[key]) update.$push[key] = { $each: [] };
}

function appendHistoryEntry(update: MutableUpdate, path: string, entry: any) {
  ensurePushContainer(update, path);
  update.$push![path]!.$each.push(entry);
}

async function enrichSegment(
  doc: DeviceDoc,
  key: StakeKey,
  actions: string[]
): Promise<MutableUpdate | null> {
  const segment = doc[key];
  if (!segment) return null;

  const update: MutableUpdate = { $set: {} };
  let changed = false;

  // 1) Ensure we know the lock type for active stakes.
  if (!segment.type && segment.txId) {
    const stakeTx = await fetchTransaction(segment.txId);
    const { lockType } = extractMetaFromTransaction(stakeTx);
    if (lockType) {
      update.$set![`${key}.type`] = lockType;
      changed = true;
      if (verbose) {
        actions.push(`[${key}] set lock type "${lockType}" from stake tx ${segment.txId}`);
      }
    }
  }

  const withdrawals = Array.isArray(segment.withdrawals) ? segment.withdrawals : [];
  const hasWithdrawalRecord =
    withdrawals.length > 0 &&
    segment.lastWithdrawal &&
    withdrawals.some((entry: any) => entry?.txId === segment.lastWithdrawal?.txId);

  const needsLegacyWithdrawal =
    (!segment.lastWithdrawal || !hasWithdrawalRecord) &&
    (!segment.amount || Number(segment.amount) <= 0) &&
    segment.txId;

  if (needsLegacyWithdrawal) {
    const withdrawalTx = await fetchTransaction(segment.txId);
    const { amount, assetId, timestamp, lockType } = extractMetaFromTransaction(withdrawalTx);

    if (!amount || !timestamp) {
      console.warn(
        `[migration] Unable to infer withdrawal details for ${doc._id.toString()} (${key})`
      );
    } else {
      const withdrawalRecord: Record<string, unknown> = {
        amount,
        txId: segment.txId,
        time: timestamp,
        asset_id: assetId ?? segment.asset_id ?? null
      };
      if (lockType) withdrawalRecord.type = lockType;

      appendHistoryEntry(update, `${key}.withdrawals`, withdrawalRecord);
      update.$set![`${key}.lastWithdrawal`] = withdrawalRecord;
      update.$set![`${key}.amount`] = null;
      update.$set![`${key}.txId`] = null;
      update.$set![`${key}.time`] = null;
      update.$set![`${key}.asset_id`] = null; // Null asset_id for withdrawn stakes (Option 2)
      if (key === 'staked') {
        update.$set!.verified = false;
        update.$set![`${key}.type`] = null; // Null type for withdrawn stakes (Option 2)
      }

      changed = true;
      const formattedAmount = amount.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      });
      actions.push(
        `[${key}] recorded withdrawal ${segment.txId} amount=${formattedAmount} asset=${withdrawalRecord.asset_id ?? 'unknown'}`
      );
    }
  }

  if (!changed) return null;

  if (update.$set && Object.keys(update.$set).length === 0) delete update.$set;
  if (update.$push) {
    for (const path of Object.keys(update.$push)) {
      if (update.$push[path].$each.length === 0) {
        delete update.$push[path];
      }
    }
    if (Object.keys(update.$push).length === 0) delete update.$push;
  }

  return update;
}

function mergeUpdates(target: MutableUpdate, source: MutableUpdate | null) {
  if (!source) return;
  if (source.$set) {
    if (!target.$set) target.$set = {};
    Object.assign(target.$set, source.$set);
  }
  if (source.$push) {
    if (!target.$push) target.$push = {};
    for (const key of Object.keys(source.$push)) {
      ensurePushContainer(target, key);
      target.$push![key]!.$each.push(...source.$push[key].$each);
    }
  }
}

async function migrateCollection(collection: Collection<Document>): Promise<void> {
  const cursor = collection.find({
    $or: [
      {
        'staked.txId': { $exists: true, $ne: null },
        'staked.lastWithdrawal': { $exists: false }
      },
      {
        'registration.txId': { $exists: true, $ne: null },
        'registration.lastWithdrawal': { $exists: false }
      },
      {
        'node.txId': { $exists: true, $ne: null },
        'node.lastWithdrawal': { $exists: false }
      },
      {
        'staked.type': { $in: [null, undefined] },
        'staked.txId': { $exists: true, $ne: null }
      }
    ]
  });

  const bulkOps: any[] = [];
  let processed = 0;
  let updated = 0;

  while (await cursor.hasNext()) {
    const doc = (await cursor.next()) as DeviceDoc | null;
    if (!doc) continue;
    processed += 1;

    const aggregateUpdate: MutableUpdate = {};
    const actions: string[] = [];
    mergeUpdates(aggregateUpdate, await enrichSegment(doc, 'staked', actions));
    mergeUpdates(aggregateUpdate, await enrichSegment(doc, 'registration', actions));
    mergeUpdates(aggregateUpdate, await enrichSegment(doc, 'node', actions));

    if (!aggregateUpdate.$set && !aggregateUpdate.$push) continue;

    const identifier = (doc as any)?.miner_key || doc._id.toString();
    updated += 1;

    if (verbose && actions.length > 0) {
      const prefix = dryRun ? '[DRY-RUN] ' : '';
      console.log(
        `${prefix}[${collection.collectionName}] ${identifier} -> ${actions.join('; ')}`
      );
    }

    if (dryRun) {
      continue;
    }

    bulkOps.push({ updateOne: { filter: { _id: doc._id }, update: aggregateUpdate } });

    if (bulkOps.length >= BATCH_SIZE) {
      await collection.bulkWrite(bulkOps, { ordered: false });
      bulkOps.length = 0;
      console.log(
        `[${collection.collectionName}] migrated ${updated}/${processed} records so far.`
      );
    }
  }

  if (bulkOps.length > 0) {
    await collection.bulkWrite(bulkOps, { ordered: false });
    console.log(`[${collection.collectionName}] migrated final ${bulkOps.length} records.`);
  }

  console.log(
    `[${collection.collectionName}] processed ${processed} records, ${
      dryRun ? 'would migrate' : 'migrated'
    } ${updated}.`
  );
}

async function run(): Promise<void> {
  console.log(
    `[migration] Starting stake history migration${dryRun ? ' (dry run)' : ''}${
      verbose ? ' with verbose logging' : ''
    }`
  );
  const client = await clientPromise;
  try {
    const db = client.db('main');

    for (const name of COLLECTIONS) {
      const collectionExists = await db.listCollections({ name }).hasNext();
      if (!collectionExists) {
        console.log(`[${name}] collection not found, skipping.`);
        continue;
      }

      console.log(`[${name}] scanning for legacy stake records…`);
      const collection = db.collection(name);
      await migrateCollection(collection);
    }
  } finally {
    await client.close();
  }
}

run()
  .then(() => {
    console.log(`Stake history migration ${dryRun ? 'dry run ' : ''}complete.`);
    process.exit(0);
  })
  .catch((error) => {
    console.error('Stake history migration failed', error);
    process.exit(1);
  });
