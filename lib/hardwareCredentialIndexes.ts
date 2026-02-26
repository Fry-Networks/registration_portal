import type { Db } from 'mongodb';
import { MongoServerError } from 'mongodb';

const DEFAULT_HARDWARE_COLLECTION = process.env.MONGO_CREDS_COLLECTION ?? 'hardware';
const HARDWARE_UNIQUE_INDEX_NAME = 'hardware_miner_key_unique';

const ensuredCollections = new Set<string>();

export async function ensureHardwareCredentialIndexes(
  db: Db,
  collectionName?: string
): Promise<void> {
  const targetCollection = collectionName ?? DEFAULT_HARDWARE_COLLECTION;
  if (ensuredCollections.has(targetCollection)) {
    return;
  }

  const collection = db.collection(targetCollection);

  try {
    await collection.createIndex(
      { miner_key: 1 },
      { unique: true, name: HARDWARE_UNIQUE_INDEX_NAME }
    );
    ensuredCollections.add(targetCollection);
    return;
  } catch (error) {
    if (!(error instanceof MongoServerError)) {
      throw error;
    }

    if (error.codeName === 'IndexOptionsConflict') {
      ensuredCollections.add(targetCollection);
      return;
    }

    throw error;
  }
}
