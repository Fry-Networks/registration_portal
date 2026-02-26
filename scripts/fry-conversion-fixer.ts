#!/usr/bin/env ts-node
// usage example : 
// npm run fix-fry-conversion fix-claims XSSHAYQOPIQB2XVPDUFDTEXYYZV43KXRXQSKOY2P2QZLVLRSEREYSEAZ4E --debug --dry-run
// npm run fix-fry-conversion inspect XSSHAYQOPIQB2XVPDUFDTEXYYZV43KXRXQSKOY2P2QZLVLRSEREYSEAZ4E --debug

import { Command } from 'commander';
import { MongoClient } from 'mongodb';
import { execSync } from 'child_process';

interface ConversionRecord {
  _id: any;
  address: string;
  amount: number;
  status: string;
  claimableAmount: number;
  claimableMonths: number;
  claimedMonths: number;
  pendingAmount: number;
  history?: Array<{
    amount: number;
    tokenType: string;
    date: Date;
  }>;
  ratio?: number[];
  lastConversionAt?: Date;
  lastConversionTxId?: string;
}

interface FixResult {
  success: boolean;
  address: string;
  changes: {
    before: Partial<ConversionRecord>;
    after: Partial<ConversionRecord>;
  };
  errors?: string[];
  warnings?: string[];
}

class FryConversionFixer {
  private debugMode: boolean = false;
  private dryRun: boolean = false;
  private client: MongoClient | null = null;

  constructor() {
    // CLI tool with its own MongoDB connection
  }

  setDebugMode(enabled: boolean) {
    this.debugMode = enabled;
  }

  setDryRun(enabled: boolean) {
    this.dryRun = enabled;
  }

  private log(message: string, level: 'info' | 'debug' | 'warn' | 'error' = 'info') {
    const timestamp = new Date().toISOString();
    const prefix = level.toUpperCase().padEnd(5);
    
    if (level === 'debug' && !this.debugMode) return;
    
    const colors = {
      info: '\x1b[37m',    // White
      debug: '\x1b[36m',   // Cyan
      warn: '\x1b[33m',    // Yellow
      error: '\x1b[31m',   // Red
    };
    
    const reset = '\x1b[0m';
    console.log(`${colors[level]}[${timestamp}] ${prefix}: ${message}${reset}`);
  }

  private resolveMongoUri(): string {
    try {
      // Try to resolve from 1Password using op CLI
      const mongoUri = execSync('op read "op://TestersDashboard/Dash Secrets/MONGO_URI"', { 
        encoding: 'utf8',
        stdio: ['inherit', 'pipe', 'pipe']
      }).trim();
      
      if (!mongoUri || (!mongoUri.startsWith('mongodb://') && !mongoUri.startsWith('mongodb+srv://'))) {
        throw new Error('Invalid MongoDB URI resolved from 1Password');
      }
      
      this.log('Successfully resolved MongoDB URI from 1Password', 'debug');
      return mongoUri;
    } catch (error) {
      this.log(`Failed to resolve MongoDB URI from 1Password: ${error}`, 'error');
      throw new Error('Unable to resolve MongoDB connection string from 1Password');
    }
  }

  async connect() {
    try {
      if (this.client) {
        return true; // Already connected
      }

      const mongoUri = this.resolveMongoUri();
      this.client = new MongoClient(mongoUri);
      
      await this.client.connect();
      await this.client.db('admin').command({ ping: 1 });
      this.log('Connected to MongoDB successfully');
      return true;
    } catch (error) {
      this.log(`Failed to connect to MongoDB: ${error}`, 'error');
      return false;
    }
  }

  async disconnect() {
    try {
      if (this.client) {
        await this.client.close();
        this.client = null;
        this.log('Disconnected from MongoDB');
      }
    } catch (error) {
      this.log(`Error disconnecting from MongoDB: ${error}`, 'warn');
    }
  }

