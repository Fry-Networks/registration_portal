/**
 * unlock-legacy-verification.ts
 *
 * One-off helper that scans main.devices for *miner* records that are still
 * verified with the retired FRY 1.0 verification stake and flags them with
 * `legacy_stake_unlocked: true` so the dashboard can let users withdraw and
 * re-stake with FRY 2.0.
 *
 * The script also prints a report so we can see how many miners are:
 *   - registered overall
 *   - still actively staked in FRY 1.0 (target cohort)
 *   - already withdrawn (no active stake)
 *   - restaked in FRY 2.0 after Oct 8 2025
 *
 * Usage (from repo root):
 *   # Dry run (default) – no DB writes, just a report
 *   npx ts-node --compiler-options '{"module":"commonjs"}' scripts/unlock-legacy-verification.ts
 *
 *   # Dry run with verbose device list
 *   npx ts-node --compiler-options '{"module":"commonjs"}' scripts/unlock-legacy-verification.ts --verbose
 *
 *   # Actually set legacy_stake_unlocked on matching documents
 *   npx ts-node --compiler-options '{"module":"commonjs"}' scripts/unlock-legacy-verification.ts --apply
 *
 * Optional flags:
 *   --apply             Persist the `legacy_stake_unlocked` flag (dry-run otherwise)
 *   --limit N           Stop after processing N miner devices (for spot checks)
 *   --verbose           Print the miner_key list for each category
 *   --mongo-uri "<uri or op://path>" Override MONGO_URI (supports op:// secrets)
 *   --force-unverify    Also flip `verified` to false for legacy stakes once the cutoff passes
 *   --force-after <ISO> Override the cutoff timestamp (defaults to LEGACY_VERIFICATION_FORCE_UTC/NEXT_PUBLIC_LEGACY_VERIFICATION_FORCE_UTC)
 */
import 'dotenv/config';
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { MongoClient, ObjectId } from 'mongodb';
import { FRY_1, FRY_2 } from '../lib/utils';
import { getLegacyForceTimestamp } from '../lib/legacyStake';

const NODE_PREFIXES = new Set(['RDN', 'SDN', 'SVN', 'CN', 'AEM']);
const LEGACY_ASA = String(FRY_1.id);
const FRY2_ASA = String(FRY_2.id);
const RESTAKE_CUTOFF = new Date('2025-10-08T00:00:00Z');

type StakeBlock = {
  amount?: number;
  time?: Date | string;
  type?: string;
  asset_id?: string | number | null;
  lastWithdrawal?: Record<string, unknown> | null;
  withdrawals?: Array<Record<string, unknown>>;
};

type DeviceDoc = {
  _id: ObjectId;
  miner_key: string;
  is_registered?: boolean;
  verified?: boolean;
  legacy_stake_unlocked?: boolean;
  staked?: StakeBlock | null;
};

const args = process.argv.slice(2);
const applyChanges = args.includes('--apply');
const limitArgIndex = args.findIndex((a) => a === '--limit');
const limit =
  limitArgIndex >= 0 && args[limitArgIndex + 1]
    ? Number(args[limitArgIndex + 1])
    : undefined;
const verbose = args.includes('--verbose');
const forceUnverify = args.includes('--force-unverify');
const forceAfterArgIndex = args.findIndex((a) => a === '--force-after');
const forceAfterTimestamp =
  forceAfterArgIndex >= 0 && args[forceAfterArgIndex + 1]
    ? Date.parse(args[forceAfterArgIndex + 1])
    : null;
const targetForceTimestamp =
  Number.isFinite(forceAfterTimestamp) && forceAfterTimestamp !== null
    ? forceAfterTimestamp
    : getLegacyForceTimestamp();
const mongoUriArgIndex = args.findIndex((a) => a === '--mongo-uri');
const cliMongoUri =
  mongoUriArgIndex >= 0 && args[mongoUriArgIndex + 1]
    ? args[mongoUriArgIndex + 1]
    : undefined;
const dryRunFindings: Array<{
  miner_key: string;
  verified: boolean;
  legacy_stake_unlocked: boolean;
  staked: StakeBlock | null | undefined;
}> = [];

if (limit !== undefined && (Number.isNaN(limit) || limit <= 0)) {
  console.error('Invalid --limit value. Provide a positive integer.');
  process.exit(1);
}

if (forceUnverify && !targetForceTimestamp) {
  console.warn(
    '[warn] --force-unverify provided without a cutoff timestamp. Legacy stakes will be marked unverified immediately.'
  );
}

