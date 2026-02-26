#!/usr/bin/env ts-node

/**
 * Hardware Credentials Migration Tool
 * 
 * Migrates credentials from air.hardwares and air.nodes to creds.hardware
 * Preserves all original fields and updates registered_portal_model in main.devices
 * 
 * Usage:
 *   npm run migrate-hardware-creds [options]
 *   e.g.: npm run migrate-hardware-creds -- --miner-key BM-5EQ2HGKDDRBH4ZGNYMHIIKIGLHLSBEN0 --backup-dir ./backups
 * Options:
 *   --auto              Auto-approve all migrations (no prompts)
 *   --dry-run           Preview changes without executing
 *   --miner-key <key>   Migrate specific miner key only
 *   --skip-portal       Don't update registered_portal_model
 *   --backup-dir <path> Custom backup directory (default: ./backups)
 */

import 'dotenv/config';
import { MongoClient, ObjectId } from 'mongodb';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';

// Color codes for console output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  blue: '\x1b[36m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  gray: '\x1b[90m',
  bold: '\x1b[1m',
};

interface MigrationStats {
  airHardwaresScanned: number;
  airNodesScanned: number;
  alreadyMigrated: number;
  newlyMigrated: number;
  orphaned: number;
  errors: number;
  skipped: number;
}

interface DeviceDocument {
  _id: ObjectId;
  miner_key: string;
  user_id: ObjectId;
  timestamp?: Date | string | number | { $date: string };
  hd_type?: string;
  node_type?: string;
  device_id: string;
}

interface MainDeviceDocument {
  miner_key: string;
  is_registered: boolean;
  registered_portal_model?: string;
  [key: string]: any;
}

interface MigrationOptions {
  auto: boolean;
  dryRun: boolean;
  specificMinerKey?: string;
  skipPortalUpdate: boolean;
  backupDir: string;
}

const normalizeMacAddress = (value?: string | null): string => {
  if (!value) return '';
  const hex = value.replace(/[^A-Fa-f0-9]/g, '').toUpperCase();
  if (hex.length !== 12) return '';
  return hex.match(/.{1,2}/g)?.join(':') ?? '';
};

const deriveMinerType = (device: DeviceDocument): string => {
  const prefix = (device.miner_key || '').split('-')[0]?.toUpperCase() ?? '';
  if (prefix === 'CN' || prefix === 'RDN' || prefix === 'SDN' || prefix === 'SVN') return 'node';
  if ((device.hd_type || '').toUpperCase() === 'AEM') return 'AEM';
  if (prefix) return prefix;
  const legacyType = (device.hd_type || device.node_type || '').toUpperCase();
  return legacyType;
};

const determinePortalModel = (device: DeviceDocument): string => {
  const prefix = (device.miner_key || '').split('-')[0]?.toUpperCase() ?? '';
  switch (prefix) {
    case 'AEM':
      return 'aem';
    case 'CN':
    case 'RDN':
    case 'SDN':
    case 'SVN':
      return 'node';
    default:
      return 'hardware';
  }
};

const resolveTimestamp = (value: DeviceDocument['timestamp']): Date | undefined => {
  if (!value) return undefined;
  if (value instanceof Date) {
    if (!Number.isNaN(value.getTime())) return value;
    return undefined;
  }

  if (typeof value === 'object' && '$date' in value) {
    const date = new Date((value as { $date: string }).$date);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }

  const parsed = new Date(value as string | number);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
};

class MigrationTool {
  private client: MongoClient;
  private stats: MigrationStats;
  private options: MigrationOptions;
  private rl: readline.Interface;
  private migrationLog: Array<{
    miner_key: string;
    action: string;
    from_collection?: string;
    timestamp: string;
    details?: any;
  }>;
  private unregisteredWithMac: Array<{
    miner_key: string;
    address: string;
    mac_address: string;
    expected_portal: string;
    source_collection: string;
  }>;

