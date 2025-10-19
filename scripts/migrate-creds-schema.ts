/**
 * Script to migrate credential data in creds.energy, creds.camera, and creds.radiation
 * to match the schema used in creds.air, creds.weather, and creds.hardware
 * run with : npx tsx scripts/migrate-creds-schema.ts
 * npx tsx scripts/migrate-creds-schema.t --dry-run   // to preview changes without modifying data
 */

import * as dotenv from 'dotenv';
import { MongoClient, Db } from 'mongodb';
import * as path from 'path';

// Load environment variables from project root
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const MONGO_URI = process.env.MONGO_URI;
const DRY_RUN = process.env.DRY_RUN === 'true' || process.argv.includes('--dry-run');

interface OldEnergyRecord {
  _id: any;
  miner_key: string;
  miner_type?: string;
  api_type: string;
  address?: string;
  deviceId?: string;
  serverUrl?: string;
  authKey?: string;
  token?: string;
  secret?: string;
  device_name?: string;
  device_type?: string;
  hub_device_id?: string;
  miner_subtype?: string;
  owner_address?: string;
  timestamp?: any;
  user_id?: any;
  credentials?: any;
  credentials_saved_at?: any;
  position?: any;
  position_saved_at?: any;
}

interface OldCameraRecord {
  _id: any;
  miner_key: string;
  miner_type?: string;
  RTSP?: string;
  address?: string;
  api_type?: string;
  credentials?: any;
  credentials_saved_at?: any;
  position?: any;
  position_saved_at?: any;
}

interface OldRadiationRecord {
  _id: any;
  miner_key: string;
  miner_type?: string;
  GMCMapID?: number;
  address?: string;
  api_type?: string;
  credentials?: any;
  credentials_saved_at?: any;
  position?: any;
  position_saved_at?: any;
}

interface DeviceRecord {
  miner_key: string;
  address?: string;
  position?: {
    lat: number;
    lng: number;
  };
  hexId?: string;
}

interface MigrationStats {
  total: number;
  alreadyMigrated: number;
  addressLookedUp: number;
  positionCopied: number;
  skippedNoAddress: number;
  updated: number;
  errors: number;
}

/**
 * Lookup address and position from main.devices
 */
async function lookupFromDevices(
  db: Db,
  minerKey: string
): Promise<{ address?: string; position?: any; hexId?: string }> {
  try {
    const device = await db.collection('devices').findOne<DeviceRecord>({ miner_key: minerKey });
    if (device) {
      return {
        address: device.address,
        position: device.position,
        hexId: device.hexId
      };
    }
  } catch (err) {
    console.error(`Error looking up device ${minerKey}:`, err);
  }
  return {};
}

/**
 * Check if a record has already been migrated
 */
function isAlreadyMigrated(record: any): boolean {
  // Check if credentials is an object (not a string or primitive) and has nested structure
  return (
    record.credentials &&
    typeof record.credentials === 'object' &&
    !Array.isArray(record.credentials) &&
    Object.keys(record.credentials).length > 0 &&
    record.position !== undefined &&
    record.position_saved_at !== undefined
  );
}

/**
 * Migrate Energy Collection
 */
