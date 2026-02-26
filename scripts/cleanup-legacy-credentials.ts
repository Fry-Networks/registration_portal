#!/usr/bin/env ts-node

/**
 * Legacy Credentials Cleanup Tool
 * 
 * Removes legacy credential fields from main.devices collection that are no longer needed
 * since credentials are now stored in the creds database. This script removes:
 * - rtsp (RTSP camera credentials)
 * - mac (MAC addresses)
 * - apikey (API keys - lowercase 'k')
 * - api_key (API keys - uppercase 'K')
 * 
 * USAGE EXAMPLES:
 * 
 * 1. Dry-run mode (preview changes without executing):
 *    npm run cleanup-legacy-creds -- --dry-run
 * 
 * 2. Execute with confirmation prompts:
 *    npm run cleanup-legacy-creds
 * 
 * 3. Auto-approve all changes (no prompts):
 *    npm run cleanup-legacy-creds -- --auto
 * 
 * 4. Process specific miner key only:
 *    npm run cleanup-legacy-creds -- --miner-key EM-ABC123
 * 
 * 5. Custom backup directory:
 *    npm run cleanup-legacy-creds -- --backup-dir /path/to/backups
 * 
 * FLAGS:
 * 
 * Execution Options:
 *   --auto                Auto-approve all changes (no confirmation prompts)
 *   --dry-run            Preview changes without executing
 *   --miner-key <key>    Process only a specific miner key
 *   --backup-dir <path>  Custom backup directory (default: ./backups)
 *   --help               Show this help message
 * 
 * LEGACY FIELDS TO BE REMOVED:
 * 
 * - rtsp: RTSP camera credentials (now in creds.camera)
 * - mac: MAC addresses (now in creds.hardware or creds.air)
 * - apikey: API keys lowercase (now in creds.energy, creds.weather, creds.water)
 * - api_key: API keys uppercase (now in creds.energy, creds.weather, creds.water)
 * 
 * NOTES:
 * - Backups are created automatically before any changes
 * - All operations are logged to timestamped files
 * - Use --dry-run to preview changes before executing
 * - Only removes these specific legacy fields, all other data is preserved
 */

import 'dotenv/config';
import { MongoClient } from 'mongodb';
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

interface CleanupStats {
  devicesScanned: number;
  devicesCleaned: number;
  devicesSkipped: number;
  errors: number;
}

interface DeviceDocument {
  _id: any;
  miner_key: string;
  address?: string;
  rtsp?: any;
  mac?: any;
  apikey?: any;
  api_key?: any;
  [key: string]: any;
}

interface CleanupOptions {
  auto: boolean;
  dryRun: boolean;
  backupDir: string;
  specificMinerKey?: string;
}

interface CleanupLog {
  miner_key: string;
  action: 'cleaned' | 'skipped' | 'error';
  fields_removed: string[];
  timestamp: string;
  error?: string;
}

const LEGACY_FIELDS = ['rtsp', 'mac', 'apikey', 'api_key'];

class CleanupTool {
  private client: MongoClient;
  private stats: CleanupStats;
  private options: CleanupOptions;
  private rl: readline.Interface;
  private cleanupLog: CleanupLog[];

  constructor(mongoUri: string, options: CleanupOptions) {
    this.client = new MongoClient(mongoUri);
    this.stats = {
      devicesScanned: 0,
      devicesCleaned: 0,
      devicesSkipped: 0,
      errors: 0,
    };
    this.options = options;
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    this.cleanupLog = [];
  }

  private log(message: string, color: keyof typeof colors = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
  }

