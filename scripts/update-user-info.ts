#!/usr/bin/env ts-node

/**
 * User Information Update Tool
 * 
 * Interactive CLI tool for updating user email addresses and wallet addresses in the devices collection.
 * This tool can search by email, miner_key, or wallet address, and update email or wallet fields.
 * When updating wallet addresses, both 'address' and 'reward_wallet' fields are updated simultaneously.
 * 
 * USAGE EXAMPLES:
 * 
 * 1. Interactive Mode (recommended for first-time use):
 *    npm run update-user-info
 *    - The script will prompt you for search criteria and what to update
 * 
 * 2. Search by wallet and update to new wallet (non-interactive):
 *    npm run update-user-info -- --search-wallet WUUTEKWFDPX4ZIQ64IVKCFJ7F32YCNNOT3FO5LFPIMZIFVGNVE7QOR5NRQ --new-wallet GU7VPYCM2TGILKYBT4NJJ3TCZEMY3KIPRCVGCS4WKZKAUQ2LY67NO4N7GA --auto
 * 
 * 3. Search by email and update email (with confirmation prompts):
 *    npm run update-user-info -- --search-email user@example.com --new-email newemail@example.com
 * 
 * 4. Search by specific miner key and update wallet:
 *    npm run update-user-info -- --search-miner-key BM-ABC123 --new-wallet GU7VPYCM2TGILKYBT4NJJ3TCZEMY3KIPRCVGCS4WKZKAUQ2LY67NO4N7GA
 * 
 * 5. Dry-run mode (preview changes without executing):
 *    npm run update-user-info -- --search-wallet WUUT... --new-wallet GU7V... --dry-run
 * 
 * 6. Custom backup directory:
 *    npm run update-user-info -- --search-wallet WUUT... --new-wallet GU7V... --backup-dir /path/to/backups
 * 
 * 7. Combine multiple options:
 *    npm run update-user-info -- --search-wallet WUUT... --new-wallet GU7V... --auto --dry-run --backup-dir ./my-backups
 * 
 * FLAGS:
 * 
 * Search Options (use one):
 *   --search-email <email>       Search for devices by email address
 *   --search-wallet <address>    Search for devices by wallet address
 *   --search-miner-key <key>     Search for a specific device by miner key
 * 
 * Update Options (use one):
 *   --new-email <email>          Set new email address for found devices
 *   --new-wallet <address>       Set new wallet address (updates both 'address' and 'reward_wallet')
 * 
 * Execution Options:
 *   --auto                       Auto-approve all updates (no confirmation prompts)
 *   --dry-run                    Preview changes without executing (shows what would be updated)
 *   --backup-dir <path>          Custom backup directory (default: ./backups)
 *   --help                       Show this help message
 * 
 * NOTES:
 * - If no search or update flags are provided, the script runs in interactive mode
 * - Wallet addresses are validated to ensure they are 58-character Algorand addresses
 * - Backups are created automatically before any changes are made
 * - All operations are logged to timestamped files in the backup directory
 * - Use --dry-run to preview changes before executing for real
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

interface UpdateStats {
  devicesFound: number;
  devicesUpdated: number;
  devicesSkipped: number;
  errors: number;
}

interface DeviceDocument {
  _id: any;
  miner_key: string;
  address: string;
  reward_wallet?: string;
  email: string;
  name?: string;
  nickname?: string;
  is_registered?: boolean;
  [key: string]: any;
}

interface UpdateOptions {
  auto: boolean;
  dryRun: boolean;
  backupDir: string;
  searchType?: 'email' | 'wallet' | 'miner_key';
  searchValue?: string;
  updateType?: 'email' | 'wallet';
  updateValue?: string;
}

interface UpdateLog {
  miner_key: string;
  action: string;
  before: any;
  after: any;
  timestamp: string;
}

const isValidAlgorandAddress = (address: string): boolean => {
  // Algorand addresses are 58 characters, base32 encoded
  if (!address || address.length !== 58) return false;
  // Check if it contains only valid base32 characters (A-Z, 2-7)
  return /^[A-Z2-7]{58}$/.test(address);
};

const isValidEmail = (email: string): boolean => {
  // Basic email validation
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
};

class UpdateTool {
  private client: MongoClient;
  private stats: UpdateStats;
  private options: UpdateOptions;
  private rl: readline.Interface;
  private updateLog: UpdateLog[];

  constructor(mongoUri: string, options: UpdateOptions) {
    this.client = new MongoClient(mongoUri);
    this.stats = {
      devicesFound: 0,
      devicesUpdated: 0,
      devicesSkipped: 0,
      errors: 0,
    };
    this.options = options;
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    this.updateLog = [];
  }

  private log(message: string, color: keyof typeof colors = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
  }

  private logAction(
    miner_key: string,
    action: string,
    before: any,
    after: any
  ) {
    this.updateLog.push({
      miner_key,
      action,
      before,
      after,
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

  private async promptInput(question: string): Promise<string> {
    return new Promise((resolve) => {
      this.rl.question(question, (answer) => {
        resolve(answer.trim());
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
      `devices-backup-${timestamp}.json`
    );

    fs.writeFileSync(backupPath, JSON.stringify(devices, null, 2));
    this.log(
      `  ✓ Backed up ${devices.length} device(s) to: ${backupPath}`,
      'green'
    );
  }

  private async interactiveMode(): Promise<void> {
    this.log('\n🔍 Interactive Mode', 'bold');
    this.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'gray');

    // Ask how to search
    this.log('\nHow would you like to search for devices?', 'blue');
    this.log('  1. By email address', 'gray');
    this.log('  2. By wallet address', 'gray');
    this.log('  3. By miner key (specific device)', 'gray');

    const searchChoice = await this.promptInput(
      '\nEnter your choice [1/2/3]: '
    );

    switch (searchChoice) {
      case '1':
        this.options.searchType = 'email';
        this.options.searchValue = await this.promptInput('Enter email address: ');
        if (!isValidEmail(this.options.searchValue)) {
          this.log('✗ Invalid email address format', 'red');
          return;
        }
        break;
      case '2':
        this.options.searchType = 'wallet';
        this.options.searchValue = await this.promptInput('Enter wallet address: ');
        if (!isValidAlgorandAddress(this.options.searchValue)) {
          this.log('✗ Invalid Algorand address (must be 58 characters)', 'red');
          return;
        }
        break;
      case '3':
        this.options.searchType = 'miner_key';
        this.options.searchValue = await this.promptInput('Enter miner key: ');
        break;
      default:
        this.log('✗ Invalid choice', 'red');
        return;
    }

    // Ask what to update
    this.log('\nWhat would you like to update?', 'blue');
    this.log('  1. Email address', 'gray');
    this.log('  2. Wallet address (updates both address and reward_wallet)', 'gray');

    const updateChoice = await this.promptInput('\nEnter your choice [1/2]: ');

    switch (updateChoice) {
      case '1':
        this.options.updateType = 'email';
        this.options.updateValue = await this.promptInput('Enter new email address: ');
        if (!isValidEmail(this.options.updateValue)) {
          this.log('✗ Invalid email address format', 'red');
          return;
        }
        break;
      case '2':
        this.options.updateType = 'wallet';
        this.options.updateValue = await this.promptInput(
          'Enter new wallet address: '
        );
        if (!isValidAlgorandAddress(this.options.updateValue)) {
          this.log('✗ Invalid Algorand address (must be 58 characters)', 'red');
          return;
        }
        break;
      default:
        this.log('✗ Invalid choice', 'red');
        return;
    }
  }

  private async findDevices(): Promise<DeviceDocument[]> {
    const mainDb = this.client.db('main');
    const devicesCollection = mainDb.collection('devices');

    let query: any = {};

    switch (this.options.searchType) {
      case 'email':
        query = { email: this.options.searchValue };
        break;
      case 'wallet':
        query = { address: this.options.searchValue };
        break;
      case 'miner_key':
        query = { miner_key: this.options.searchValue };
        break;
    }

    // Only search for registered devices
    query.is_registered = true;

    const devices = (await devicesCollection
      .find(query)
      .toArray()) as DeviceDocument[];

    this.stats.devicesFound = devices.length;
    return devices;
  }

  private displayDevice(device: DeviceDocument, index: number) {
    this.log(`\n  Device ${index + 1}:`, 'blue');
    this.log(`    Miner Key: ${device.miner_key}`, 'gray');
    this.log(`    Name: ${device.name || 'N/A'}`, 'gray');
    this.log(`    Nickname: ${device.nickname || 'N/A'}`, 'gray');
    this.log(`    Email: ${device.email}`, 'gray');
    this.log(`    Wallet (address): ${device.address}`, 'gray');
    this.log(`    Reward Wallet: ${device.reward_wallet || 'N/A'}`, 'gray');
    this.log(
      `    Registered: ${device.is_registered ? 'Yes' : 'No'}`,
      'gray'
    );
  }

  private async updateDevices(devices: DeviceDocument[]): Promise<void> {
    const mainDb = this.client.db('main');
    const devicesCollection = mainDb.collection('devices');

    for (let i = 0; i < devices.length; i++) {
      const device = devices[i];

      this.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'gray');
      this.log(`Processing Device ${i + 1} of ${devices.length}`, 'bold');
      this.displayDevice(device, i);

      // Show what will change
      this.log('\n  Changes to be made:', 'yellow');
      if (this.options.updateType === 'email') {
        this.log(`    Email: ${device.email} → ${this.options.updateValue}`, 'yellow');
      } else if (this.options.updateType === 'wallet') {
        this.log(
          `    Address: ${device.address} → ${this.options.updateValue}`,
          'yellow'
        );
        this.log(
          `    Reward Wallet: ${device.reward_wallet || 'N/A'} → ${this.options.updateValue}`,
          'yellow'
        );
      }

      // Prompt for confirmation
      const answer = await this.prompt('\n  Proceed with this update? [Y/n/skip/quit]: ');

      if (answer === 'quit' || answer === 'q') {
        this.log('\n⊘ Update cancelled by user', 'yellow');
        return;
      }

      if (answer === 'skip' || answer === 's' || answer === 'n') {
        this.log('  ⊘ Skipped by user', 'gray');
        this.stats.devicesSkipped++;
        continue;
      }

      if (this.options.dryRun) {
        this.log('  [DRY RUN] Would update this device', 'yellow');
        this.stats.devicesUpdated++;
        continue;
      }

      try {
        let updateData: any = {};
        const before: any = {};
        const after: any = {};

        if (this.options.updateType === 'email') {
          before.email = device.email;
          after.email = this.options.updateValue;
          updateData.email = this.options.updateValue;
        } else if (this.options.updateType === 'wallet') {
          before.address = device.address;
          before.reward_wallet = device.reward_wallet;
          after.address = this.options.updateValue;
          after.reward_wallet = this.options.updateValue;
          updateData.address = this.options.updateValue;
          updateData.reward_wallet = this.options.updateValue;
        }

        await devicesCollection.updateOne(
          { _id: device._id },
          { $set: updateData }
        );

        this.log('  ✓ Updated successfully', 'green');
        this.stats.devicesUpdated++;
        this.logAction(device.miner_key, 'updated', before, after);
      } catch (error) {
        this.log(`  ✗ Update failed: ${error}`, 'red');
        this.stats.errors++;
        this.logAction(device.miner_key, 'error', {}, { error: String(error) });
      }
    }
  }

  async run() {
    try {
      await this.client.connect();
      this.log('🔌 Connected to MongoDB', 'green');

      // Interactive mode if no search/update options provided
      if (!this.options.searchType || !this.options.updateType) {
        await this.interactiveMode();
        if (!this.options.searchType || !this.options.updateType) {
          return;
        }
      }

      // Validate options
      if (this.options.updateType === 'wallet' && this.options.updateValue) {
        if (!isValidAlgorandAddress(this.options.updateValue)) {
          this.log('✗ Invalid Algorand address (must be 58 characters)', 'red');
          return;
        }
      }

      if (this.options.updateType === 'email' && this.options.updateValue) {
        if (!isValidEmail(this.options.updateValue)) {
          this.log('✗ Invalid email address format', 'red');
          return;
        }
      }

      // Find devices
      this.log('\n🔍 Searching for devices...', 'blue');
      const devices = await this.findDevices();

      if (devices.length === 0) {
        this.log('  ✗ No devices found matching search criteria', 'yellow');
        return;
      }

      this.log(`  ✓ Found ${devices.length} device(s)`, 'green');

      // Show all found devices
      this.log('\n📋 Found Devices:', 'bold');
      devices.forEach((device, index) => {
        this.displayDevice(device, index);
      });

      // Create backup before making changes
      if (!this.options.dryRun) {
        await this.createBackup(devices);
      }

      // Confirm bulk update if more than 5 devices
      if (devices.length > 5 && !this.options.auto) {
        this.log(
          `\n⚠ WARNING: You are about to update ${devices.length} devices`,
          'yellow'
        );
        const answer = await this.prompt('Continue with bulk update? [y/N]: ');
        if (answer !== 'y' && answer !== 'yes') {
          this.log('⊘ Bulk update cancelled', 'yellow');
          return;
        }
      }

      if (this.options.dryRun) {
        this.log('\n[DRY RUN MODE - No changes will be made]', 'yellow');
      }

      // Update devices
      await this.updateDevices(devices);

      // Generate report
      await this.generateReport();
    } catch (error) {
      this.log(`\n✗ Update failed: ${error}`, 'red');
      console.error(error);
      process.exit(1);
    } finally {
      this.rl.close();
      await this.client.close();
    }
  }

  private async generateReport() {
    this.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'bold');
    this.log('📊 UPDATE SUMMARY', 'bold');
    this.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'bold');

    this.log(`\nSearch Criteria:`, 'blue');
    this.log(`  Type: ${this.options.searchType}`);
    this.log(`  Value: ${this.options.searchValue}`);

    this.log(`\nUpdate Action:`, 'blue');
    this.log(`  Type: ${this.options.updateType}`);
    this.log(`  New Value: ${this.options.updateValue}`);

    this.log(`\nResults:`, 'blue');
    this.log(`  Devices Found: ${this.stats.devicesFound}`);
    this.log(`  Devices Updated: ${this.stats.devicesUpdated}`, 'green');
    this.log(`  Devices Skipped: ${this.stats.devicesSkipped}`, 'gray');
    this.log(
      `  Errors: ${this.stats.errors}`,
      this.stats.errors > 0 ? 'red' : 'gray'
    );

    // Save log file
    if (this.updateLog.length > 0) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      fs.mkdirSync(this.options.backupDir, { recursive: true });

      const logPath = path.join(
        this.options.backupDir,
        `update-log-${timestamp}.json`
      );

      const logData = {
        timestamp: new Date().toISOString(),
        options: {
          searchType: this.options.searchType,
          searchValue: this.options.searchValue,
          updateType: this.options.updateType,
          updateValue: this.options.updateValue,
          dryRun: this.options.dryRun,
        },
        summary: this.stats,
        details: this.updateLog,
      };

      fs.writeFileSync(logPath, JSON.stringify(logData, null, 2));
      this.log(`\n📄 Log saved to: ${logPath}`, 'gray');
    }

    this.log('\n✅ Update complete!', 'green');
  }
}

// Parse command line arguments
function parseArgs(): UpdateOptions {
  const args = process.argv.slice(2);
  const options: UpdateOptions = {
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
      case '--search-email':
        options.searchType = 'email';
        options.searchValue = args[++i];
        break;
      case '--search-wallet':
        options.searchType = 'wallet';
        options.searchValue = args[++i];
        break;
      case '--search-miner-key':
        options.searchType = 'miner_key';
        options.searchValue = args[++i];
        break;
      case '--new-email':
        options.updateType = 'email';
        options.updateValue = args[++i];
        break;
      case '--new-wallet':
        options.updateType = 'wallet';
        options.updateValue = args[++i];
        break;
      case '--help':
        console.log(`
User Information Update Tool

Update email addresses or wallet addresses for devices in the database.

Usage: npm run update-user-info [options]

Search Options (use one):
  --search-email <email>       Search for devices by email address
  --search-wallet <address>    Search for devices by wallet address
  --search-miner-key <key>     Search for a specific device by miner key

Update Options (use one):
  --new-email <email>          Set new email address for found devices
  --new-wallet <address>       Set new wallet address (updates both 'address' and 'reward_wallet')

Execution Options:
  --auto                       Auto-approve all updates (no confirmation prompts)
  --dry-run                    Preview changes without executing
  --backup-dir <path>          Custom backup directory (default: ./backups)
  --help                       Show this help message

Examples:
  # Interactive mode
  npm run update-user-info

  # Update wallet for all devices owned by a specific wallet
  npm run update-user-info -- --search-wallet OLD_ADDRESS --new-wallet NEW_ADDRESS --auto

  # Preview email update
  npm run update-user-info -- --search-email old@example.com --new-email new@example.com --dry-run
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

  const tool = new UpdateTool(mongoUri, options);
  await tool.run();
}

// Run if executed directly
if (require.main === module) {
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}
