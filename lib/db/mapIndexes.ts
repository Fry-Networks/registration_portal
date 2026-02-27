import type { MongoClient } from 'mongodb';

// Cache index creation per collection to avoid repeated work per request.
const ensuredCollections = new Set<string>();

const MAIN_DB_NAME = 'main';
const CREDS_DB_NAME = process.env.MONGO_CREDS_DB ?? 'creds';
// PoC telemetry lives in a separate database/collection from device metadata.
const POC_DB_NAME = 'PoC';
const POC_COLLECTION_NAME = 'hardware';

export const ensureDeviceMapIndexes = async (client: MongoClient, collectionName: string) => {
  const key = `${MAIN_DB_NAME}.${collectionName}`;
  if (ensuredCollections.has(key)) return;

  const collection = client.db(MAIN_DB_NAME).collection(collectionName);
  // Support wallet-scoped device lookups for explorer aggregation.
  await collection.createIndex({ address: 1, miner_key: 1 }, { name: 'explorer_address_miner_key' });
  ensuredCollections.add(key);
};

export const ensureCredsMapIndexes = async (client: MongoClient, collectionName: string) => {
  const key = `${CREDS_DB_NAME}.${collectionName}`;
  if (ensuredCollections.has(key)) return;

  const collection = client.db(CREDS_DB_NAME).collection(collectionName);
  // Speed up wallet + miner key lookups when pulling hex ids from creds.
  await collection.createIndex({ address: 1, miner_key: 1 }, { name: 'explorer_address_miner_key' });
  // Speed up hex-scoped lookups for a wallet without reading lat/lng.
  await collection.createIndex({ address: 1, 'position.hexId': 1 }, { name: 'explorer_address_hex' });
  ensuredCollections.add(key);
};

export const ensureTelemetryMapIndexes = async (client: MongoClient) => {
  const key = `${POC_DB_NAME}.${POC_COLLECTION_NAME}`;
  if (ensuredCollections.has(key)) return;

  const collection = client.db(POC_DB_NAME).collection(POC_COLLECTION_NAME);
  // Keep telemetry lookups fast for miner_key → uptime.status resolution.
  await collection.createIndex({ miner_key: 1 }, { name: 'telemetry_miner_key' });
  ensuredCollections.add(key);
};