function resolveMongoUri(): string {
  let uri = cliMongoUri || process.env.MONGO_URI;
  if (uri && uri.startsWith('op://')) {
    try {
      console.log(`Reading Mongo URI from 1Password path: ${uri}`);
      uri = execFileSync('op', ['read', uri], { encoding: 'utf8' }).trim();
      console.log('Loaded Mongo URI from 1Password.');
    } catch (error) {
      console.error('Failed to read Mongo URI via 1Password CLI:', error);
      process.exit(2);
    }
  }
  if (!uri) {
    console.error(
      'Missing MONGO_URI. Set the env var, pass --mongo-uri, or supply an op:// path.'
    );
    process.exit(2);
  }
  return uri;
}

const toDate = (value: unknown): Date | null => {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  const parsed = new Date(value as any);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const isMiner = (minerKey: string): boolean => {
  const prefix = minerKey.split('-')[0];
  return !NODE_PREFIXES.has(prefix);
};

const hasLegacyStake = (device: DeviceDoc): boolean => {
  const stake = device.staked;
  if (!stake) return false;
  const amount =
    typeof stake.amount === 'number' && Number.isFinite(stake.amount)
      ? stake.amount
      : null;
  if (!amount || amount <= 1) return false;

  const stakeTime = toDate(stake.time);
  if (!stakeTime) return false;
  const type = typeof stake.type === 'string' ? stake.type.toLowerCase() : '';
  if (type !== 'one' && type !== 'two') return false;
  if (device.verified !== true) return false;

  const assetId =
    typeof stake.asset_id === 'number' || typeof stake.asset_id === 'string'
      ? String(stake.asset_id)
      : null;

  return !assetId || assetId === LEGACY_ASA;
};

const hasWithdrawalRecord = (stake?: StakeBlock | null): boolean => {
  if (!stake) return false;
  if (stake.lastWithdrawal) return true;
  return Array.isArray(stake.withdrawals) && stake.withdrawals.length > 0;
};

const hasActiveStake = (stake?: StakeBlock | null): boolean => {
  if (!stake) return false;
  const amount =
    typeof stake.amount === 'number' && Number.isFinite(stake.amount)
      ? stake.amount
      : null;
  if (!amount || amount <= 1) return false;
  return Boolean(toDate(stake.time));
};

const hasRestakedFry2 = (stake?: StakeBlock | null): boolean => {
  if (!stake) return false;
  const assetId =
    typeof stake.asset_id === 'number' || typeof stake.asset_id === 'string'
      ? String(stake.asset_id)
      : null;
  if (assetId !== FRY2_ASA) return false;
  const stakeTime = toDate(stake.time);
  if (!stakeTime || stakeTime <= RESTAKE_CUTOFF) return false;
  const amount =
    typeof stake.amount === 'number' && Number.isFinite(stake.amount)
      ? stake.amount
      : null;
  return Boolean(amount && amount > 1);
};

async function main() {
  const uri = resolveMongoUri();
  const client = new MongoClient(uri);
  await client.connect();

  const db = client.db('main');
  const devices = db.collection<DeviceDoc>('devices');

  const report = {
    totalMiners: 0,
    legacyActive: 0,
    legacyTypeOne: 0,
    legacyTypeTwo: 0,
    legacyAlreadyFlagged: 0,
    legacyFlaggedThisRun: 0,
    withdrawnOnly: 0,
    restakedFry2: 0,
    neverStaked: 0,
    legacyForcedUnverified: 0
  };

  const legacyCandidateKeys: string[] = [];
  const legacyFlaggedThisRunKeys: string[] = [];
  const withdrawnKeys: string[] = [];
  const restakedKeys: string[] = [];
  const legacyForcedKeys: string[] = [];

  const cursor = devices.find({ is_registered: true }, { batchSize: 500 });

  for await (const doc of cursor) {
    if (!doc?.miner_key || !isMiner(doc.miner_key)) {
      continue;
    }

    report.totalMiners += 1;

    const stakeBlock = doc.staked;
    const stakeTime = toDate(stakeBlock?.time);
    const stakeType =
      typeof stakeBlock?.type === 'string'
        ? stakeBlock.type.toLowerCase()
        : '';
    const stakeAmount =
      typeof stakeBlock?.amount === 'number' && Number.isFinite(stakeBlock.amount)
        ? stakeBlock.amount
        : null;
    const currentlyStaked = Boolean(stakeTime && stakeAmount && stakeAmount > 1);
    const everStaked = currentlyStaked || hasWithdrawalRecord(stakeBlock);

    const legacy = hasLegacyStake(doc);
    if (legacy) {
      report.legacyActive += 1;
      legacyCandidateKeys.push(doc.miner_key);
      if (stakeType === 'one') report.legacyTypeOne += 1;
      if (stakeType === 'two') report.legacyTypeTwo += 1;

      if (doc.legacy_stake_unlocked) {
        report.legacyAlreadyFlagged += 1;
      } else if (applyChanges) {
        await devices.updateOne(
          { _id: doc._id },
          { $set: { legacy_stake_unlocked: true } }
        );
        report.legacyFlaggedThisRun += 1;
        legacyFlaggedThisRunKeys.push(doc.miner_key);
      } else {
        report.legacyFlaggedThisRun += 1;
        legacyFlaggedThisRunKeys.push(`${doc.miner_key} (dry-run)`);
      }
    }

    const withdrawalOnly =
      hasWithdrawalRecord(stakeBlock) && !hasActiveStake(stakeBlock);
    if (withdrawalOnly) {
      report.withdrawnOnly += 1;
      withdrawnKeys.push(doc.miner_key);
    }

    const restaked = hasRestakedFry2(stakeBlock);
    if (restaked) {
      report.restakedFry2 += 1;
      restakedKeys.push(doc.miner_key);
    }

    if (!everStaked) {
      report.neverStaked += 1;
    }

    const shouldForceUnverify =
      forceUnverify &&
      legacy &&
      (targetForceTimestamp ? Date.now() >= targetForceTimestamp : true);

    if (shouldForceUnverify && doc.verified) {
      if (!applyChanges) {
        dryRunFindings.push({
          miner_key: doc.miner_key,
          verified: Boolean(doc.verified),
          legacy_stake_unlocked: Boolean(doc.legacy_stake_unlocked),
          staked: stakeBlock || null
        });
      }
      if (applyChanges) {
        await devices.updateOne(
          { _id: doc._id },
          { $set: { verified: false } }
        );
      }
      report.legacyForcedUnverified += 1;
      legacyForcedKeys.push(doc.miner_key);
    }

    if (limit && report.totalMiners >= limit) {
      break;
    }
  }

  await client.close();

  console.log('\n=== Legacy Verification Stake Report ===\n');
  console.table({
    'Total registered miners': report.totalMiners,
    'Legacy FRY1 stakes (active)': report.legacyActive,
    ' ├─ Type one legacy stakes': report.legacyTypeOne,
    ' └─ Type two legacy stakes': report.legacyTypeTwo,
    'Legacy already flagged': report.legacyAlreadyFlagged,
    'Legacy marked this run': report.legacyFlaggedThisRun,
    'Withdrawn & not restaked': report.withdrawnOnly,
    'Restaked with FRY2 (post 2025-10-08)': report.restakedFry2,
    'Never staked (no history)': report.neverStaked,
    'Legacy forced unverified this run': report.legacyForcedUnverified
  });

  if (verbose) {
    const dump = (label: string, keys: string[]) => {
      console.log(`\n${label} (${keys.length})`);
      if (keys.length === 0) return;
      keys.forEach((key) => console.log(`  - ${key}`));
    };

    dump('Legacy FRY1 candidates', legacyCandidateKeys);
    dump('Legacy flagged this run', legacyFlaggedThisRunKeys);
    dump('Withdrawn but not restaked', withdrawnKeys);
    dump('Restaked in FRY2 after 2025-10-08', restakedKeys);
    dump('Legacy stakes forced unverified', legacyForcedKeys);
  }

  // On dry run, persist a JSON report of devices that would be force-unverified.
  if (!applyChanges && dryRunFindings.length > 0) {
    const outputDir = path.join(process.cwd(), 'logs');
    const outputFile = path.join(
      outputDir,
      `unlock-legacy-findings-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
    );
    try {
      fs.mkdirSync(outputDir, { recursive: true });
      fs.writeFileSync(
        outputFile,
        JSON.stringify(
          {
            generatedAt: new Date().toISOString(),
            forceUnverify: forceUnverify,
            targetForceTimestamp: targetForceTimestamp
              ? new Date(targetForceTimestamp).toISOString()
              : null,
            limit,
            totalFindings: dryRunFindings.length,
            findings: dryRunFindings
          },
          null,
          2
        ),
        { encoding: 'utf8' }
      );
      console.log(`\n[dry-run] Wrote findings JSON to ${outputFile}`);
    } catch (error) {
      console.error('[dry-run] Failed to write findings JSON', error);
    }
  }

  console.log(
    `\nMode: ${applyChanges ? 'APPLY (updates written)' : 'DRY-RUN (no writes)'}`
  );
  if (!applyChanges) {
    console.log(
      'Re-run with --apply once you are satisfied with the report to persist the legacy_stake_unlocked flag.'
    );
  }
}

main().catch((error) => {
  console.error('Migration failed:', error);
  process.exit(1);
});
