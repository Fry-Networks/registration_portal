import { collectionFor } from '../pages/api/credentials/utils';
import { latLngToCell } from 'h3-js';
import 'dotenv/config';

/**
 * Two-Phase Migration:
 *
 * Phase 1: Clean up existing creds documents
 *   - Find all creds documents that already have position data
 *   - Fix schema: move hexId inside position object if it's currently outside
 *   - Remove position from main.devices for these devices (creds is source of truth)
 *
 * Phase 2: Migrate remaining devices from main.devices -> creds
 *   - Copy position.lat/lng from main.devices -> creds.<collection>
 *   - Compute resolution-7 H3 cell (stored as position.hexId)
 *   - Creates new documents in creds collections if they don't exist (upsert)
 *   - Remove position from main.devices after successful migration
 *
 * Result: All position data lives in creds collections with consistent schema:
 *   position: { lat: number, lng: number, hexId: string }
 *
 * Usage (from repo root):
 *   npx ts-node --compiler-options '{"module":"commonjs"}' scripts/migrate-populate-hexid.ts [--dry-run] [--limit N]
 *
 * Options:
 *   --dry-run            : Print what would be updated without mutating the DB
 *   --limit N            : Stop after N processed devices (Phase 2 only)
 *   --first-miner-keys N : Limit to first N distinct miner_key values (Phase 2 only)
 */