  constructor(mongoUri: string, options: MigrationOptions) {
    this.client = new MongoClient(mongoUri);
    this.stats = {
      airHardwaresScanned: 0,
      airNodesScanned: 0,
      alreadyMigrated: 0,
      newlyMigrated: 0,
      orphaned: 0,
      errors: 0,
      skipped: 0,
    };
    this.options = options;
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    this.migrationLog = [];
    this.unregisteredWithMac = [];
  }

  private log(message: string, color: keyof typeof colors = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
  }

  private logAction(miner_key: string, action: string, from_collection?: string, details?: any) {
    this.migrationLog.push({
      miner_key,
      action,
      from_collection,
      timestamp: new Date().toISOString(),
      details,
    });
  }

  private async prompt(question: string): Promise<string> {
    if (this.options.auto) {
      return 'y';
    }
    return new Promise((resolve) => {
      this.rl.question(question, (answer) => {
        resolve(answer.toLowerCase().trim());
      });
    });
  }

  private async createBackups() {
    this.log('\n📦 Creating backups...', 'blue');
    
    if (!fs.existsSync(this.options.backupDir)) {
      fs.mkdirSync(this.options.backupDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const airDb = this.client.db('air');

    try {
      // Backup air.hardwares
      const hardwares = await airDb.collection('hardwares').find({}).toArray();
      const hardwaresPath = path.join(
        this.options.backupDir,
        `air-hardwares-${timestamp}.json`
      );
      fs.writeFileSync(hardwaresPath, JSON.stringify(hardwares, null, 2));
      this.log(`  ✓ Backed up ${hardwares.length} documents from air.hardwares`, 'green');

      // Backup air.nodes
      const nodes = await airDb.collection('nodes').find({}).toArray();
      const nodesPath = path.join(
        this.options.backupDir,
        `air-nodes-${timestamp}.json`
      );
      fs.writeFileSync(nodesPath, JSON.stringify(nodes, null, 2));
      this.log(`  ✓ Backed up ${nodes.length} documents from air.nodes`, 'green');

      this.log(`\n  Backups saved to: ${this.options.backupDir}`, 'gray');
    } catch (error) {
      this.log(`  ✗ Backup failed: ${error}`, 'red');
      throw error;
    }
  }

  private async migrateDevice(
    device: DeviceDocument,
    sourceCollection: 'hardwares' | 'nodes'
  ): Promise<boolean> {
    const { miner_key } = device;

    this.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'gray');
    this.log(`Device: ${miner_key}`, 'bold');
    this.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'gray');
    this.log(`Source: air.${sourceCollection}`, 'blue');
    this.log(`Device ID (MAC): ${device.device_id}`, 'blue');
    this.log(
      `Type: ${device.hd_type || device.node_type || 'Unknown'}`,
      'blue'
    );
    this.log(`User ID: ${device.user_id}`, 'gray');
    const timestamp = resolveTimestamp(device.timestamp);
    this.log(
      `Timestamp: ${(timestamp ?? new Date(0)).toISOString()}`,
      'gray'
    );

    try {
      const credsDb = this.client.db('creds');
      const mainDb = this.client.db('main');

      // Check main.devices
      const mainDevice = (await mainDb
        .collection('devices')
        .findOne({ miner_key })) as MainDeviceDocument | null;

      this.log('\nMain DB Status:', 'blue');
      if (!mainDevice) {
        this.log('  ⚠ Not found in main.devices (orphaned)', 'yellow');
        this.stats.orphaned++;
      } else {
        this.log(
          `  ${mainDevice.is_registered ? '✓' : '✗'} is_registered: ${
            mainDevice.is_registered
          }`,
          mainDevice.is_registered ? 'green' : 'yellow'
        );
        this.log(
          `  ${
            mainDevice.registered_portal_model ? '✓' : '○'
          } registered_portal_model: ${
            mainDevice.registered_portal_model || '(will set to hardware)'
          }`,
          mainDevice.registered_portal_model ? 'green' : 'gray'
        );
      }

      this.log('\nCreds DB Status:', 'blue');
      const ownerAddress = typeof mainDevice?.address === 'string' ? mainDevice.address : null;
      if (!ownerAddress) {
        this.log('  ✗ Cannot determine owner address in main.devices', 'red');
        this.log('    → Skipping (address is required for new schema)', 'red');
        this.stats.errors++;
        this.logAction(miner_key, 'skip_missing_address', `air.${sourceCollection}`);
        return true;
      }

      let existingDoc = await credsDb
        .collection('hardware')
        .findOne({ miner_key, address: ownerAddress });

      if (existingDoc) {
        this.log(`  ✓ Entry exists for address ${ownerAddress}`, 'yellow');
      } else {
        const legacyDoc = await credsDb
          .collection('hardware')
          .findOne({ miner_key });
        if (legacyDoc) {
          this.log('  ⚠ Legacy entry found without address; will rewrite in new schema', 'yellow');
          existingDoc = legacyDoc;
        } else {
          this.log('  ✗ Not in creds.hardware', 'gray');
        }
      }

      const macAddress = normalizeMacAddress(device.device_id);
      if (!macAddress) {
        this.log('  ✗ Invalid or missing MAC address; skipping', 'red');
        this.stats.errors++;
        this.logAction(miner_key, 'invalid_mac', `air.${sourceCollection}`);
        return true;
      }

      const expectedPortal = determinePortalModel(device);
      const needsPortalUpdate =
        mainDevice &&
        !this.options.skipPortalUpdate &&
        (mainDevice.registered_portal_model || '').toLowerCase() !== expectedPortal.toLowerCase();

      if (needsPortalUpdate) {
        this.log(
          `  ⚠ registered_portal_model mismatch (current: ${mainDevice?.registered_portal_model ?? 'none'}, expected: ${expectedPortal})`,
          'yellow'
        );
      }

      if (mainDevice && mainDevice.is_registered !== true) {
        this.log('  ⚠ Device has MAC but is_registered=false', 'yellow');
        this.unregisteredWithMac.push({
          miner_key,
          address: ownerAddress,
          mac_address: macAddress,
          expected_portal: expectedPortal,
          source_collection: `air.${sourceCollection}`,
        });
      }

      this.log('\nActions to perform:', 'bold');
      this.log('  1. Upsert new-style credentials into creds.hardware');
      if (this.options.skipPortalUpdate) {
        this.log("  2. (Skipped) --skip-portal flag set", 'gray');
      } else {
        this.log(`  2. Set registered_portal_model='${expectedPortal}' in main.devices`);
      }
      this.log(`  3. Delete from air.${sourceCollection}`);

      // Prompt for confirmation
      const answer = await this.prompt(
        '\nProceed? [Y/n/skip/quit]: '
      );

      if (answer === 'quit' || answer === 'q') {
        return false;
      }

      if (answer === 'skip' || answer === 's' || answer === 'n') {
        this.log('  ⊘ Skipped by user', 'gray');
        this.stats.skipped++;
        this.logAction(miner_key, 'skipped', `air.${sourceCollection}`);
        return true;
      }

      if (this.options.dryRun) {
        this.log('\n[DRY RUN] Would migrate this device', 'yellow');
        if (needsPortalUpdate) {
          this.log('  [DRY RUN] Would update registered_portal_model', 'yellow');
        }
        this.stats.newlyMigrated++;
        return true;
      }

      // Perform migration
      // Step 1: Transform + upsert into creds.hardware

      const minerType = deriveMinerType(device) || 'HARDWARE';
      const credentialsSavedAt = resolveTimestamp(device.timestamp) ?? new Date();
      const hardwareDoc = {
        address: ownerAddress,
        miner_key,
        miner_type: minerType,
        credentials: { mac_address: macAddress },
        credentials_saved_at: credentialsSavedAt,
      };

      if (existingDoc) {
        await credsDb
          .collection('hardware')
          .replaceOne({ _id: existingDoc._id }, hardwareDoc);
        this.log('  ✓ Updated existing creds.hardware entry', 'green');
        this.stats.alreadyMigrated++;
      } else {
        await credsDb.collection('hardware').insertOne(hardwareDoc);
        this.log('  ✓ Inserted into creds.hardware', 'green');
        this.stats.newlyMigrated++;
      }

      // Step 2: Update registered_portal_model in main.devices
      if (mainDevice && needsPortalUpdate) {
        await mainDb.collection('devices').updateOne(
          { miner_key },
          { $set: { registered_portal_model: expectedPortal } }
        );
        this.log(`  ✓ Set registered_portal_model='${expectedPortal}'`, 'green');
      }

      // Step 3: Delete from old collection
      await this.client
        .db('air')
        .collection(sourceCollection)
        .deleteOne({ miner_key });
      this.log(`  ✓ Deleted from air.${sourceCollection}`, 'green');

      this.logAction(miner_key, existingDoc ? 'updated' : 'migrated', `air.${sourceCollection}`, {
        orphaned: !mainDevice,
        portal_updated: needsPortalUpdate,
        portal_expected: expectedPortal,
      });

      this.log('\n✅ Migration successful', 'green');
      return true;
    } catch (error) {
      this.log(`\n✗ Migration failed: ${error}`, 'red');
      this.stats.errors++;
      this.logAction(miner_key, 'error', `air.${sourceCollection}`, {
        error: String(error),
      });
      return true; // Continue with other devices
    }
  }