  private logAction(
    miner_key: string,
    action: CleanupLog['action'],
    fields_removed: string[],
    error?: string
  ) {
    this.cleanupLog.push({
      miner_key,
      action,
      fields_removed,
      timestamp: new Date().toISOString(),
      error,
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

  private async createBackup(devices: DeviceDocument[]) {
    this.log('\n📦 Creating backup...', 'blue');

    if (!fs.existsSync(this.options.backupDir)) {
      fs.mkdirSync(this.options.backupDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(
      this.options.backupDir,
      `devices-legacy-cleanup-backup-${timestamp}.json`
    );

    fs.writeFileSync(backupPath, JSON.stringify(devices, null, 2));
    this.log(
      `  ✓ Backed up ${devices.length} device(s) to: ${backupPath}`,
      'green'
    );
  }

  private getLegacyFields(device: DeviceDocument): string[] {
    const fieldsFound: string[] = [];
    for (const field of LEGACY_FIELDS) {
      if (field in device && device[field] !== undefined) {
        fieldsFound.push(field);
      }
    }
    return fieldsFound;
  }

  private async cleanDevice(device: DeviceDocument): Promise<void> {
    const { miner_key, address } = device;
    const legacyFields = this.getLegacyFields(device);

    if (legacyFields.length === 0) {
      this.stats.devicesSkipped++;
      return;
    }

    this.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'gray');
    this.log(`Device: ${miner_key}`, 'bold');
    this.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'gray');
    this.log(`  Owner Address: ${address || '(not set)'}`, 'gray');
    this.log(`  Legacy fields found: ${legacyFields.join(', ')}`, 'yellow');

    // Show field values (truncated for security)
    for (const field of legacyFields) {
      const value = device[field];
      const displayValue =
        typeof value === 'string'
          ? value.length > 50
            ? value.substring(0, 50) + '...'
            : value
          : JSON.stringify(value);
      this.log(`    ${field}: ${displayValue}`, 'gray');
    }

    this.log(
      `\n  Action: Remove ${legacyFields.length} legacy field(s)`,
      'yellow'
    );

    // Confirm action
    if (!this.options.auto && !this.options.dryRun) {
      const answer = await this.prompt('\n  Proceed? [Y/n/quit]: ');
      if (answer === 'quit' || answer === 'q') {
        throw new Error('Cleanup cancelled by user');
      }
      if (answer === 'n' || answer === 'no') {
        this.log('  ⊘ Skipped by user', 'gray');
        this.stats.devicesSkipped++;
        this.logAction(miner_key, 'skipped', legacyFields);
        return;
      }
    }

    if (this.options.dryRun) {
      this.log('  [DRY RUN] Would remove these fields', 'yellow');
      this.stats.devicesCleaned++;
      this.logAction(miner_key, 'cleaned', legacyFields);
      return;
    }

    // Execute cleanup
    try {
      const mainDb = this.client.db('main');
      const devicesCollection = mainDb.collection('devices');

      // Build $unset operation for all legacy fields
      const unsetFields: Record<string, ''> = {};
      for (const field of legacyFields) {
        unsetFields[field] = '';
      }

      await devicesCollection.updateOne(
        { _id: device._id },
        { $unset: unsetFields }
      );

      this.log('  ✓ Cleaned successfully', 'green');
      this.stats.devicesCleaned++;
      this.logAction(miner_key, 'cleaned', legacyFields);
    } catch (error) {
      this.log(`  ✗ Error: ${error}`, 'red');
      this.stats.errors++;
      this.logAction(miner_key, 'error', legacyFields, String(error));
    }
  }

  async run() {
    try {
      await this.client.connect();
      this.log('🔌 Connected to MongoDB', 'green');

      const mainDb = this.client.db('main');
      const devicesCollection = mainDb.collection('devices');

      // Build query to find devices with legacy fields
      let query: any;
      if (this.options.specificMinerKey) {
        query = { miner_key: this.options.specificMinerKey };
      } else {
        query = {
          $or: LEGACY_FIELDS.map((field) => ({ [field]: { $exists: true } })),
        };
      }

      this.log('\n🔍 Fetching devices with legacy fields...', 'blue');
      const devices = (await devicesCollection
        .find(query)
        .toArray()) as DeviceDocument[];

      this.stats.devicesScanned = devices.length;
      this.log(`  ✓ Found ${devices.length} device(s)`, 'green');

      if (devices.length === 0) {
        this.log('\n✓ No devices with legacy fields found', 'green');
        return;
      }

      // Show summary of fields to be removed
      const fieldCounts: Record<string, number> = {};
      for (const device of devices) {
        const fields = this.getLegacyFields(device);
        for (const field of fields) {
          fieldCounts[field] = (fieldCounts[field] || 0) + 1;
        }
      }

      this.log('\n📊 Legacy Field Summary:', 'blue');
      for (const [field, count] of Object.entries(fieldCounts)) {
        this.log(`  ${field}: ${count} device(s)`, 'gray');
      }

      // Create backup before changes
      if (!this.options.dryRun) {
        await this.createBackup(devices);
      }

      if (this.options.dryRun) {
        this.log('\n[DRY RUN MODE - No changes will be made]', 'yellow');
      }

      // Process each device
      this.log('\n📋 Processing devices...', 'bold');
      for (const device of devices) {
        await this.cleanDevice(device);
      }

      // Generate report
      await this.generateReport();
    } catch (error) {
      if (error instanceof Error && error.message === 'Cleanup cancelled by user') {
        this.log('\n⊘ Cleanup cancelled by user', 'yellow');
      } else {
        this.log(`\n✗ Cleanup failed: ${error}`, 'red');
        console.error(error);
        process.exit(1);
      }
    } finally {
      this.rl.close();
      await this.client.close();
    }
  }

  private async generateReport() {
    this.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'bold');
    this.log('📊 CLEANUP SUMMARY', 'bold');
    this.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'bold');

    this.log(`\nDevices Scanned: ${this.stats.devicesScanned}`, 'blue');
    this.log(`Devices Cleaned: ${this.stats.devicesCleaned}`, 'green');
    this.log(`Devices Skipped: ${this.stats.devicesSkipped}`, 'gray');
    this.log(
      `Errors: ${this.stats.errors}`,
      this.stats.errors > 0 ? 'red' : 'gray'
    );

    // Calculate total fields removed
    const totalFieldsRemoved = this.cleanupLog.reduce(
      (sum, log) => sum + log.fields_removed.length,
      0
    );
    this.log(`\nTotal Legacy Fields Removed: ${totalFieldsRemoved}`, 'green');

    // Save log file
    if (this.cleanupLog.length > 0) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      fs.mkdirSync(this.options.backupDir, { recursive: true });

      const logPath = path.join(
        this.options.backupDir,
        `legacy-cleanup-log-${timestamp}.json`
      );

      const logData = {
        timestamp: new Date().toISOString(),
        options: this.options,
        summary: this.stats,
        details: this.cleanupLog,
      };

      fs.writeFileSync(logPath, JSON.stringify(logData, null, 2));
      this.log(`\n📄 Log saved to: ${logPath}`, 'gray');
    }

    this.log('\n✅ Cleanup complete!', 'green');
  }
}

