import { collectionFor } from '../pages/api/credentials/utils';
import { latLngToCell } from 'h3-js';

/**
 * Migration: copy position.lat/lng from main.devices -> creds.<collection>
 * and compute resolution-7 H3 cell (stored as position.hexId) for existing
 * creds documents only.
 *
 * Usage (from repo root):
 *   npx ts-node --compiler-options '{"module":"commonjs"}' scripts/migrate-populate-hexid.ts [--dry-run] [--limit N]
 *
 * Options:
 *   --dry-run    : Print what would be updated without mutating the DB
 *   --limit N    : Stop after N processed devices
 */
async function run() {
  // CLI args
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const limitArgIndex = args.findIndex((a) => a === '--limit');
  const limit = limitArgIndex >= 0 && args[limitArgIndex + 1] ? Number(args[limitArgIndex + 1]) : undefined;
  // New option: restrict migration to the first N distinct miner_key values
  const firstMinerKeysArgIndex = args.findIndex((a) => a === '--first-miner-keys');
  const firstMinerKeys = firstMinerKeysArgIndex >= 0 && args[firstMinerKeysArgIndex + 1] ? Number(args[firstMinerKeysArgIndex + 1]) : undefined;

  // Allow passing MONGO_URI inline via --mongo-uri, otherwise fall back to env
  const mongoUriArgIndex = args.findIndex((a) => a === '--mongo-uri');
  const cliMongoUri = mongoUriArgIndex >= 0 && args[mongoUriArgIndex + 1] ? args[mongoUriArgIndex + 1] : undefined;
  let uri = cliMongoUri || process.env.MONGO_URI;

  // If no URI yet, try to read from 1Password CLI using helper env vars.
  // Supported helpers (set in your shell or environment):
  // - OP_MONGO_OP_PATH : an op:// vault/item/field path usable with `op read` (preferred)
  // - OP_MONGO_ITEM    : an item id or name usable with `op item get <item> --field <field>`
  // - OP_MONGO_FIELD   : the field name inside the item (default: 'MONGO_URI')
  if (!uri) {
  const opPath = process.env.OP_MONGO_OP_PATH || process.env.MONGO_URI_OP;
    const opItem = process.env.OP_MONGO_ITEM;
    const opField = process.env.OP_MONGO_FIELD || 'MONGO_URI';
    if (opPath || opItem) {
      try {
        // use require here so script still loads without op installed
        // prefer op read when opPath is provided
        const cp = require('child_process');
        if (opPath) {
          console.log(`Attempting to read Mongo URI from 1Password path: ${opPath}`);
          const out = cp.execFileSync('op', ['read', opPath], { encoding: 'utf8' });
          uri = out.trim();
          console.log('Loaded Mongo URI from 1Password (op read)');
        } else {
          console.log(`Attempting to read Mongo URI from 1Password item: ${opItem} (field=${opField})`);
          const out = cp.execFileSync('op', ['item', 'get', opItem, '--field', opField], { encoding: 'utf8' });
          uri = out.trim();
          console.log('Loaded Mongo URI from 1Password (op item get)');
        }
      } catch (err: any) {
        console.error('Failed to read MONGO_URI from 1Password CLI:', err && err.message ? err.message : String(err));
      }
    }
  }

  if (!uri) {
    console.error('Missing MongoDB connection string. Set MONGO_URI env, pass --mongo-uri "<uri>", or configure OP_MONGO_OP_PATH / OP_MONGO_ITEM to read from 1Password.');
    process.exit(2);
  }

  // connect using mongodb directly to avoid importing project mongoclient (which expects env at module load)
  const { MongoClient } = await import('mongodb');
  const client = new MongoClient(uri);
  await client.connect();

  const mainDb = client.db('main');
  const credsDbName = process.env.MONGO_CREDS_DB ?? 'creds';
  const credsDb = client.db(credsDbName);
  console.log('Starting migration: main.devices ->', credsDbName, dryRun ? '(dry-run)' : '');

  const devicesColl = mainDb.collection('devices');

  // Find devices that have a lat/lng position defined (we will compute hexId)
  // If requested, collect the first N distinct miner_key values and only process those.
  let allowedMinerKeys: Set<string> | undefined = undefined;
  if (firstMinerKeys && Number.isFinite(firstMinerKeys) && firstMinerKeys > 0) {
    console.log(`Limiting migration to first ${firstMinerKeys} distinct miner_key values...`);
    const agg = devicesColl.aggregate([
      { $match: { 'position.lat': { $exists: true }, 'position.lng': { $exists: true } } },
      { $group: { _id: '$miner_key' } },
      { $limit: firstMinerKeys },
    ], { allowDiskUse: false });
    const keys: string[] = [];
    while (await agg.hasNext()) {
      const r = await agg.next();
      if (r && r._id) keys.push(String(r._id));
    }
    allowedMinerKeys = new Set(keys);
    console.log(`Allowed miner_keys: ${keys.slice(0, 20).join(', ')}${keys.length > 20 ? ', ...' : ''}`);
  }

  const cursor = devicesColl.find(
    { 'position.lat': { $exists: true }, 'position.lng': { $exists: true } },
    { projection: { miner_key: 1, address: 1, position: 1 } }
  );

  let count = 0;
  const plannedUpdates: Array<{ miner_key: string; collection: string; hexId: string }> = [];
  const updatedCollections = new Set<string>();

  while (await cursor.hasNext()) {
    const doc = await cursor.next();
    if (!doc) continue;

    const miner_key = doc.miner_key as string | undefined;
    const address = doc.address as string | undefined;
    const position = (doc.position ?? {}) as any;
    const lat = position.lat ?? null;
    const lng = position.lng ?? null;

  if (!miner_key || lat === null || lng === null) continue;
  if (allowedMinerKeys && !allowedMinerKeys.has(miner_key)) continue;

    const collectionName = collectionFor({ miner_key });
    const targetColl = credsDb.collection(collectionName);

    // Only update miner_keys that already exist in the creds collection
    const existingCount = await targetColl.countDocuments({ miner_key });
    if (!existingCount) {
      // skip, no credentials stored for this miner_key
      continue;
    }

    // compute hexId (res 7) from lat/lng
    const latNum = Number(lat);
    const lngNum = Number(lng);
    if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) continue;
    const hexId = latLngToCell(latNum, lngNum, 7);

    const filter: any = { miner_key };
    const update: any = {
      $set: {
        position: {
          lat: latNum,
          lng: lngNum,
          hexId: hexId,
        },
        position_saved_at: new Date(),
      },
    };

    if (dryRun) {
      plannedUpdates.push({ miner_key, collection: collectionName, hexId });
    } else {
      await targetColl.updateMany(filter, update, { upsert: false });
      updatedCollections.add(collectionName);
    }

    count += 1;
    if (count % 100 === 0) console.log(dryRun ? `Planned ${count} updates...` : `Migrated ${count} devices...`);
    if (limit && count >= limit) break;
  }

  if (dryRun) {
    console.log(`Dry-run: ${plannedUpdates.length} planned updates.`);
    plannedUpdates.slice(0, 20).forEach((p) => console.log(`Would update miner_key=${p.miner_key} in collection=${p.collection} -> hexId=${p.hexId}`));
    if (plannedUpdates.length > 20) console.log(`...and ${plannedUpdates.length - 20} more`);
    process.exit(0);
  }

  // Create an index on position.hexId for each updated collection
  for (const collName of Array.from(updatedCollections)) {
    try {
      console.log(`Creating index on ${credsDbName}.${collName}.position.hexId ...`);
      const coll = credsDb.collection(collName);
      await coll.createIndex({ 'position.hexId': 1 }, { name: 'position_hexId_idx' });
      console.log(`Index created on ${credsDbName}.${collName}.position.hexId`);
    } catch (err) {
      console.error(`Failed to create index on ${credsDbName}.${collName}:`, err);
    }
  }

  console.log(`Migration complete. ${count} devices migrated.`);
  process.exit(0);
}

run().catch((err) => {
  console.error('Migration failed', err);
  process.exit(1);
});