  async run() {
    try {
      await this.client.connect();
      this.log('🔌 Connected to MongoDB', 'green');

      // Create backups
      if (!this.options.dryRun) {
        await this.createBackups();
      }

      const airDb = this.client.db('air');

      // Build query filter
      const query = this.options.specificMinerKey
        ? { miner_key: this.options.specificMinerKey }
        : {};

      // Scan air.hardwares
      this.log('\n📊 Scanning air.hardwares...', 'blue');
      const hardwares = (await airDb
        .collection('hardwares')
        .find(query)
        .toArray()) as DeviceDocument[];
      this.stats.airHardwaresScanned = hardwares.length;
      this.log(`  Found ${hardwares.length} documents`, 'gray');

      // Scan air.nodes
      this.log('\n📊 Scanning air.nodes...', 'blue');
      const nodes = (await airDb
        .collection('nodes')
        .find(query)
        .toArray()) as DeviceDocument[];
      this.stats.airNodesScanned = nodes.length;
      this.log(`  Found ${nodes.length} documents`, 'gray');

      const totalDevices = hardwares.length + nodes.length;
      if (totalDevices === 0) {
        this.log('\n✓ No devices to migrate', 'green');
        return;
      }

      this.log(
        `\n📋 Total devices to process: ${totalDevices}`,
        'bold'
      );

      if (this.options.dryRun) {
        this.log('  [DRY RUN MODE - No changes will be made]', 'yellow');
      }

      // Process hardwares
      for (const device of hardwares) {
        const shouldContinue = await this.migrateDevice(device, 'hardwares');
        if (!shouldContinue) {
          this.log('\n⊘ Migration cancelled by user', 'yellow');
          break;
        }
      }

      // Process nodes
      for (const device of nodes) {
        const shouldContinue = await this.migrateDevice(device, 'nodes');
        if (!shouldContinue) {
          this.log('\n⊘ Migration cancelled by user', 'yellow');
          break;
        }
      }

      // Generate report
      await this.generateReport();
    } catch (error) {
      this.log(`\n✗ Migration failed: ${error}`, 'red');
      console.error(error);
      process.exit(1);
    } finally {
      this.rl.close();
      await this.client.close();
    }
  }