  private calculateVestingMonths(startDate: Date): number {
    const now = new Date();
    const diffTime = now.getTime() - startDate.getTime();
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    // Use same logic as the original code - Math.min to cap at 11, then add 1
    const monthsVested = Math.min(Math.floor(diffDays / 30), 11);
    return monthsVested + 1;
  }

  private getVestingStartDate(ratio?: number[]): Date {
    // From the original code constants in lib/utils.ts
    const CORE_RELEASE_DATE = new Date('2025-07-21T00:00:00Z');
    const MODS_RELEASE_DATE = new Date('2025-07-25T00:00:00Z'); 
    const ALL_RELEASE_DATE = new Date('2025-08-01T00:00:00Z');

    if (ratio && ratio.length > 2) {
      return ratio[2] === 1 ? CORE_RELEASE_DATE : MODS_RELEASE_DATE;
    }
    return ALL_RELEASE_DATE;
  }

  async findConversionRecord(address: string): Promise<ConversionRecord | null> {
    try {
      if (!this.client) {
        throw new Error('Database not connected');
      }

      const db = this.client.db('main');
      const collection = db.collection('fry-conversions');
      
      this.log(`Looking up conversion record for address: ${address}`, 'debug');
      const record = await collection.findOne({ address }) as ConversionRecord | null;
      
      if (record) {
        this.log(`Found conversion record with status: ${record.status}`, 'debug');
      } else {
        this.log(`No conversion record found for address: ${address}`, 'warn');
      }
      
      return record;
    } catch (error) {
      this.log(`Error finding conversion record: ${error}`, 'error');
      return null;
    }
  }

  private analyzeClaimDiscrepancy(record: ConversionRecord): {
    hasDiscrepancy: boolean;
    actualClaims: number;
    recordedClaims: number;
    analysis: string[];
  } {
    const analysis: string[] = [];
    const actualClaims = record.history?.length || 0;
    const recordedClaims = record.claimedMonths;

    analysis.push(`History array contains ${actualClaims} actual claim(s)`);
    analysis.push(`claimedMonths field shows ${recordedClaims} claimed month(s)`);

    if (record.history && record.history.length > 0) {
      analysis.push('Claim history:');
      record.history.forEach((claim, idx) => {
        analysis.push(`  ${idx + 1}. ${claim.amount.toFixed(5)} ${claim.tokenType} on ${new Date(claim.date).toLocaleDateString()}`);
      });
    }

    const hasDiscrepancy = actualClaims !== recordedClaims;
    if (hasDiscrepancy) {
      analysis.push(`⚠️  DISCREPANCY DETECTED: Actual claims (${actualClaims}) ≠ Recorded claims (${recordedClaims})`);
    } else {
      analysis.push('✅ Claims match - no discrepancy detected');
    }

    return {
      hasDiscrepancy,
      actualClaims,
      recordedClaims,
      analysis
    };
  }

