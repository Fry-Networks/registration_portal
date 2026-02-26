/**
 * Script to insert credential data from air.json and weather.json into MongoDB
 * Following the plan in docs/json-credentials-insertion-plan.md
 * run with : npx tsx scripts/insert-json-credentials.ts
 * npx tsx scripts/insert-json-credentials.ts --dry-run   // to preview changes without modifying data
 */

import * as dotenv from 'dotenv';
import { MongoClient, Db } from 'mongodb';
import * as fs from 'fs';
import * as readline from 'readline';
import * as path from 'path';

// Load environment variables from project root
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const MONGO_URI = process.env.MONGO_URI;
const DRY_RUN = process.env.DRY_RUN === 'true' || process.argv.includes('--dry-run');
const AIR_JSON_PATH = path.join(__dirname, '..', 'csvs to be inserted', 'air.json');
const WEATHER_JSON_PATH = path.join(__dirname, '..', 'csvs to be inserted', 'weather.json');

// Air quality miner prefixes
const AIR_PREFIXES = ['ILAQM', 'IHAQM', 'IMAQM', 'OMAQM', 'OHAQM'];
// Weather miner prefixes
const WEATHER_PREFIXES = ['LWM', 'HWM'];

interface JsonRecord {
  _id?: any;
  address?: string;
  miner_key: string;
  miner_type?: string;
  miner_subtype?: string;
  api_type: string;
  user_id?: string;
  timestamp?: any;
  position?: any;
  position_saved_at?: any;
  credentials?: any;
  credentials_saved_at?: any;
  [key: string]: any;
}

interface TransformedRecord {
  address: string;
  miner_key: string;
  miner_type: 'air' | 'weather';
  position: object;
  position_saved_at: null;
  api_type: string;
  credentials: object;
  credentials_saved_at?: Date;
}

interface Stats {
  total: number;
  withAddress: number;
  addressLookedUp: number;
  skippedNoAddress: number;
  skippedEmptyCredentials: number;
  skippedWrongType: number;
  inserted: number;
  errors: number;
}

/**
 * Parse NDJSON file line by line
 */
async function parseNDJSON(filePath: string): Promise<JsonRecord[]> {
  const records: JsonRecord[] = [];
  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  for await (const line of rl) {
    if (line.trim()) {
      try {
        const record = JSON.parse(line);
        records.push(record);
      } catch (err) {
        console.error(`Error parsing line: ${line.substring(0, 50)}...`);
        console.error(err);
      }
    }
  }

  return records;
}

/**
 * Convert MongoDB extended JSON date to Date object
 */
function convertDate(dateValue: any): Date | undefined {
  if (!dateValue) return undefined;
  
  if (dateValue.$date) {
    return new Date(dateValue.$date);
  }
  
  if (typeof dateValue === 'string') {
    return new Date(dateValue);
  }
  
  if (dateValue instanceof Date) {
    return dateValue;
  }
  
  return undefined;
}

/**
 * Decode binary data if in $binary format, otherwise return as-is
 */
function decodeBinary(value: any): any {
  if (value && value.$binary && value.$binary.base64) {
    // For now, return base64 string - can be decoded if needed
    return value.$binary.base64;
  }
  return value;
}

/**
 * Check if credentials object is empty
 */
function hasEmptyCredentials(record: JsonRecord): boolean {
  if (!record.credentials) return true;
  if (typeof record.credentials === 'object') {
    return Object.keys(record.credentials).length === 0;
  }
  return false;
}

/**
 * Lookup address in main.devices by miner_key
 */
async function lookupAddress(db: Db, minerKey: string): Promise<string | null> {
  try {
    const device = await db.collection('devices').findOne({ miner_key: minerKey });
    return device?.address || null;
  } catch (err) {
    console.error(`Error looking up address for ${minerKey}:`, err);
    return null;
  }
}

/**
 * Extract credentials based on api_type
 */
function extractCredentials(record: JsonRecord): object {
  const apiType = record.api_type;
  
  // If credentials already exist in proper format, use them
  if (record.credentials && typeof record.credentials === 'object' && Object.keys(record.credentials).length > 0) {
    return record.credentials;
  }
  
  const creds: any = {};
  
  switch (apiType) {
    case 'atmotube':
      creds.token = decodeBinary(record.token) || record.token;
      creds.deviceId = record.deviceId;
      break;
      
    case 'sensecap':
      creds.username = record.username;
      creds.password = record.password;
      if (record.device_eui) creds.device_eui = record.device_eui;
      break;
      
    case 'awair':
      creds.token = record.token;
      creds.deviceId = String(record.deviceId);
      break;
      
    case 'kaiterra':
    case 'Kaiterra':
      creds.deviceId = decodeBinary(record.deviceId) || record.deviceId;
      creds.token = record.token;
      break;
      
    case 'NRF':
      creds.id = record.id;
      creds.token = record.token;
      break;
      
    case 'pebble':
      creds.owner = record.owner;
      creds.imei = record.imei;
      break;
      
    case 'ambient':
      creds.api_key = record.api_key;
      creds.device_mac = record.device_mac;
      break;
      
    case 'ecowitt':
      creds.app_key = record.app_key || '';
      creds.api_key = record.api_key || '';
      break;
      
    case 'weather-xm':
      creds.username = record.username || '';
      creds.password = record.password || '';
      break;
      
    default:
      console.warn(`Unknown api_type: ${apiType} for miner_key: ${record.miner_key}`);
      // Return whatever credentials exist
      return record.credentials || {};
  }
  
  return creds;
}