  private async generateReport() {
    this.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'bold');
    this.log('📊 MIGRATION SUMMARY', 'bold');
    this.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'bold');

    this.log(`\nDocuments Scanned:`, 'blue');
    this.log(`  air.hardwares: ${this.stats.airHardwaresScanned}`);
    this.log(`  air.nodes: ${this.stats.airNodesScanned}`);
    this.log(
      `  Total: ${
        this.stats.airHardwaresScanned + this.stats.airNodesScanned
      }`
    );

    this.log(`\nMigration Results:`, 'blue');
    this.log(`  Already migrated: ${this.stats.alreadyMigrated}`, 'yellow');
    this.log(`  Newly migrated: ${this.stats.newlyMigrated}`, 'green');
    this.log(`  Orphaned: ${this.stats.orphaned}`, 'yellow');
    this.log(`  Skipped: ${this.stats.skipped}`, 'gray');
    this.log(`  Errors: ${this.stats.errors}`, this.stats.errors > 0 ? 'red' : 'gray');

    if (!this.options.dryRun) {
      // Verify collections are empty
      const airDb = this.client.db('air');
      const hardwaresRemaining = await airDb
        .collection('hardwares')
        .countDocuments();
      const nodesRemaining = await airDb.collection('nodes').countDocuments();
      const credsHardwareTotal = await this.client
        .db('creds')
        .collection('hardware')
        .countDocuments();

      this.log(`\nVerification:`, 'blue');
      this.log(
        `  air.hardwares remaining: ${hardwaresRemaining}`,
        hardwaresRemaining === 0 ? 'green' : 'red'
      );
      this.log(
        `  air.nodes remaining: ${nodesRemaining}`,
        nodesRemaining === 0 ? 'green' : 'red'
      );
      this.log(`  creds.hardware total: ${credsHardwareTotal}`, 'green');
    }

    // Save log file(s)
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.mkdirSync(this.options.backupDir, { recursive: true });

    const logPath = path.join(
      this.options.backupDir,
      `migration-log-${timestamp}.json`
    );

    const logData = {
      timestamp: new Date().toISOString(),
      options: this.options,
      summary: this.stats,
      details: this.migrationLog,
    };

    fs.writeFileSync(logPath, JSON.stringify(logData, null, 2));
    this.log(`\n📄 Log saved to: ${logPath}`, 'gray');

    if (this.unregisteredWithMac.length > 0) {
      const unregisteredPath = path.join(
        this.options.backupDir,
        `unregistered-with-mac-${timestamp}.json`
      );
      fs.writeFileSync(unregisteredPath, JSON.stringify(this.unregisteredWithMac, null, 2));
      this.log(
        `⚠ Found ${this.unregisteredWithMac.length} device(s) with MAC credentials but is_registered=false. Logged to ${unregisteredPath}`,
        'yellow'
      );
    } else {
      this.log('\n✓ No devices with MAC credentials and is_registered=false', 'green');
    }

    this.log('\n✅ Migration complete!', 'green');
  }
}