async function migrateEnergyCollection(mainDb: Db, credsDb: Db): Promise<MigrationStats> {
  const stats: MigrationStats = {
    total: 0,
    alreadyMigrated: 0,
    addressLookedUp: 0,
    positionCopied: 0,
    skippedNoAddress: 0,
    updated: 0,
    errors: 0
  };

  console.log(`\n${'='.repeat(60)}`);
  console.log('Migrating creds.energy Collection');
  console.log('='.repeat(60));

  const collection = credsDb.collection('energy');
  const records = await collection.find<OldEnergyRecord>({}).toArray();
  stats.total = records.length;

  console.log(`Found ${stats.total} total records\n`);

  for (const record of records) {
    try {
      // Check if already migrated
      if (isAlreadyMigrated(record)) {
        console.log(`✓ ${record.miner_key} - already migrated, skipping`);
        stats.alreadyMigrated++;
        continue;
      }

      // Lookup from devices if needed
      let address = record.address || record.owner_address;
      let position = record.position;
      let hexId: string | undefined = undefined;
      let needsLookup = !address || !position;

      if (needsLookup) {
        const deviceData = await lookupFromDevices(mainDb, record.miner_key);
        
        if (!address && deviceData.address) {
          address = deviceData.address;
          stats.addressLookedUp++;
          console.log(`  → Found address for ${record.miner_key}`);
        }
        
        if (!position && deviceData.position) {
          position = deviceData.position;
          hexId = deviceData.hexId;
          stats.positionCopied++;
          console.log(`  → Found position for ${record.miner_key}`);
        }
      }

      // Skip if still no address
      if (!address) {
        console.log(`✗ ${record.miner_key} - no address found, skipping`);
        stats.skippedNoAddress++;
        continue;
      }

      // Build credentials object based on api_type
      let credentials: any = {};
      
      if (record.api_type === 'shelly') {
        credentials = {
          deviceId: record.deviceId,
          serverUrl: record.serverUrl,
          authKey: record.authKey
        };
      } else if (record.api_type === 'switchbot') {
        credentials = {
          token: record.token,
          secret: record.secret,
          deviceId: record.deviceId
        };
      }

      // Prepare update
      const setFields: any = {
        address,
        miner_type: 'energy',
        position: position || {},
        position_saved_at: null,
        api_type: record.api_type,
        credentials,
        credentials_saved_at: record.timestamp || record.credentials_saved_at || new Date()
      };

      if (hexId) {
        setFields.hexId = hexId;
      }

      const updateDoc: any = {
        $set: setFields,
        $unset: {
          deviceId: '',
          serverUrl: '',
          authKey: '',
          token: '',
          secret: '',
          device_name: '',
          device_type: '',
          hub_device_id: '',
          miner_subtype: '',
          owner_address: '',
          timestamp: '',
          user_id: ''
        }
      };

      if (DRY_RUN) {
        console.log(`[DRY RUN] Would update ${record.miner_key}`);
        stats.updated++;
      } else {
        await collection.updateOne(
          { _id: record._id },
          updateDoc
        );
        console.log(`✓ Updated ${record.miner_key}`);
        stats.updated++;
      }
    } catch (err) {
      console.error(`✗ Error updating ${record.miner_key}:`, err);
      stats.errors++;
    }
  }

  return stats;
}

/**
 * Migrate Camera Collection
 */
async function migrateCameraCollection(mainDb: Db, credsDb: Db): Promise<MigrationStats> {
  const stats: MigrationStats = {
    total: 0,
    alreadyMigrated: 0,
    addressLookedUp: 0,
    positionCopied: 0,
    skippedNoAddress: 0,
    updated: 0,
    errors: 0
  };

  console.log(`\n${'='.repeat(60)}`);
  console.log('Migrating creds.camera Collection');
  console.log('='.repeat(60));

  const collection = credsDb.collection('camera');
  const records = await collection.find<OldCameraRecord>({}).toArray();
  stats.total = records.length;

  console.log(`Found ${stats.total} total records\n`);

  for (const record of records) {
    try {
      // Check if already migrated
      if (isAlreadyMigrated(record)) {
        console.log(`✓ ${record.miner_key} - already migrated, skipping`);
        stats.alreadyMigrated++;
        continue;
      }

      // Lookup from devices if needed
      let address = record.address;
      let position = record.position;
      let hexId: string | undefined = undefined;
      let needsLookup = !address || !position;

      if (needsLookup) {
        const deviceData = await lookupFromDevices(mainDb, record.miner_key);
        
        if (!address && deviceData.address) {
          address = deviceData.address;
          stats.addressLookedUp++;
          console.log(`  → Found address for ${record.miner_key}`);
        }
        
        if (!position && deviceData.position) {
          position = deviceData.position;
          hexId = deviceData.hexId;
          stats.positionCopied++;
          console.log(`  → Found position for ${record.miner_key}`);
        }
      }

      // Skip if still no address
      if (!address) {
        console.log(`✗ ${record.miner_key} - no address found, skipping`);
        stats.skippedNoAddress++;
        continue;
      }

      // Build credentials object
      const credentials = {
        rtsp_url: record.RTSP || ''
      };

      // Prepare update
      const setFields: any = {
        address,
        miner_type: 'camera',
        position: position || {},
        position_saved_at: null,
        api_type: 'rtsp',
        credentials,
        credentials_saved_at: new Date()
      };

      if (hexId) {
        setFields.hexId = hexId;
      }

      const updateDoc: any = {
        $set: setFields,
        $unset: {
          RTSP: ''
        }
      };

      if (DRY_RUN) {
        console.log(`[DRY RUN] Would update ${record.miner_key}`);
        stats.updated++;
      } else {
        await collection.updateOne(
          { _id: record._id },
          updateDoc
        );
        console.log(`✓ Updated ${record.miner_key}`);
        stats.updated++;
      }
    } catch (err) {
      console.error(`✗ Error updating ${record.miner_key}:`, err);
      stats.errors++;
    }
  }

  return stats;
}