  private calculateCorrectValues(record: ConversionRecord): Partial<ConversionRecord> {
    const vestingStart = this.getVestingStartDate(record.ratio);
    const monthsVested = this.calculateVestingMonths(vestingStart);
    const actualClaims = record.history?.length || 0;
    
    this.log(`Calculating correct values:`, 'debug');
    this.log(`  Vesting start: ${vestingStart.toISOString()}`, 'debug');
    this.log(`  Months vested: ${monthsVested}`, 'debug');
    this.log(`  Actual claims made: ${actualClaims}`, 'debug');

    // Calculate how many NEW months are claimable (not total remaining)
    // This matches the logic in get_fry_conversion.ts
    const claimableMonths = Math.max(0, monthsVested - actualClaims);
    
    this.log(`  Calculated claimable months: ${claimableMonths}`, 'debug');

    // Calculate claimable amount based on the NEW claimable months
    // Using same logic as get_fry_conversion.ts
    const monthlyAmountFry1 = record.amount / 12; // Monthly amount in FRY 1.0
    const srcAmount = monthlyAmountFry1 * claimableMonths; // Total FRY 1.0 for claimable months
    
    const ratio = record.ratio || [80, 40];
    const fry2Ratio = ratio[1]; // Second ratio (40) is for FRY 2.0 conversion
    const claimableAmount = srcAmount / fry2Ratio; // Convert to FRY 2.0
    
    this.log(`  Monthly amount (FRY 1.0): ${monthlyAmountFry1.toFixed(8)}`, 'debug');
    this.log(`  Source amount for claimable months (FRY 1.0): ${srcAmount.toFixed(8)}`, 'debug');
    this.log(`  Calculated claimable amount (FRY 2.0): ${claimableAmount.toFixed(8)}`, 'debug');

    // Calculate pending amount - this is the total FRY 1.0 not yet claimable due to vesting
    // pendingAmount = total amount - (months vested * monthly amount)
    const vestedAmountFry1 = monthlyAmountFry1 * monthsVested;
    const pendingAmount = Math.max(0, Number((record.amount - vestedAmountFry1).toFixed(8)));
    
    this.log(`  Total vested amount (FRY 1.0): ${vestedAmountFry1.toFixed(8)}`, 'debug');
    this.log(`  Calculated pending amount (FRY 1.0): ${pendingAmount.toFixed(8)}`, 'debug');

    return {
      claimedMonths: actualClaims,
      claimableMonths,
      pendingAmount,
      claimableAmount: Number(claimableAmount.toFixed(8))
    };
  }

  async fixClaimDiscrepancy(address: string): Promise<FixResult> {
    const result: FixResult = {
      success: false,
      address,
      changes: { before: {}, after: {} },
      errors: [],
      warnings: []
    };

    try {
      const record = await this.findConversionRecord(address);
      if (!record) {
        result.errors?.push('Conversion record not found');
        return result;
      }

      const discrepancyAnalysis = this.analyzeClaimDiscrepancy(record);
      const correctValues = this.calculateCorrectValues(record);
      
      this.log('='.repeat(80));
      this.log(`ANALYZING CONVERSION RECORD FOR: ${address}`);
      this.log('='.repeat(80));
      
      discrepancyAnalysis.analysis.forEach(line => this.log(line));

      // Check if amounts are incorrect even if claim counts match
      const amountDiscrepancies = [
        Math.abs((record.claimableAmount || 0) - (correctValues.claimableAmount || 0)) > 0.01,
        Math.abs((record.pendingAmount || 0) - (correctValues.pendingAmount || 0)) > 0.01,
        record.claimableMonths !== correctValues.claimableMonths
      ];
      const hasAmountDiscrepancy = amountDiscrepancies.some(d => d);

      if (!discrepancyAnalysis.hasDiscrepancy && !hasAmountDiscrepancy) {
        this.log('No discrepancy found - no fixes needed');
        result.success = true;
        return result;
      }

      if (hasAmountDiscrepancy) {
        this.log('\n⚠️  AMOUNT CALCULATION DISCREPANCIES DETECTED:');
        this.log(`  Current claimableAmount: ${record.claimableAmount}, should be: ${correctValues.claimableAmount}`);
        this.log(`  Current claimableMonths: ${record.claimableMonths}, should be: ${correctValues.claimableMonths}`);
        this.log(`  Current pendingAmount: ${record.pendingAmount}, should be: ${correctValues.pendingAmount}`);
      }

      // Store before state
      result.changes.before = {
        claimedMonths: record.claimedMonths,
        claimableMonths: record.claimableMonths,
        claimableAmount: record.claimableAmount,
        pendingAmount: record.pendingAmount
      };

      // Calculate correct values
      const corrections = this.calculateCorrectValues(record);
      result.changes.after = corrections;

      this.log('\nPROPOSED CHANGES:');
      this.log(`  claimedMonths: ${record.claimedMonths} → ${corrections.claimedMonths}`);
      this.log(`  claimableMonths: ${record.claimableMonths} → ${corrections.claimableMonths}`);
      this.log(`  claimableAmount: ${record.claimableAmount} → ${corrections.claimableAmount}`);
      this.log(`  pendingAmount: ${record.pendingAmount} → ${corrections.pendingAmount}`);

      if (this.dryRun) {
        this.log('\n🔍 DRY RUN MODE - No changes will be applied', 'warn');
        result.success = true;
        return result;
      }

      // Apply the fixes
      if (!this.client) {
        throw new Error('Database not connected');
      }

      const db = this.client.db('main');
      const collection = db.collection('fry-conversions');
      
      const updateResult = await collection.updateOne(
        { address },
        {
          $set: {
            claimedMonths: corrections.claimedMonths,
            claimableMonths: corrections.claimableMonths,
            claimableAmount: corrections.claimableAmount,
            pendingAmount: corrections.pendingAmount,
            isProcessing: false
          },
          $unset: {
            processingStartedAt: ''
          }
        }
      );

      if (updateResult.modifiedCount > 0) {
        this.log('\n✅ Successfully applied fixes to database', 'info');
        result.success = true;
      } else {
        result.errors?.push('Database update failed - no documents modified');
      }

    } catch (error) {
      this.log(`Error fixing claim discrepancy: ${error}`, 'error');
      result.errors?.push(String(error));
    }

    return result;
  }

