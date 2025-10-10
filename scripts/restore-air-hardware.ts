#!/usr/bin/env ts-node

/**
 * Restore air.hardwares collection from a JSON backup.
 *
 * Usage:
 *   npm run restore-air-hardware -- --file ./backups/air-hardwares-*.json [--drop-first] [--dry-run]
 *
 * Flags:
 *   --file        Path to backup JSON file (required). Must contain an array of documents.
 *   --drop-first  Drops the air.hardwares collection before inserting.
 *   --dry-run     Validates and reports without writing to the database.
 */

import 'dotenv/config';
import { MongoClient } from 'mongodb';
import fs from 'fs';
import path from 'path';

interface RestoreOptions {
  file?: string;
  dryRun: boolean;
  dropFirst: boolean;
}

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  blue: '\x1b[36m',
};

const log = (msg: string, color: keyof typeof colors = 'reset') => {
  console.log(`${colors[color]}${msg}${colors.reset}`);
};

function parseArgs(): RestoreOptions {
  const args = process.argv.slice(2);
  const options: RestoreOptions = {
    dryRun: false,
    dropFirst: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--file':
        options.file = args[++i];
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--drop-first':
        options.dropFirst = true;
        break;
      case '--help':
        console.log(`
Usage: npm run restore-air-hardware -- --file ./backups/air-hardwares.json [--dry-run] [--drop-first]

Options:
  --file        Path to the backup JSON file (required). Must contain an array of documents.
  --drop-first  Drop the air.hardwares collection before inserting.
  --dry-run     Validate and preview without writing to MongoDB.
        `.trim());
        process.exit(0);
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!options.file) {
    throw new Error('Missing required --file parameter');
  }

  return options;
}

async function main() {
  const options = parseArgs();

  const mongoUri =
    process.env.MONGO_URI;

  if (!mongoUri) {
    throw new Error(
      'Mongo URI not set. Please set MONGO_URI.'
    );
  }

  const resolvedPath = path.resolve(process.cwd(), options.file!);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Backup file not found: ${resolvedPath}`);
  }

  log(`Reading backup from ${resolvedPath}`, 'blue');
  const raw = fs.readFileSync(resolvedPath, 'utf8');
  let docs: unknown;
  try {
    docs = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Failed to parse JSON: ${(error as Error).message}`);
  }

  if (!Array.isArray(docs)) {
    throw new Error('Backup file must contain a JSON array of documents');
  }

  log(`Loaded ${docs.length} document(s) from backup`, 'blue');

  if (options.dryRun) {
    log('[Dry Run] No changes were made.', 'yellow');
    return;
  }

  const client = new MongoClient(mongoUri);
  await client.connect();
  log('Connected to MongoDB', 'green');

  try {
    const airDb = client.db('air');
    const collection = airDb.collection('hardwares');

    if (options.dropFirst) {
      log('Dropping air.hardwares collection', 'yellow');
      await collection.drop().catch(() => {
        // ignore if collection does not exist
      });
    }

    if (docs.length > 0) {
      log('Inserting documents into air.hardwares...', 'blue');
      await collection.insertMany(docs as Record<string, unknown>[], {
        ordered: false,
      });
    }

    const count = await collection.countDocuments();
    log(`Restore complete. air.hardwares now contains ${count} documents.`, 'green');
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  log(`Restore failed: ${(error as Error).message}`, 'red');
  process.exit(1);
});