// Parse command line arguments
function parseArgs(): MigrationOptions {
  const args = process.argv.slice(2);
  const options: MigrationOptions = {
    auto: false,
    dryRun: false,
    skipPortalUpdate: false,
    backupDir: './backups',
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--auto':
        options.auto = true;
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--skip-portal':
        options.skipPortalUpdate = true;
        break;
      case '--miner-key':
        options.specificMinerKey = args[++i];
        break;
      case '--backup-dir':
        options.backupDir = args[++i];
        break;
      case '--help':
        console.log(`
Hardware Credentials Migration Tool

Usage: npm run migrate-hardware-creds [options]

Options:
  --auto              Auto-approve all migrations (no prompts)
  --dry-run           Preview changes without executing
  --miner-key <key>   Migrate specific miner key only
  --skip-portal       Don't update registered_portal_model
  --backup-dir <path> Custom backup directory (default: ./backups)
  --help              Show this help message
        `);
        process.exit(0);
    }
  }

  return options;
}

// Main execution
async function main() {
  const options = parseArgs();

  // Get MongoDB URI from environment
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    console.error('Error: MONGO_URI environment variable not set');
    process.exit(1);
  }

  const tool = new MigrationTool(mongoUri, options);
  await tool.run();
}

// Run if executed directly
if (require.main === module) {
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}