  async reconcileBurn(address: string, txId?: string): Promise<FixResult> {
    const result: FixResult = {
      success: false,
      address,
      changes: { before: {}, after: {} },
      errors: [],
      warnings: []
    };

    try {
      this.log('='.repeat(80));
      this.log(`RECONCILING BURN FOR: ${address}`);
      this.log('='.repeat(80));

      if (txId) {
        this.log(`Using provided transaction ID: ${txId}`);
      } else {
        this.log('No transaction ID provided - will search for valid burn transaction');
      }

      // Import the existing reconciliation logic
      const { reconcileFryBurn } = await import('../lib/conversion/reconcileBurn');
      
      if (this.dryRun) {
        this.log('🔍 DRY RUN MODE - Would attempt burn reconciliation but not apply changes', 'warn');
        result.success = true;
        return result;
      }

      const reconcileResult = await reconcileFryBurn({ address, txId });
      
      if (reconcileResult.success) {
        this.log('✅ Burn reconciliation successful', 'info');
        if (reconcileResult.burnTxnId) {
          this.log(`  Transaction ID: ${reconcileResult.burnTxnId}`);
        }
        this.log(`  Message: ${reconcileResult.message}`);
        
        result.success = true;
        result.changes.after = {
          status: 'pending',
          claimedMonths: 0,
          claimableMonths: 0,
          claimableAmount: 0
        };
      } else {
        result.errors?.push('Burn reconciliation failed');
      }

    } catch (error) {
      this.log(`Error reconciling burn: ${error}`, 'error');
      result.errors?.push(String(error));
    }

    return result;
  }

  async auditConversionSystem(): Promise<void> {
    this.log('='.repeat(80));
    this.log('AUDITING CONVERSION SYSTEM');
    this.log('='.repeat(80));

    try {
      if (!this.client) {
        throw new Error('Database not connected');
      }

      const db = this.client.db('main');
      const collection = db.collection('fry-conversions');

      // Get summary statistics
      const totalRecords = await collection.countDocuments();
      const pendingRecords = await collection.countDocuments({ status: 'pending' });
      const validRecords = await collection.countDocuments({ status: 'valid' });

      this.log(`Total conversion records: ${totalRecords}`);
      this.log(`Pending conversions: ${pendingRecords}`);
      this.log(`Valid (not yet burned): ${validRecords}`);

      // Find records with potential discrepancies
      const recordsWithHistory = await collection.find({
        history: { $exists: true, $ne: [] }
      }).toArray() as ConversionRecord[];

      this.log(`\nRecords with claim history: ${recordsWithHistory.length}`);

      let discrepancyCount = 0;
      for (const record of recordsWithHistory) {
        const analysis = this.analyzeClaimDiscrepancy(record);
        if (analysis.hasDiscrepancy) {
          discrepancyCount++;
          this.log(`\n🔍 DISCREPANCY FOUND: ${record.address}`);
          this.log(`  Actual claims: ${analysis.actualClaims}, Recorded: ${analysis.recordedClaims}`);
        }
      }

      this.log(`\nTotal discrepancies found: ${discrepancyCount}`);

    } catch (error) {
      this.log(`Error during system audit: ${error}`, 'error');
    }
  }
}

