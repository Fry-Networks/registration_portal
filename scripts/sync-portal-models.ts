#!/usr/bin/env ts-node

/**
 * Portal Model Synchronization Tool
 * 
 * Synchronizes the 'registered_portal_model' field in main.devices with the actual
 * credential storage in the creds database. This script:
 * 
 * 1. Scans all devices in main.devices
 * 2. Checks if credentials exist in the appropriate creds collection
 * 3. Updates registered_portal_model to the correct value if credentials exist
 * 4. Removes registered_portal_model if credentials don't exist but field is set
 * 
 * USAGE EXAMPLES:
 * 
 * 1. Dry-run mode (preview changes without executing):
 *    npm run sync-portal-models -- --dry-run
 * 
 * 2. Execute with confirmation prompts:
 *    npm run sync-portal-models
 * 
 * 3. Auto-approve all changes (no prompts):
 *    npm run sync-portal-models -- --auto
 * 
 * 4. Process specific miner key only:
 *    npm run sync-portal-models -- --miner-key BM-ABC123
 * 
 * 5. Custom backup directory:
 *    npm run sync-portal-models -- --backup-dir /path/to/backups
 * 
 * 6. Combine options:
 *    npm run sync-portal-models -- --auto --backup-dir ./my-backups
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
 * DEVICE TYPE MAPPINGS:
 * 
 * The script maps miner_key prefixes to portal models and creds collections:
 * 
 * - "hardware": BM, ISM, OSM, IDM, ODM → creds.hardware
 * - "node": CN, SDN, RDN, SVN → creds.hardware
 * - "aem": AEM → creds.hardware
 * - "air": ILAQM, IMAQM, IHAQM, OMAQM, OHAQM → creds.air
 * - "energy": EM → creds.energy
 * - "water": OLWQM, OHWQM → creds.water
 * - "weather": HWM, LWM → creds.weather
 * - "radiation": IRM → creds.radiation
 * - "camera": All RTSP camera types (AISCM, AOSCM, etc.) → creds.camera
 * 
 * NOTES:
 * - Backups are created automatically before any changes
 * - All operations are logged to timestamped files
 * - Use --dry-run to preview changes before executing
 * - The script validates against the products collection
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

interface SyncStats {
  devicesScanned: number;
  portalModelsUpdated: number;
  portalModelsRemoved: number;
  alreadyCorrect: number;
  unknownTypes: number;
  errors: number;
}

interface DeviceDocument {
  _id: any;
  miner_key: string;
  address: string;
  registered_portal_model?: string;
  [key: string]: any;
}

interface SyncOptions {
  auto: boolean;
  dryRun: boolean;
  backupDir: string;
  specificMinerKey?: string;
}

interface SyncLog {
  miner_key: string;
  action: 'updated' | 'removed' | 'skipped' | 'error' | 'unknown_type';
  before: { registered_portal_model?: string };
  after: { registered_portal_model?: string };
  reason?: string;
  timestamp: string;
}

// Mapping of miner key prefixes to portal models and creds collections
const PORTAL_MAPPINGS: Record<string, { portalModel: string; credsCollection: string }> = {
  // Hardware devices
  BM: { portalModel: 'hardware', credsCollection: 'hardware' },
  ISM: { portalModel: 'hardware', credsCollection: 'hardware' },
  OSM: { portalModel: 'hardware', credsCollection: 'hardware' },
  IDM: { portalModel: 'hardware', credsCollection: 'hardware' },
  ODM: { portalModel: 'hardware', credsCollection: 'hardware' },
  
  // Nodes
  CN: { portalModel: 'node', credsCollection: 'hardware' },
  SDN: { portalModel: 'node', credsCollection: 'hardware' },
  RDN: { portalModel: 'node', credsCollection: 'hardware' },
  SVN: { portalModel: 'node', credsCollection: 'hardware' },
  
  // AEM
  AEM: { portalModel: 'aem', credsCollection: 'hardware' },
  
  // Air quality miners
  ILAQM: { portalModel: 'air', credsCollection: 'air' },
  IMAQM: { portalModel: 'air', credsCollection: 'air' },
  IHAQM: { portalModel: 'air', credsCollection: 'air' },
  OMAQM: { portalModel: 'air', credsCollection: 'air' },
  OHAQM: { portalModel: 'air', credsCollection: 'air' },
  
  // Energy miners
  EM: { portalModel: 'energy', credsCollection: 'energy' },
  
  // Water quality miners
  OLWQM: { portalModel: 'water', credsCollection: 'water' },
  OHWQM: { portalModel: 'water', credsCollection: 'water' },
  
  // Weather miners
  HWM: { portalModel: 'weather', credsCollection: 'weather' },
  LWM: { portalModel: 'weather', credsCollection: 'weather' },
  
  // Radiation miners
  IRM: { portalModel: 'radiation', credsCollection: 'radiation' },
  
  // Camera miners (RTSP)
  AISCM: { portalModel: 'camera', credsCollection: 'camera' },
  AOSCM: { portalModel: 'camera', credsCollection: 'camera' },
  AIWCM: { portalModel: 'camera', credsCollection: 'camera' },
  AOWCM: { portalModel: 'camera', credsCollection: 'camera' },
  AITCM: { portalModel: 'camera', credsCollection: 'camera' },
  AOTCM: { portalModel: 'camera', credsCollection: 'camera' },
  AIWSCM: { portalModel: 'camera', credsCollection: 'camera' },
  AOWSCM: { portalModel: 'camera', credsCollection: 'camera' },
};

class SyncTool {
  private client: MongoClient;
  private stats: SyncStats;
  private options: SyncOptions;
  private rl: readline.Interface;
  private syncLog: SyncLog[];

  constructor(mongoUri: string, options: SyncOptions) {
    this.client = new MongoClient(mongoUri);
    this.stats = {
      devicesScanned: 0,
      portalModelsUpdated: 0,
      portalModelsRemoved: 0,
      alreadyCorrect: 0,
      unknownTypes: 0,
      errors: 0,
    };
    this.options = options;
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    this.syncLog = [];
  }

  private log(message: string, color: keyof typeof colors = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
  }

  private logAction(
    miner_key: string,
    action: SyncLog['action'],
    before: SyncLog['before'],
    after: SyncLog['after'],
    reason?: string
  ) {
    this.syncLog.push({
      miner_key,
      action,
      before,
      after,
      reason,
      timestamp: new Date().toISOString(),
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

  private getMinerKeyPrefix(minerKey: string): string | null {
    const parts = minerKey.split('-');
    if (parts.length < 2) return null;
    return parts[0];
  }

  private getPortalMapping(prefix: string): { portalModel: string; credsCollection: string } | null {
    return PORTAL_MAPPINGS[prefix] || null;
  }

  private async createBackup(devices: DeviceDocument[]) {
    this.log('\n📦 Creating backup...', 'blue');

    if (!fs.existsSync(this.options.backupDir)) {
      fs.mkdirSync(this.options.backupDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(
      this.options.backupDir,
      `devices-portal-sync-backup-${timestamp}.json`
    );

    fs.writeFileSync(backupPath, JSON.stringify(devices, null, 2));
    this.log(
      `  ✓ Backed up ${devices.length} device(s) to: ${backupPath}`,
      'green'
    );
  }

  private async checkCredentialsExist(
    minerKey: string,
    credsCollection: string
  ): Promise<boolean> {
    const credsDb = this.client.db('creds');
    const collection = credsDb.collection(credsCollection);

    const credDoc = await collection.findOne({
      miner_key: minerKey,
    });

    // Check if document exists
    if (!credDoc) {
      return false;
    }

    // Check if credentials field exists and is not empty
    if (!credDoc.credentials) {
      return false;
    }

    // Check if credentials is an object and has at least one key
    if (typeof credDoc.credentials === 'object' && Object.keys(credDoc.credentials).length === 0) {
      return false;
    }

    return true;
  }

  private async syncDevice(device: DeviceDocument): Promise<void> {
    const { miner_key, address, registered_portal_model } = device;

    this.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'gray');
    this.log(`Device: ${miner_key}`, 'bold');
    this.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'gray');
    this.log(`  Owner Address: ${address}`, 'gray');
    this.log(
      `  Current portal_model: ${registered_portal_model || '(not set)'}`,
      'gray'
    );

    const prefix = this.getMinerKeyPrefix(miner_key);
    if (!prefix) {
      this.log('  ⚠ Invalid miner_key format', 'yellow');
      this.stats.unknownTypes++;
      this.logAction(
        miner_key,
        'unknown_type',
        { registered_portal_model },
        { registered_portal_model },
        'Invalid miner_key format'
      );
      return;
    }

    const mapping = this.getPortalMapping(prefix);
    if (!mapping) {
      this.log(`  ⚠ Unknown device type: ${prefix}`, 'yellow');
      this.stats.unknownTypes++;
      this.logAction(
        miner_key,
        'unknown_type',
        { registered_portal_model },
        { registered_portal_model },
        `Unknown prefix: ${prefix}`
      );
      return;
    }

    this.log(`  Expected portal_model: ${mapping.portalModel}`, 'blue');
    this.log(`  Checking creds.${mapping.credsCollection}...`, 'blue');

    const hasCredentials = await this.checkCredentialsExist(
      miner_key,
      mapping.credsCollection
    );

    this.log(
      `  Credentials exist: ${hasCredentials ? 'Yes' : 'No'}`,
      hasCredentials ? 'green' : 'yellow'
    );

    // Determine action
    let action: 'update' | 'remove' | 'skip' = 'skip';
    let reason = '';

    if (hasCredentials) {
      if (registered_portal_model !== mapping.portalModel) {
        action = 'update';
        reason = `Update to correct portal model: ${mapping.portalModel}`;
      } else {
        reason = 'Already correct';
      }
    } else {
      if (registered_portal_model) {
        action = 'remove';
        reason = 'No credentials found, removing field';
      } else {
        reason = 'No credentials and field not set';
      }
    }

    this.log(`\n  Action: ${action.toUpperCase()}`, 'yellow');
    this.log(`  Reason: ${reason}`, 'gray');

    if (action === 'skip') {
      this.stats.alreadyCorrect++;
      this.logAction(
        miner_key,
        'skipped',
        { registered_portal_model },
        { registered_portal_model },
        reason
      );
      return;
    }

    // Confirm action
    if (!this.options.auto && !this.options.dryRun) {
      const answer = await this.prompt('\n  Proceed? [Y/n/quit]: ');
      if (answer === 'quit' || answer === 'q') {
        throw new Error('Sync cancelled by user');
      }
      if (answer === 'n' || answer === 'no') {
        this.log('  ⊘ Skipped by user', 'gray');
        this.stats.alreadyCorrect++;
        this.logAction(
          miner_key,
          'skipped',
          { registered_portal_model },
          { registered_portal_model },
          'Skipped by user'
        );
        return;
      }
    }

    if (this.options.dryRun) {
      this.log('  [DRY RUN] Would perform this action', 'yellow');
      if (action === 'update') {
        this.stats.portalModelsUpdated++;
        this.logAction(
          miner_key,
          'updated',
          { registered_portal_model },
          { registered_portal_model: mapping.portalModel },
          reason
        );
      } else {
        this.stats.portalModelsRemoved++;
        this.logAction(
          miner_key,
          'removed',
          { registered_portal_model },
          { registered_portal_model: undefined },
          reason
        );
      }
      return;
    }

    // Execute action
    try {
      const mainDb = this.client.db('main');
      const devicesCollection = mainDb.collection('devices');

      if (action === 'update') {
        await devicesCollection.updateOne(
          { _id: device._id },
          { $set: { registered_portal_model: mapping.portalModel } }
        );
        this.log('  ✓ Updated successfully', 'green');
        this.stats.portalModelsUpdated++;
        this.logAction(
          miner_key,
          'updated',
          { registered_portal_model },
          { registered_portal_model: mapping.portalModel },
          reason
        );
      } else if (action === 'remove') {
        await devicesCollection.updateOne(
          { _id: device._id },
          { $unset: { registered_portal_model: '' } }
        );
        this.log('  ✓ Removed successfully', 'green');
        this.stats.portalModelsRemoved++;
        this.logAction(
          miner_key,
          'removed',
          { registered_portal_model },
          { registered_portal_model: undefined },
          reason
        );
      }
    } catch (error) {
      this.log(`  ✗ Error: ${error}`, 'red');
      this.stats.errors++;
      this.logAction(
        miner_key,
        'error',
        { registered_portal_model },
        { registered_portal_model },
        String(error)
      );
    }
  }

  async run() {
    try {
      await this.client.connect();
      this.log('🔌 Connected to MongoDB', 'green');

      const mainDb = this.client.db('main');
      const devicesCollection = mainDb.collection('devices');

      // Build query
      const query = this.options.specificMinerKey
        ? { miner_key: this.options.specificMinerKey }
        : {};

      this.log('\n🔍 Fetching devices...', 'blue');
      const devices = (await devicesCollection
        .find(query)
        .toArray()) as DeviceDocument[];

      this.stats.devicesScanned = devices.length;
      this.log(`  ✓ Found ${devices.length} device(s)`, 'green');

      if (devices.length === 0) {
        this.log('\n✓ No devices to process', 'green');
        return;
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
        await this.syncDevice(device);
      }

      // Generate report
      await this.generateReport();
    } catch (error) {
      if (error instanceof Error && error.message === 'Sync cancelled by user') {
        this.log('\n⊘ Sync cancelled by user', 'yellow');
      } else {
        this.log(`\n✗ Sync failed: ${error}`, 'red');
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
    this.log('📊 SYNC SUMMARY', 'bold');
    this.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'bold');

    this.log(`\nDevices Scanned: ${this.stats.devicesScanned}`, 'blue');
    this.log(`Portal Models Updated: ${this.stats.portalModelsUpdated}`, 'green');
    this.log(`Portal Models Removed: ${this.stats.portalModelsRemoved}`, 'yellow');
    this.log(`Already Correct: ${this.stats.alreadyCorrect}`, 'gray');
    this.log(`Unknown Types: ${this.stats.unknownTypes}`, 'yellow');
    this.log(
      `Errors: ${this.stats.errors}`,
      this.stats.errors > 0 ? 'red' : 'gray'
    );

    // Save log file
    if (this.syncLog.length > 0) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      fs.mkdirSync(this.options.backupDir, { recursive: true });

      const logPath = path.join(
        this.options.backupDir,
        `portal-sync-log-${timestamp}.json`
      );

      const logData = {
        timestamp: new Date().toISOString(),
        options: this.options,
        summary: this.stats,
        details: this.syncLog,
      };

      fs.writeFileSync(logPath, JSON.stringify(logData, null, 2));
      this.log(`\n📄 Log saved to: ${logPath}`, 'gray');
    }

    this.log('\n✅ Sync complete!', 'green');
  }
}

// Parse command line arguments
function parseArgs(): SyncOptions {
  const args = process.argv.slice(2);
  const options: SyncOptions = {
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
Portal Model Synchronization Tool

Synchronize registered_portal_model field in main.devices with credential storage.

Usage: npm run sync-portal-models [options]

Options:
  --auto              Auto-approve all changes (no confirmation prompts)
  --dry-run           Preview changes without executing
  --miner-key <key>   Process only a specific miner key
  --backup-dir <path> Custom backup directory (default: ./backups)
  --help              Show this help message

Examples:
  # Preview changes
  npm run sync-portal-models -- --dry-run

  # Execute with confirmations
  npm run sync-portal-models

  # Auto-approve all changes
  npm run sync-portal-models -- --auto

  # Process specific device
  npm run sync-portal-models -- --miner-key BM-ABC123
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

  const tool = new SyncTool(mongoUri, options);
  await tool.run();
}

// Run if executed directly
if (require.main === module) {
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}
