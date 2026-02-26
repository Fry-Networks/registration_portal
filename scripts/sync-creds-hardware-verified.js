#!/usr/bin/env node
'use strict';

const { MongoClient } = require('mongodb');
const { execFileSync } = require('child_process');
const fs = require('fs');

const ALLOWED_PREFIXES = new Set(['BM', 'AEM', 'SDN', 'RDN', 'SVN']);
const PREFIX_REGEX = /^(BM|AEM|SDN|RDN|SVN)-/;
const DEFAULT_OP_MONGO_PATHS = [
  'op://Dashboard/Dash Secrets/MONGO_URI',
  'op://TestersDashboard/Dash Secrets/MONGO_URI'
];

function printUsage() {
  console.log(`
Sync verified status from main.devices -> creds.hardware for selected miner prefixes.

Usage:
  node scripts/sync-creds-hardware-verified.js [options]

Options:
  --dry-run             Preview only (default)
  --apply               Apply database updates
  --miner-key <key>     Restrict to a single miner key
  --mongo-uri <value>   Override MONGO_URI (supports op:// path)
  --op-mongo-path <p>   1Password path for Mongo URI (op://.../MONGO_URI)
  --list-unset          Print miner keys that would have verified unset
  --db-main <name>      Main database name (default: main)
  --db-creds <name>     Creds database name (default: MONGO_CREDS_DB or creds)
  --help                Show this help
`);
}