// CLI Commands
async function main() {
  const fixer = new FryConversionFixer();
  const program = new Command();

  program
    .name('fry-conversion-fixer')
    .description('CLI tool to fix Fry Networks conversion system issues')
    .version('1.0.0');

  program
    .option('-d, --debug', 'Enable debug logging')
    .option('--dry-run', 'Show what would be changed without making actual updates');

  program
    .command('fix-claims')
    .description('Fix claim discrepancies for a wallet address')
    .argument('<address>', 'Wallet address to fix')
    .action(async (address: string, options: any, command: any) => {
      const globalOptions = command.parent.opts();
      fixer.setDebugMode(globalOptions.debug);
      fixer.setDryRun(globalOptions.dryRun);

      if (await fixer.connect()) {
        try {
          const result = await fixer.fixClaimDiscrepancy(address);
          
          if (result.success) {
            console.log('\n✅ Operation completed successfully');
          } else {
            console.log('\n❌ Operation failed');
            if (result.errors) {
              result.errors.forEach(error => console.log(`   Error: ${error}`));
            }
          }
        } finally {
          await fixer.disconnect();
        }
      }
    });

  program
    .command('reconcile-burn')
    .description('Reconcile a burn transaction that wasn\'t properly recorded')
    .argument('<address>', 'Wallet address to reconcile')
    .option('-t, --txid <txid>', 'Specific transaction ID (optional)')
    .action(async (address: string, options: any, command: any) => {
      const globalOptions = command.parent.opts();
      fixer.setDebugMode(globalOptions.debug);
      fixer.setDryRun(globalOptions.dryRun);

      if (await fixer.connect()) {
        try {
          const result = await fixer.reconcileBurn(address, options.txid);
          
          if (result.success) {
            console.log('\n✅ Operation completed successfully');
          } else {
            console.log('\n❌ Operation failed');
            if (result.errors) {
              result.errors.forEach(error => console.log(`   Error: ${error}`));
            }
          }
        } finally {
          await fixer.disconnect();
        }
      }
    });

  program
    .command('audit')
    .description('Audit the conversion system for discrepancies')
    .action(async (options: any, command: any) => {
      const globalOptions = command.parent.opts();
      fixer.setDebugMode(globalOptions.debug);
      fixer.setDryRun(globalOptions.dryRun);

      if (await fixer.connect()) {
        try {
          await fixer.auditConversionSystem();
        } finally {
          await fixer.disconnect();
        }
      }
    });

  program
    .command('inspect')
    .description('Inspect a specific wallet\'s conversion record')
    .argument('<address>', 'Wallet address to inspect')
    .action(async (address: string, options: any, command: any) => {
      const globalOptions = command.parent.opts();
      fixer.setDebugMode(true); // Always enable debug for inspect
      fixer.setDryRun(true);    // Always dry run for inspect

      if (await fixer.connect()) {
        try {
          const record = await fixer.findConversionRecord(address);
          if (record) {
            console.log('\n📋 CONVERSION RECORD:');
            console.log(JSON.stringify(record, null, 2));
            
            const analysis = fixer['analyzeClaimDiscrepancy'](record);
            console.log('\n🔍 ANALYSIS:');
            analysis.analysis.forEach(line => console.log(line));
          }
        } finally {
          await fixer.disconnect();
        }
      }
    });

  await program.parseAsync(process.argv);
}

if (require.main === module) {
  main().catch(console.error);
}

export { FryConversionFixer };