async function run() {
  // CLI args
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const limitArgIndex = args.findIndex((a) => a === '--limit');
  const limit =
    limitArgIndex >= 0 && args[limitArgIndex + 1]
      ? Number(args[limitArgIndex + 1])
      : undefined;
  // New option: restrict migration to the first N distinct miner_key values
  const firstMinerKeysArgIndex = args.findIndex(
    (a) => a === '--first-miner-keys'
  );
  const firstMinerKeys =
    firstMinerKeysArgIndex >= 0 && args[firstMinerKeysArgIndex + 1]
      ? Number(args[firstMinerKeysArgIndex + 1])
      : undefined;
  const checkResidualOnly = args.includes('--check-residual');

  // Allow passing MONGO_URI inline via --mongo-uri, otherwise fall back to env
  const mongoUriArgIndex = args.findIndex((a) => a === '--mongo-uri');
  const cliMongoUri =
    mongoUriArgIndex >= 0 && args[mongoUriArgIndex + 1]
      ? args[mongoUriArgIndex + 1]
      : undefined;
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
          console.log(
            `Attempting to read Mongo URI from 1Password path: ${opPath}`
          );
          const out = cp.execFileSync('op', ['read', opPath], {
            encoding: 'utf8'
          });
          uri = out.trim();
          console.log('Loaded Mongo URI from 1Password (op read)');
        } else {
          console.log(
            `Attempting to read Mongo URI from 1Password item: ${opItem} (field=${opField})`
          );
          const out = cp.execFileSync(
            'op',
            ['item', 'get', opItem, '--field', opField],
            { encoding: 'utf8' }
          );
          uri = out.trim();
          console.log('Loaded Mongo URI from 1Password (op item get)');
        }
      } catch (err: any) {
        console.error(
          'Failed to read MONGO_URI from 1Password CLI:',
          err && err.message ? err.message : String(err)
        );
      }
    }
  }

  if (!uri) {
    console.error(
      'Missing MongoDB connection string. Set MONGO_URI env, pass --mongo-uri "<uri>", or configure OP_MONGO_OP_PATH / OP_MONGO_ITEM to read from 1Password.'
    );
    process.exit(2);
  }

  // connect using mongodb directly to avoid importing project mongoclient (which expects env at module load)
  const { MongoClient } = await import('mongodb');
  const client = new MongoClient(uri);
  await client.connect();

  const mainDb = client.db('main');
  const credsDbName = process.env.MONGO_CREDS_DB ?? 'creds';
  const credsDb = client.db(credsDbName);
  const devicesColl = mainDb.collection('devices');

  if (checkResidualOnly) {
    console.log('\n=== Residual Position/hexId Check (main.devices) ===\n');
    const residualFilter = {
      $or: [
        { 'position.lat': { $exists: true } },
        { 'position.lng': { $exists: true } },
        { hexId: { $exists: true } }
      ]
    };

    const totalResidual = await devicesColl.countDocuments(residualFilter);
    const withPosition = await devicesColl.countDocuments({
      $or: [{ 'position.lat': { $exists: true } }, { 'position.lng': { $exists: true } }]
    });
    const withHexId = await devicesColl.countDocuments({ hexId: { $exists: true } });

    console.log(`Devices with residual fields: ${totalResidual}`);
    console.log(`  • With position lat/lng:   ${withPosition}`);
    console.log(`  • With hexId:             ${withHexId}`);

    if (totalResidual === 0) {
      await client.close();
      process.exit(0);
    }

    const residualDocs = await devicesColl
      .find<{
        _id: any;
        miner_key?: string;
        address?: string;
        position?: { lat?: unknown; lng?: unknown } | null;
        hexId?: unknown;
      }>(residualFilter, {
        projection: { _id: 1, miner_key: 1, address: 1, position: 1, hexId: 1 }
      })
      .toArray();

    console.log('\nResidual device list:');
    residualDocs.forEach((doc, index) => {
      const key = doc.miner_key ?? '(unknown miner key)';
      const positionInfo =
        doc.position !== undefined ? JSON.stringify(doc.position) : 'null';
      const hexInfo =
        doc.hexId !== undefined ? JSON.stringify(doc.hexId) : 'null';
      const addressInfo = doc.address ? ` | address=${doc.address}` : '';
      console.log(
        `  [${index + 1}/${residualDocs.length}] ${key}${addressInfo} | position=${positionInfo} | hexId=${hexInfo}`
      );
    });

    const readline = await import('node:readline/promises');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    let deletedCount = 0;
    let wouldDeleteCount = 0;
    let skippedCount = 0;

    try {
      const modeAnswerRaw = await rl.question(
        '\nChoose action: [a] delete all residual fields, [o] review one by one, [s] skip (default s): '
      );
      const mode = modeAnswerRaw.trim().toLowerCase();

      const actAll = mode === 'a' || mode === 'all' || mode === 'y' || mode === 'yes';
      const actOneByOne = mode === 'o' || mode === 'one' || mode === 'each';

      if (actAll) {
        for (const doc of residualDocs) {
          const key = doc.miner_key ?? '(unknown miner key)';
          const unset: Record<string, ''> = {};
          if (doc.position !== undefined) {
            unset['position'] = '';
          }
          if (doc.hexId !== undefined) {
            unset['hexId'] = '';
          }
          if (Object.keys(unset).length === 0) {
            skippedCount += 1;
            continue;
          }

          if (dryRun) {
            wouldDeleteCount += 1;
            console.log(`  [DRY RUN] Would remove residual fields for ${key}.`);
          } else {
            const result = await devicesColl.updateOne(
              { _id: doc._id },
              { $unset: unset }
            );
            if (result.modifiedCount && result.modifiedCount > 0) {
              deletedCount += 1;
              console.log(`  Removed residual fields for ${key}.`);
            } else {
              skippedCount += 1;
            }
          }
        }
      } else if (actOneByOne) {
        for (let index = 0; index < residualDocs.length; index++) {
          const doc = residualDocs[index];
          const key = doc.miner_key ?? '(unknown miner key)';
          const positionInfo =
            doc.position !== undefined ? JSON.stringify(doc.position) : 'null';
          const hexInfo =
            doc.hexId !== undefined ? JSON.stringify(doc.hexId) : 'null';

          console.log(`\n[${index + 1}/${residualDocs.length}] Miner key: ${key}`);
          if (doc.address) {
            console.log(`  Address: ${doc.address}`);
          }
          console.log(`  Position: ${positionInfo}`);
          console.log(`  hexId: ${hexInfo}`);

          const answerRaw = await rl.question(
            'Remove position/hexId from main.devices for this record? (y/N to skip, q to quit): '
          );
          const answer = answerRaw.trim().toLowerCase();

          if (answer === 'q' || answer === 'quit') {
            console.log('Aborting at user request.');
            break;
          }

          if (answer === 'y' || answer === 'yes') {
            const unset: Record<string, ''> = {};
            if (doc.position !== undefined) {
              unset['position'] = '';
            }
            if (doc.hexId !== undefined) {
              unset['hexId'] = '';
            }

            if (Object.keys(unset).length === 0) {
              console.log('  No residual fields detected during update. Skipping.');
              skippedCount += 1;
              continue;
            }

            if (dryRun) {
              wouldDeleteCount += 1;
              console.log(`  [DRY RUN] Would remove residual fields for ${key}.`);
            } else {
              const result = await devicesColl.updateOne(
                { _id: doc._id },
                { $unset: unset }
              );
              if (result.modifiedCount && result.modifiedCount > 0) {
                deletedCount += 1;
                console.log(`  Removed residual fields for ${key}.`);
              } else {
                console.log(
                  '  Update did not modify any documents (fields may have been removed already).'
                );
                skippedCount += 1;
              }
            }
          } else {
            skippedCount += 1;
            console.log('  Skipped.');
          }
        }
      } else {
        console.log('Skipping cleanup (no action taken).');
      }
    } finally {
      rl.close();
    }

    console.log('\nResidual cleanup summary:');
    if (dryRun) {
      console.log(`  Would delete fields on: ${wouldDeleteCount}`);
    } else {
      console.log(`  Deleted fields on:       ${deletedCount}`);
    }
    console.log(`  Skipped:                ${skippedCount}`);

    await client.close();
    process.exit(0);
  }

  if (dryRun) {
    console.log('\n╔════════════════════════════════════════╗');
    console.log('║   DRY-RUN MODE - NO CHANGES WILL BE   ║');
    console.log('║        MADE TO THE DATABASE           ║');
    console.log('╔════════════════════════════════════════╗\n');
  }

  console.log(
    'Starting migration: main.devices ->',
    credsDbName,
    dryRun ? '[DRY-RUN MODE]' : '[LIVE MODE]'
  );

  // Phase 1: Clean up existing creds documents with position data
  console.log('\n=== Phase 1: Cleaning up existing creds documents ===');
  const allCredsCollections = [
    'air',
    'camera',
    'energy',
    'weather',
    'water',
    'radiation',
    'hardware'
  ];
  let cleanupCount = 0;
  const cleanupUpdates: Array<{ miner_key: string; collection: string }> = [];

  for (const collName of allCredsCollections) {
    const coll = credsDb.collection(collName);
    const credsCursor = coll.find({ position: { $exists: true } });

    while (await credsCursor.hasNext()) {
      const doc = await credsCursor.next();
      if (!doc || !doc.miner_key) continue;

      const miner_key = String(doc.miner_key);
      const position = doc.position as any;
      const oldHexId = doc.hexId; // hexId outside position (old schema)

      // Get lat/lng from position
      const lat = position?.lat;
      const lng = position?.lng;

      // Skip if no valid lat/lng
      if (lat === undefined || lng === undefined) {
        cleanupCount++;
        continue;
      }

      // Calculate fresh hexId from lat/lng
      const latNum = Number(lat);
      const lngNum = Number(lng);
      if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) {
        cleanupCount++;
        continue;
      }
      const hexId = latLngToCell(latNum, lngNum, 7);

      // Check if we need to update (either schema fix or recalculate hexId)
      const needsUpdate =
        oldHexId !== undefined || // hexId is outside position
        !position.hexId || // hexId missing from position
        position.hexId !== hexId; // hexId needs recalculation

      if (needsUpdate) {
        if (dryRun) {
          cleanupUpdates.push({ miner_key, collection: collName });
        } else {
          await coll.updateOne(
            { miner_key },
            {
              $set: {
                position: {
                  lat: latNum,
                  lng: lngNum,
                  hexId
                }
              },
              $unset: { hexId: '' }
            }
          );
          console.log(
            `Updated ${miner_key} in ${collName} with calculated hexId=${hexId}`
          );
        }
      }

      // Always remove position and hexId from main.devices if position exists in creds
      if (!dryRun) {
        await devicesColl.updateOne(
          { miner_key },
          { $unset: { position: '', hexId: '' } }
        );
      }

      cleanupCount++;
      if (cleanupCount % 100 === 0)
        console.log(`Cleaned up ${cleanupCount} existing creds documents...`);
    }
  }

  if (dryRun && cleanupUpdates.length > 0) {
    console.log(
      `\nDry-run Phase 1: Would fix schema for ${cleanupUpdates.length} documents:`
    );
    cleanupUpdates
      .slice(0, 10)
      .forEach((u) =>
        console.log(
          `  Would fix ${u.miner_key} in ${u.collection} (move hexId into position)`
        )
      );
    if (cleanupUpdates.length > 10)
      console.log(`  ...and ${cleanupUpdates.length - 10} more`);
  }

  console.log(
    `Phase 1 complete: ${cleanupCount} existing creds documents processed.\n`
  );

  // Phase 2: Migrate from main.devices to creds
  console.log('=== Phase 2: Migrating position data from main.devices ===');

  // Find devices that have a lat/lng position defined (we will compute hexId)
  // If requested, collect the first N distinct miner_key values and only process those.
  let allowedMinerKeys: Set<string> | undefined = undefined;
  if (firstMinerKeys && Number.isFinite(firstMinerKeys) && firstMinerKeys > 0) {
    console.log(
      `Limiting migration to first ${firstMinerKeys} distinct miner_key values...`
    );
    const agg = devicesColl.aggregate(
      [
        {
          $match: {
            'position.lat': { $exists: true },
            'position.lng': { $exists: true }
          }
        },
        { $group: { _id: '$miner_key' } },
        { $limit: firstMinerKeys }
      ],
      { allowDiskUse: false }
    );
    const keys: string[] = [];
    while (await agg.hasNext()) {
      const r = await agg.next();
      if (r && r._id) keys.push(String(r._id));
    }
    allowedMinerKeys = new Set(keys);
    console.log(
      `Allowed miner_keys: ${keys.slice(0, 20).join(', ')}${keys.length > 20 ? ', ...' : ''}`
    );
  }

  const cursor = devicesColl.find(
    { 'position.lat': { $exists: true }, 'position.lng': { $exists: true } },
    { projection: { miner_key: 1, address: 1, position: 1 } }
  );

  let count = 0;
  const plannedUpdates: Array<{
    miner_key: string;
    collection: string;
    hexId: string;
  }> = [];
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
          hexId: hexId
        },
        position_saved_at: new Date()
      }
    };

    if (dryRun) {
      plannedUpdates.push({ miner_key, collection: collectionName, hexId });
    } else {
      // Upsert into creds collection (create if doesn't exist)
      await targetColl.updateMany(filter, update, { upsert: true });
      updatedCollections.add(collectionName);

      // Remove position and hexId from main.devices since it's now in creds
      await devicesColl.updateOne(
        { miner_key },
        { $unset: { position: '', hexId: '' } }
      );
    }

    count += 1;
    if (count % 100 === 0)
      console.log(
        dryRun ? `Planned ${count} updates...` : `Migrated ${count} devices...`
      );
    if (limit && count >= limit) break;
  }

  if (dryRun) {
    console.log('\n========================================');
    console.log('DRY-RUN MODE SUMMARY - NO CHANGES MADE');
    console.log('========================================\n');

    console.log(
      `Phase 1: ${cleanupUpdates.length} existing creds documents would be updated`
    );
    console.log(
      `Phase 2: ${plannedUpdates.length} devices would be migrated from main.devices\n`
    );

    if (plannedUpdates.length > 0) {
      console.log('Sample Phase 2 updates (first 20):');
      plannedUpdates
        .slice(0, 20)
        .forEach((p) =>
          console.log(
            `  Would migrate miner_key=${p.miner_key} to ${p.collection} -> hexId=${p.hexId}`
          )
        );
      if (plannedUpdates.length > 20)
        console.log(`  ...and ${plannedUpdates.length - 20} more`);
    }

    console.log('\n========================================');
    console.log('To apply these changes, run without --dry-run flag');
    console.log('========================================');
    process.exit(0);
  }

  // Create an index on position.hexId for each updated collection
  for (const collName of Array.from(updatedCollections)) {
    try {
      console.log(
        `Creating index on ${credsDbName}.${collName}.position.hexId ...`
      );
      const coll = credsDb.collection(collName);
      await coll.createIndex(
        { 'position.hexId': 1 },
        { name: 'position_hexId_idx' }
      );
      console.log(`Index created on ${credsDbName}.${collName}.position.hexId`);
    } catch (err) {
      console.error(
        `Failed to create index on ${credsDbName}.${collName}:`,
        err
      );
    }
  }

  console.log(`Migration complete. ${count} devices migrated.`);
  process.exit(0);
}

run().catch((err) => {
  console.error('Migration failed', err);
  process.exit(1);
});