function parseArgs(argv) {
  const options = {
    apply: false,
    minerKey: null,
    mongoUri: null,
    opMongoPath: null,
    listUnset: false,
    dbMain: 'main',
    dbCreds: process.env.MONGO_CREDS_DB || 'creds'
  };

  const getValue = (index, flag) => {
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for ${flag}`);
    }
    return value;
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '--help') {
      options.help = true;
      continue;
    }

    if (arg === '--apply') {
      options.apply = true;
      continue;
    }

    if (arg === '--dry-run') {
      options.apply = false;
      continue;
    }

    if (arg === '--list-unset') {
      options.listUnset = true;
      continue;
    }

    if (arg === '--miner-key') {
      options.minerKey = getValue(i, arg);
      i += 1;
      continue;
    }

    if (arg === '--mongo-uri') {
      options.mongoUri = getValue(i, arg);
      i += 1;
      continue;
    }

    if (arg === '--db-main') {
      options.dbMain = getValue(i, arg);
      i += 1;
      continue;
    }

    if (arg === '--op-mongo-path') {
      options.opMongoPath = getValue(i, arg);
      i += 1;
      continue;
    }

    if (arg === '--db-creds') {
      options.dbCreds = getValue(i, arg);
      i += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  options.dryRun = !options.apply;
  return options;
}

function ensureOpTokenFromSecretFile() {
  if (process.env.OP_SERVICE_ACCOUNT_TOKEN) {
    return;
  }

  const candidatePaths = [
    '/run/secrets/op_service_account_token',
    '/etc/opt/dashb/op_service_account_token'
  ];

  for (const secretPath of candidatePaths) {
    if (!fs.existsSync(secretPath)) {
      continue;
    }
    const token = fs.readFileSync(secretPath, 'utf8').trim();
    if (token) {
      process.env.OP_SERVICE_ACCOUNT_TOKEN = token;
      return;
    }
  }
}

function resolveMongoUri(options) {
  let uri = options.mongoUri || process.env.MONGO_URI;

  const resolveOpPath = (opPath) => {
    ensureOpTokenFromSecretFile();
    return execFileSync('op', ['read', opPath], { encoding: 'utf8' }).trim();
  };

  if (!uri) {
    const candidates = [
      options.opMongoPath,
      process.env.OP_MONGO_OP_PATH,
      process.env.MONGO_URI_OP,
      ...DEFAULT_OP_MONGO_PATHS
    ].filter(Boolean);

    for (const opPath of candidates) {
      try {
        uri = resolveOpPath(opPath);
        if (uri) {
          break;
        }
      } catch (_error) {
        // Try the next candidate.
      }
    }
  }

  if (!uri) {
    throw new Error(
      'Missing Mongo URI. Set MONGO_URI, pass --mongo-uri, or provide --op-mongo-path.'
    );
  }

  if (uri.startsWith('op://')) {
    uri = resolveOpPath(uri);
  }

  if (!uri) {
    throw new Error('Resolved Mongo URI is empty.');
  }

  if (!/^mongodb(\+srv)?:\/\//.test(uri)) {
    throw new Error('Resolved Mongo URI is invalid (must start with mongodb:// or mongodb+srv://).');
  }

  return uri;
}

function getPrefix(minerKey) {
  if (typeof minerKey !== 'string') {
    return '';
  }
  return minerKey.split('-')[0].toUpperCase();
}

function isAllowedMinerKey(minerKey) {
  return ALLOWED_PREFIXES.has(getPrefix(minerKey));
}

function isActiveVerified(device) {
  if (!device || typeof device !== 'object') {
    return false;
  }

  const stake = device.staked && typeof device.staked === 'object' ? device.staked : null;
  const amount = stake && typeof stake.amount === 'number' ? stake.amount : null;
  const hasStakeTime = Boolean(stake && stake.time);

  return (
    device.is_registered === true &&
    device.verified === true &&
    hasStakeTime &&
    amount !== null &&
    amount > 0
  );
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return;
  }

  if (options.minerKey && !isAllowedMinerKey(options.minerKey)) {
    console.warn(
      `[warn] Miner key "${options.minerKey}" is outside allowed prefixes (BM, AEM, SDN, RDN, SVN).`
    );
  }

  const uri = resolveMongoUri(options);
  const client = new MongoClient(uri);

  const stats = {
    mode: options.dryRun ? 'dry-run' : 'apply',
    scanned: 0,
    setVerified: 0,
    unsetVerified: 0,
    unchanged: 0,
    skippedPrefix: 0,
    missingDevice: 0
  };

  const unsetCandidates = [];

  try {
    await client.connect();
    const mainDb = client.db(options.dbMain);
    const credsDb = client.db(options.dbCreds);

    const deviceQuery = options.minerKey
      ? { miner_key: options.minerKey }
      : { miner_key: { $regex: PREFIX_REGEX } };

    const shouldBeVerified = new Map();
    const deviceState = new Map();
    const deviceCursor = mainDb.collection('devices').find(deviceQuery, {
      projection: {
        miner_key: 1,
        is_registered: 1,
        verified: 1,
        staked: 1
      }
    });

    while (await deviceCursor.hasNext()) {
      const device = await deviceCursor.next();
      if (!device || !isAllowedMinerKey(device.miner_key)) {
        continue;
      }
      const activeVerified = isActiveVerified(device);
      shouldBeVerified.set(device.miner_key, activeVerified);
      const stake = device.staked && typeof device.staked === 'object' ? device.staked : null;
      const amount = stake && typeof stake.amount === 'number' ? stake.amount : null;
      deviceState.set(device.miner_key, {
        is_registered: device.is_registered === true,
        verified: device.verified === true,
        has_stake_time: Boolean(stake && stake.time),
        stake_amount: amount,
        active_verified: activeVerified
      });
    }

    const hardwareCollection = credsDb.collection('hardware');
    const hardwareQuery = options.minerKey ? { miner_key: options.minerKey } : {};
    const hardwareCursor = hardwareCollection.find(hardwareQuery, {
      projection: { _id: 1, miner_key: 1, verified: 1 }
    });

    const ops = [];
    const flushOps = async () => {
      if (!options.apply || ops.length === 0) {
        return;
      }
      await hardwareCollection.bulkWrite(ops, { ordered: false });
      ops.length = 0;
    };

    while (await hardwareCursor.hasNext()) {
      const doc = await hardwareCursor.next();
      if (!doc || typeof doc.miner_key !== 'string') {
        continue;
      }

      if (!isAllowedMinerKey(doc.miner_key)) {
        stats.skippedPrefix += 1;
        continue;
      }

      stats.scanned += 1;

      const hasDeviceRecord = shouldBeVerified.has(doc.miner_key);
      if (!hasDeviceRecord) {
        stats.missingDevice += 1;
      }

      const targetVerified = hasDeviceRecord ? shouldBeVerified.get(doc.miner_key) === true : false;
      const hasVerifiedField = Object.prototype.hasOwnProperty.call(doc, 'verified');
      const currentlyTrue = doc.verified === true;

      if (targetVerified) {
        if (currentlyTrue && hasVerifiedField) {
          stats.unchanged += 1;
          continue;
        }
        stats.setVerified += 1;
        if (options.apply) {
          ops.push({
            updateOne: {
              filter: { _id: doc._id },
              update: { $set: { verified: true } }
            }
          });
        }
      } else {
        if (!hasVerifiedField) {
          stats.unchanged += 1;
          continue;
        }
        stats.unsetVerified += 1;
        if (options.listUnset) {
          unsetCandidates.push({
            miner_key: doc.miner_key,
            reason: hasDeviceRecord ? 'device_not_active_verified' : 'missing_in_main.devices',
            main_device: deviceState.get(doc.miner_key) || null
          });
        }
        if (options.apply) {
          ops.push({
            updateOne: {
              filter: { _id: doc._id },
              update: { $unset: { verified: '' } }
            }
          });
        }
      }

      if (ops.length >= 500) {
        await flushOps();
      }
    }

    await flushOps();

    console.log('\n=== creds.hardware verified sync ===');
    console.log(`Mode:              ${stats.mode}`);
    console.log(`Main DB:           ${options.dbMain}`);
    console.log(`Creds DB:          ${options.dbCreds}`);
    console.log(`Collection:        hardware`);
    console.log(`Allowed prefixes:  BM, AEM, SDN, RDN, SVN`);
    if (options.minerKey) {
      console.log(`Miner key filter:  ${options.minerKey}`);
    }
    console.log(`Scanned:           ${stats.scanned}`);
    console.log(`Set verified=true: ${stats.setVerified}`);
    console.log(`Unset verified:    ${stats.unsetVerified}`);
    console.log(`Unchanged:         ${stats.unchanged}`);
    console.log(`Skipped prefix:    ${stats.skippedPrefix}`);
    console.log(`Missing device:    ${stats.missingDevice}`);
    if (options.listUnset) {
      console.log(`\nUnset candidates (${unsetCandidates.length}):`);
      console.log(JSON.stringify(unsetCandidates, null, 2));
    }
    console.log('');
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error('[sync-creds-hardware-verified] Failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