// Parse command line arguments
function parseArgs(): CleanupOptions {
  const args = process.argv.slice(2);
  const options: CleanupOptions = {
    auto: false,
    dryRun: false,
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
      case '--backup-dir':
        options.backupDir = args[++i];
        break;
      case '--miner-key':
        options.specificMinerKey = args[++i];
        break;
      case '--help':
        console.log(`
Legacy Credentials Cleanup Tool

Remove legacy credential fields from main.devices collection.

Usage: npm run cleanup-legacy-creds [options]

Options:
  --auto              Auto-approve all changes (no confirmation prompts)
  --dry-run           Preview changes without executing
  --miner-key <key>   Process only a specific miner key
  --backup-dir <path> Custom backup directory (default: ./backups)
  --help              Show this help message

Legacy Fields Removed:
  - rtsp      RTSP camera credentials (now in creds.camera)
  - mac       MAC addresses (now in creds.hardware or creds.air)
  - apikey    API keys lowercase (now in creds.energy/weather/water)
  - api_key   API keys uppercase (now in creds.energy/weather/water)

Examples:
  # Preview changes
  npm run cleanup-legacy-creds -- --dry-run

  # Execute with confirmations
  npm run cleanup-legacy-creds

  # Auto-approve all changes
  npm run cleanup-legacy-creds -- --auto

  # Process specific device
  npm run cleanup-legacy-creds -- --miner-key EM-ABC123
        `);
        process.exit(0);
    }
  }

  return options;
}

// Main execution
async function main() {
  const options = parseArgs();

  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    console.error('Error: MONGO_URI environment variable not set');
    process.exit(1);
  }

  const tool = new CleanupTool(mongoUri, options);
  await tool.run();
}

// Run if executed directly
if (require.main === module) {
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}
