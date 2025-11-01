/**
 * One-time helper to backfill missing `address` fields in the creds database.
 *
 * For every collection under the creds DB (air, camera, energy, weather, etc.)
 * the script finds documents without an `address`, looks up the device in
 * `main.devices`, and copies the `address` over when a match is found.
 *
 * Usage:
 *   npx ts-node --compiler-options '{"module":"commonjs"}' scripts/backfill-creds-addresses.ts --dry-run
 *   npx ts-node --compiler-options '{"module":"commonjs"}' scripts/backfill-creds-addresses.ts
 *
 * Optional flags:
 *   (--dry-run)          Preview changes without applying them.
 */

import * as dotenv from 'dotenv';
import { MongoClient } from 'mongodb';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const MONGO_URI = process.env.MONGO_URI;
const CREDS_DB_NAME = process.env.MONGO_CREDS_DB ?? 'creds';
const DRY_RUN = process.argv.includes('--dry-run');
const DEVICE_COLLECTION = 'devices';

if (!MONGO_URI) {
  console.error('✖ MONGO_URI is required. Add it to your environment or .env file.');
  process.exit(1);
}

type BackfillStats = {
  collectionsChecked: number;
  documentsScanned: number;
  candidates: number;
  updated: number;
  wouldUpdate: number;
  deleted: number;
  wouldDelete: number;
  skippedNoMinerKey: number;
  skippedNoDeviceAddress: number;
  alreadyPresent: number;
  errors: number;
};

const stats: BackfillStats = {
  collectionsChecked: 0,
  documentsScanned: 0,
  candidates: 0,
  updated: 0,
  wouldUpdate: 0,
  deleted: 0,
  wouldDelete: 0,
  skippedNoMinerKey: 0,
  skippedNoDeviceAddress: 0,
  alreadyPresent: 0,
  errors: 0,
};

async function backfillAddresses() {
  const uri = process.env.MONGO_URI;

  if (!uri) {
    console.error('✖ MONGO_URI is required. Add it to your environment or .env file.');
    process.exit(1);
  }

  const client = new MongoClient(uri);

  try {
    await client.connect();
    const mainDb = client.db('main');
    const credsDb = client.db(CREDS_DB_NAME);

    const collections = (await credsDb.listCollections().toArray())
      .map((entry) => entry.name)
      .filter((name) => !name.startsWith('system.'));

    console.log(`ℹ️  Found ${collections.length} collections in ${CREDS_DB_NAME}.`);
    console.log(`ℹ️  Using ${DEVICE_COLLECTION} for address lookups.`);
    if (DRY_RUN) {
      console.log('⚠️  Dry run mode enabled — no writes will be performed.\n');
    }

    for (const name of collections) {
      stats.collectionsChecked += 1;
      const collection = credsDb.collection(name);

      console.log(`\n--- Processing creds.${name} ---`);

      const cursor = collection.find({
        $or: [
          { address: { $exists: false } },
          { address: { $in: [null, ''] } },
        ],
      });

      let collectionCandidates = 0;

      while (await cursor.hasNext()) {
        const doc = await cursor.next();
        stats.documentsScanned += 1;

        if (!doc) {
          continue;
        }

        stats.candidates += 1;
        collectionCandidates += 1;

        const minerKey: unknown = (doc as any).miner_key;
        if (typeof minerKey !== 'string' || minerKey.trim().length === 0) {
          stats.skippedNoMinerKey += 1;
          console.warn(`  • Skipping document ${doc._id} (collection ${name}) — missing miner_key.`);
          continue;
        }

        try {
          const device = await mainDb.collection(DEVICE_COLLECTION).findOne<{
            address?: string;
            is_registered?: boolean;
          }>({
            miner_key: minerKey,
          });

          if (!device || device.is_registered !== true) {
            const reason = !device
              ? 'no matching device found in main.devices'
              : 'device is not registered (is_registered !== true)';

            if (DRY_RUN) {
              stats.wouldDelete += 1;
              console.log(
                `  • [DRY RUN] Would remove ${minerKey} from creds.${name} because ${reason}.`
              );
            } else {
              const { deletedCount } = await collection.deleteOne({ _id: doc._id });
              if (deletedCount && deletedCount > 0) {
                stats.deleted += 1;
                console.log(
                  `  • Removed ${minerKey} from creds.${name} because ${reason}.`
                );
              }
            }
            continue;
          }

          const address = device?.address;
          if (!address || address.trim().length === 0) {
            stats.skippedNoDeviceAddress += 1;
            console.warn(`  • Could not find address for ${minerKey} in ${DEVICE_COLLECTION}.`);
            continue;
          }

          if ((doc as any).address === address) {
            stats.alreadyPresent += 1;
            continue;
          }

          if (DRY_RUN) {
            stats.wouldUpdate += 1;
            console.log(`  • [DRY RUN] Would set address ${address} for ${minerKey}.`);
          } else {
            await collection.updateOne(
              { _id: doc._id },
              {
                $set: {
                  address,
                },
              }
            );
            console.log(`  • Set address ${address} for ${minerKey}.`);
            stats.updated += 1;
          }
        } catch (error) {
          stats.errors += 1;
          console.error(`  • Error processing ${minerKey}:`, error);
        }
      }

      if (collectionCandidates === 0) {
        console.log('  • No documents needed backfilling.');
      }
    }

    console.log('\n=== Backfill Summary ===');
    console.log(`Collections checked:      ${stats.collectionsChecked}`);
    console.log(`Documents scanned:        ${stats.documentsScanned}`);
    console.log(`Candidates found:         ${stats.candidates}`);
    console.log(`Updated (applied):        ${stats.updated}`);
    if (DRY_RUN) {
      console.log(`Would update (dry run):   ${stats.wouldUpdate}`);
    }
    console.log(`Deleted (applied):        ${stats.deleted}`);
    if (DRY_RUN) {
      console.log(`Would delete (dry run):   ${stats.wouldDelete}`);
    }
    console.log(`Already matched address:  ${stats.alreadyPresent}`);
    console.log(`Skipped (no miner_key):   ${stats.skippedNoMinerKey}`);
    console.log(`Skipped (no device addr): ${stats.skippedNoDeviceAddress}`);
    console.log(`Errors:                   ${stats.errors}`);
    console.log('\nDone.');
  } finally {
    await client.close();
  }
}

backfillAddresses().catch((error) => {
  console.error('Unexpected error during backfill:', error);
  process.exit(1);
});