/**
 * Transform a JSON record to the target schema
 * Returns the record and which collection it should go to
 */
async function transformRecord(
  record: JsonRecord,
  db: Db,
  stats: Stats
): Promise<{ transformed: TransformedRecord; collection: 'air' | 'weather' } | null> {
  stats.total++;
  
  // Skip if missing miner_key
  if (!record.miner_key) {
    console.log(`Skipping record with no miner_key`);
    stats.skippedWrongType++;
    return null;
  }
  
  // Determine miner_type from prefix
  const prefix = record.miner_key.split('-')[0];
  let minerType: 'air' | 'weather' | null = null;
  
  if (AIR_PREFIXES.includes(prefix)) {
    minerType = 'air';
  } else if (WEATHER_PREFIXES.includes(prefix)) {
    minerType = 'weather';
  }
  
  // Skip if we can't determine type
  if (!minerType) {
    console.log(`Skipping ${record.miner_key} - unknown miner type prefix: ${prefix}`);
    stats.skippedWrongType++;
    return null;
  }
  
  // Handle missing address
  let address: string | undefined = record.address;
  if (!address) {
    console.log(`Looking up address for ${record.miner_key} in main.devices...`);
    const lookedUpAddress = await lookupAddress(db, record.miner_key);
    
    if (lookedUpAddress) {
      console.log(`  ✓ Found address: ${lookedUpAddress.substring(0, 10)}...`);
      address = lookedUpAddress;
      stats.addressLookedUp++;
    } else {
      console.log(`  ✗ No address found in main.devices, skipping`);
      stats.skippedNoAddress++;
      return null;
    }
  } else {
    stats.withAddress++;
  }
  
  // At this point, address is guaranteed to be a string
  if (!address) {
    stats.skippedNoAddress++;
    return null;
  }
  
  // Extract credentials (allow empty credentials now)
  const credentials = extractCredentials(record);
  
  // Build transformed record
  const transformed: TransformedRecord = {
    address,
    miner_key: record.miner_key,
    miner_type: minerType,
    position: record.position || {},
    position_saved_at: null,
    api_type: record.api_type,
    credentials,
    credentials_saved_at: convertDate(record.timestamp || record.credentials_saved_at)
  };
  
  return { transformed, collection: minerType };
}

/**
 * Process a file and insert records into appropriate collections
 */
