#!/usr/bin/env node
'use strict';

// Simple CLI to cancel a partial registration for a miner
// Usage:
//   node scripts/cancel-registration.js --miner <MINER_KEY> --address <WALLET_ADDRESS> [--test]

const { MongoClient } = require('mongodb');
const path = require('path');
require('dotenv').config({ path: path.resolve(process.cwd(), '.env') });

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--miner' || a === '-m') {
      args.miner = argv[++i];
    } else if (a === '--address' || a === '-a') {
      args.address = argv[++i];
    } else if (a === '--test' || a === '-t') {
      args.test = true;
    } else if (a === '--help' || a === '-h') {
      args.help = true;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help || !args.miner || !args.address) {
    console.log('Cancel a partial registration (clears pending state).');
    console.log('');
    console.log('Usage:');
    console.log('  node scripts/cancel-registration.js --miner <MINER_KEY> --address <WALLET_ADDRESS> [--test]');
    console.log('');
    process.exit(args.help ? 0 : 1);
  }

  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    console.error('MONGO_URI not set in environment');
    process.exit(1);
  }

  const testMode = args.test || (process.env.NEXT_PUBLIC_TEST_MODE === 'true');
  const collectionName = testMode ? 'test-devices' : 'devices';

  const client = new MongoClient(mongoUri);
  try {
    await client.connect();
    const db = client.db('main');
    const col = db.collection(collectionName);

    const device = await col.findOne({ miner_key: args.miner });
    if (!device) {
      console.error('Device not found for miner_key:', args.miner);
      process.exit(1);
    }

    if (device.address && device.address !== args.address) {
      console.error('Unauthorized: device owned by a different address');
      process.exit(1);
    }

    if (device.is_registered) {
      console.error('Device already fully registered. Use delete API or UI to unregister.');
      process.exit(1);
    }

    const update = { $unset: { registration: '', registered_portal_model: '' } };
    if (device.address && !device.is_registered) {
      update.$unset.address = '';
    }
    if (device.node && !device.is_registered) {
      update.$unset.node = '';
    }

    const result = await col.updateOne({ miner_key: args.miner }, update);
    if (result.matchedCount === 0) {
      console.error('Cancel failed to match device');
      process.exit(1);
    }

    console.log('Registration canceled for miner_key:', args.miner);
  } catch (err) {
    console.error('Error:', err.message || err);
    process.exit(1);
  } finally {
    try { await client.close(); } catch (_) {}
  }
}

main();