/**
 * Migrate Radiation Collection
 */
async function migrateRadiationCollection(mainDb: Db, credsDb: Db): Promise<MigrationStats> {
  const stats: MigrationStats = {
    total: 0,
    alreadyMigrated: 0,
    addressLookedUp: 0,
    positionCopied: 0,
    skippedNoAddress: 0,
    updated: 0,
    errors: 0
  };

  console.log(`\n${'='.repeat(60)}`);
  console.log('Migrating creds.radiation Collection');
  console.log('='.repeat(60));

  const collection = credsDb.collection('radiation');
  const records = await collection.find<OldRadiationRecord>({}).toArray();
  stats.total = records.length;

  console.log(`Found ${stats.total} total records\n`);

  for (const record of records) {
    try {
      // Check if already migrated
      if (isAlreadyMigrated(record)) {
        console.log(`✓ ${record.miner_key} - already migrated, skipping`);
        stats.alreadyMigrated++;
        continue;
      }

      // Lookup from devices if needed
      let address = record.address;
      let position = record.position;
      let hexId: string | undefined = undefined;
      let needsLookup = !address || !position;

      if (needsLookup) {
        const deviceData = await lookupFromDevices(mainDb, record.miner_key);
        
        if (!address && deviceData.address) {
          address = deviceData.address;
          stats.addressLookedUp++;
          console.log(`  → Found address for ${record.miner_key}`);
        }
        
        if (!position && deviceData.position) {
          position = deviceData.position;
          hexId = deviceData.hexId;
          stats.positionCopied++;
          console.log(`  → Found position for ${record.miner_key}`);
        }
      }

      // Skip if still no address
      if (!address) {
        console.log(`✗ ${record.miner_key} - no address found, skipping`);
        stats.skippedNoAddress++;
        continue;
      }

      // Build credentials object
      const credentials = {
        gmc_map_id: record.GMCMapID
      };

      // Prepare update
      const setFields: any = {
        address,
        miner_type: 'radiation',
        position: position || {},
        position_saved_at: null,
        api_type: 'gmc',
        credentials,
        credentials_saved_at: new Date()
      };

      if (hexId) {
        setFields.hexId = hexId;
      }

      const updateDoc: any = {
        $set: setFields,
        $unset: {
          GMCMapID: ''
        }
      };

      if (DRY_RUN) {
        console.log(`[DRY RUN] Would update ${record.miner_key}`);
        stats.updated++;
      } else {
        await collection.updateOne(
          { _id: record._id },
          updateDoc
        );
        console.log(`✓ Updated ${record.miner_key}`);
        stats.updated++;
      }
    } catch (err) {
      console.error(`✗ Error updating ${record.miner_key}:`, err);
      stats.errors++;
    }
  }

  return stats;
}

/**
 * Main execution
 */