async function processFile(
  filePath: string,
  mainDb: Db,
  credsDb: Db
): Promise<Stats> {
  const stats: Stats = {
    total: 0,
    withAddress: 0,
    addressLookedUp: 0,
    skippedNoAddress: 0,
    skippedEmptyCredentials: 0,
    skippedWrongType: 0,
    inserted: 0,
    errors: 0
  };
  
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Processing: ${path.basename(filePath)}`);
  console.log(`${'='.repeat(60)}\n`);
  
  // Parse NDJSON file
  console.log('Parsing NDJSON file...');
  const records = await parseNDJSON(filePath);
  console.log(`Parsed ${records.length} records\n`);
  
  // Transform records and separate by collection
  console.log('Transforming records...');
  const airRecords: TransformedRecord[] = [];
  const weatherRecords: TransformedRecord[] = [];
  
  for (const record of records) {
    try {
      const result = await transformRecord(record, mainDb, stats);
      if (result) {
        if (result.collection === 'air') {
          airRecords.push(result.transformed);
        } else {
          weatherRecords.push(result.transformed);
        }
      }
    } catch (err) {
      console.error(`Error transforming record ${record.miner_key}:`, err);
      stats.errors++;
    }
  }
  
  console.log(`\nTransformation complete:`);
  console.log(`  Air records to insert: ${airRecords.length}`);
  console.log(`  Weather records to insert: ${weatherRecords.length}`);
  console.log(`  Records with address: ${stats.withAddress}`);
  console.log(`  Addresses looked up: ${stats.addressLookedUp}`);
  console.log(`  Skipped (no address): ${stats.skippedNoAddress}`);
  console.log(`  Skipped (wrong type): ${stats.skippedWrongType}`);
  console.log(`  Errors: ${stats.errors}`);
  
  // Insert air records
  if (airRecords.length > 0) {
    await insertRecords(credsDb, 'air', airRecords, stats);
  }
  
  // Insert weather records
  if (weatherRecords.length > 0) {
    await insertRecords(credsDb, 'weather', weatherRecords, stats);
  }
  
  return stats;
}

/**
 * Insert records into a collection in batches
 */
async function insertRecords(
  db: Db,
  collectionName: string,
  records: TransformedRecord[],
  stats: Stats
): Promise<void> {
  if (DRY_RUN) {
    console.log(`\n[DRY RUN] Would insert ${records.length} records into creds.${collectionName}`);
    console.log('[DRY RUN] Sample record to be inserted:');
    console.log(JSON.stringify(records[0], null, 2));
    stats.inserted += records.length; // Simulate all would be inserted
  } else {
    console.log(`\nInserting ${records.length} records into creds.${collectionName}...`);
    
    const BATCH_SIZE = 100;
    for (let i = 0; i < records.length; i += BATCH_SIZE) {
      const batch = records.slice(i, i + BATCH_SIZE);
      
      try {
        const result = await db.collection(collectionName).insertMany(batch, { ordered: false });
        stats.inserted += result.insertedCount;
        console.log(`  Batch ${Math.floor(i / BATCH_SIZE) + 1}: Inserted ${result.insertedCount} records`);
      } catch (err: any) {
        // Handle duplicate key errors
        if (err.code === 11000) {
          const insertedCount = err.result?.nInserted || 0;
          stats.inserted += insertedCount;
          console.log(`  Batch ${Math.floor(i / BATCH_SIZE) + 1}: Inserted ${insertedCount} records (some duplicates skipped)`);
        } else {
          console.error(`  Batch ${Math.floor(i / BATCH_SIZE) + 1}: Error inserting batch:`, err.message);
          stats.errors++;
        }
      }
    }
  }
}

/**
 * Main execution
 */
async function main() {
  console.log('\n' + '='.repeat(60));
  console.log('JSON Credentials Insertion Script');
  if (DRY_RUN) {
    console.log('🔍 DRY RUN MODE - No data will be inserted');
  }
  console.log('='.repeat(60));
  
  // Validate environment
  if (!MONGO_URI) {
    console.error('\n❌ Error: MONGO_URI environment variable is not set');
    console.error('Please set MONGO_URI in your .env file\n');
    process.exit(1);
  }
  
  // Check files exist
  if (!fs.existsSync(AIR_JSON_PATH)) {
    console.error(`\n❌ Error: air.json not found at ${AIR_JSON_PATH}\n`);
    process.exit(1);
  }
  
  if (!fs.existsSync(WEATHER_JSON_PATH)) {
    console.error(`\n❌ Error: weather.json not found at ${WEATHER_JSON_PATH}\n`);
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
    
    // Process air.json
    const airStats = await processFile(AIR_JSON_PATH, mainDb, credsDb);
    
    // Process weather.json
    const weatherStats = await processFile(WEATHER_JSON_PATH, mainDb, credsDb);
    
    // Final summary
    console.log(`\n${'='.repeat(60)}`);
    console.log('FINAL SUMMARY');
    console.log('='.repeat(60));
    console.log('\nAir Records:');
    console.log(`  Total processed: ${airStats.total}`);
    console.log(`  Successfully inserted: ${airStats.inserted}`);
    console.log(`  Skipped (no address): ${airStats.skippedNoAddress}`);
    console.log(`  Skipped (empty creds): ${airStats.skippedEmptyCredentials}`);
    console.log(`  Skipped (wrong type): ${airStats.skippedWrongType}`);
    console.log(`  Errors: ${airStats.errors}`);
    
    console.log('\nWeather Records:');
    console.log(`  Total processed: ${weatherStats.total}`);
    console.log(`  Successfully inserted: ${weatherStats.inserted}`);
    console.log(`  Skipped (no address): ${weatherStats.skippedNoAddress}`);
    console.log(`  Skipped (empty creds): ${weatherStats.skippedEmptyCredentials}`);
    console.log(`  Skipped (wrong type): ${weatherStats.skippedWrongType}`);
    console.log(`  Errors: ${weatherStats.errors}`);
    
    console.log('\nTotal Inserted:', airStats.inserted + weatherStats.inserted);
    console.log('='.repeat(60) + '\n');
    
    // Verify insertions
    if (!DRY_RUN) {
      console.log('Verifying insertions...');
      const airCount = await credsDb.collection('air').countDocuments();
      const weatherCount = await credsDb.collection('weather').countDocuments();
      console.log(`  creds.air: ${airCount} total documents`);
      console.log(`  creds.weather: ${weatherCount} total documents\n`);
    }
    
  } catch (err) {
    console.error('\n❌ Fatal error:', err);
    process.exit(1);
  } finally {
    if (client) {
      await client.close();
      console.log('MongoDB connection closed\n');
    }
  }
}

// Run the script
main().catch(console.error);