async function main() {
  console.log('\n' + '='.repeat(60));
  console.log('Credentials Schema Migration Script');
  if (DRY_RUN) {
    console.log('🔍 DRY RUN MODE - No data will be modified');
  }
  console.log('='.repeat(60));

  // Validate environment
  if (!MONGO_URI) {
    console.error('\n❌ Error: MONGO_URI environment variable is not set');
    console.error('Please set MONGO_URI in your .env file\n');
    process.exit(1);
  }

  let client: MongoClient | null = null;

  try {
    // Connect to MongoDB
    console.log('\nConnecting to MongoDB...');
    client = new MongoClient(MONGO_URI);
    await client.connect();
    console.log('✓ Connected to MongoDB\n');

    const credsDb = client.db('creds');
    const mainDb = client.db('main');

    // Migrate each collection
    const energyStats = await migrateEnergyCollection(mainDb, credsDb);
    const cameraStats = await migrateCameraCollection(mainDb, credsDb);
    const radiationStats = await migrateRadiationCollection(mainDb, credsDb);

    // Final summary
    console.log(`\n${'='.repeat(60)}`);
    console.log('MIGRATION SUMMARY');
    console.log('='.repeat(60));

    console.log('\n📊 Energy Collection:');
    console.log(`  Total records: ${energyStats.total}`);
    console.log(`  Already migrated: ${energyStats.alreadyMigrated}`);
    console.log(`  Addresses looked up: ${energyStats.addressLookedUp}`);
    console.log(`  Positions copied: ${energyStats.positionCopied}`);
    console.log(`  Skipped (no address): ${energyStats.skippedNoAddress}`);
    console.log(`  Updated: ${energyStats.updated}`);
    console.log(`  Errors: ${energyStats.errors}`);

    console.log('\n📷 Camera Collection:');
    console.log(`  Total records: ${cameraStats.total}`);
    console.log(`  Already migrated: ${cameraStats.alreadyMigrated}`);
    console.log(`  Addresses looked up: ${cameraStats.addressLookedUp}`);
    console.log(`  Positions copied: ${cameraStats.positionCopied}`);
    console.log(`  Skipped (no address): ${cameraStats.skippedNoAddress}`);
    console.log(`  Updated: ${cameraStats.updated}`);
    console.log(`  Errors: ${cameraStats.errors}`);

    console.log('\n☢️  Radiation Collection:');
    console.log(`  Total records: ${radiationStats.total}`);
    console.log(`  Already migrated: ${radiationStats.alreadyMigrated}`);
    console.log(`  Addresses looked up: ${radiationStats.addressLookedUp}`);
    console.log(`  Positions copied: ${radiationStats.positionCopied}`);
    console.log(`  Skipped (no address): ${radiationStats.skippedNoAddress}`);
    console.log(`  Updated: ${radiationStats.updated}`);
    console.log(`  Errors: ${radiationStats.errors}`);

    const totalUpdated = energyStats.updated + cameraStats.updated + radiationStats.updated;
    const totalErrors = energyStats.errors + cameraStats.errors + radiationStats.errors;

    console.log('\n📈 Overall:');
    console.log(`  Total updated: ${totalUpdated}`);
    console.log(`  Total errors: ${totalErrors}`);
    console.log('='.repeat(60) + '\n');

    // Verify migrations if not dry run
    if (!DRY_RUN && totalUpdated > 0) {
      console.log('Verifying migrations...');
      
      const energySample = await credsDb.collection('energy').findOne({ 
        credentials: { $exists: true, $type: 'object' } 
      });
      const cameraSample = await credsDb.collection('camera').findOne({ 
        credentials: { $exists: true, $type: 'object' } 
      });
      const radiationSample = await credsDb.collection('radiation').findOne({ 
        credentials: { $exists: true, $type: 'object' } 
      });

      if (energySample) {
        console.log('\n✓ Energy sample record (migrated):');
        console.log(JSON.stringify(energySample, null, 2));
      }
      if (cameraSample) {
        console.log('\n✓ Camera sample record (migrated):');
        console.log(JSON.stringify(cameraSample, null, 2));
      }
      if (radiationSample) {
        console.log('\n✓ Radiation sample record (migrated):');
        console.log(JSON.stringify(radiationSample, null, 2));
      }
    }

  } catch (err) {
    console.error('\n❌ Fatal error:', err);
    process.exit(1);
  } finally {
    if (client) {
      await client.close();
      console.log('\nMongoDB connection closed\n');
    }
  }
}

// Run the script
main().catch(console.error);
