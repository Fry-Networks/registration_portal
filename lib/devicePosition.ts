import type { MongoClient } from 'mongodb';
import { collectionFor } from '../pages/api/credentials/utils';

type PositionRecord = {
  lat?: number | string;
  lng?: number | string;
  hexId?: string;
};

const CREDS_DB_NAME = process.env.MONGO_CREDS_DB ?? 'creds';

const parseCoordinate = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (!Number.isNaN(parsed) && Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
};

export async function fetchDevicePosition(
  client: MongoClient,
  minerKey: string,
  address: string
): Promise<{ lat: number; lng: number; hexId?: string } | null> {
  const db = client.db(CREDS_DB_NAME);
  const collectionName = collectionFor({ miner_key: minerKey });
  const doc = await db.collection(collectionName).findOne<{ position?: PositionRecord }>({
    miner_key: minerKey,
    address
  });

  const position = doc?.position;
  if (!position) return null;

  const lat = parseCoordinate(position.lat);
  const lng = parseCoordinate(position.lng);
  if (lat === null || lng === null) return null;

  return {
    lat,
    lng,
    hexId: position.hexId
  };
}

export async function hydrateDeviceWithPosition<T extends { miner_key: string; address: string; position?: any; hexId?: any }>(
  client: MongoClient,
  device: T
): Promise<T> {
  if (device.position && typeof device.position.lat !== 'undefined' && typeof device.position.lng !== 'undefined') {
    return device;
  }

  const coords = await fetchDevicePosition(client, device.miner_key, device.address);
  if (!coords) {
    return device;
  }

  return {
    ...device,
    position: {
      lat: coords.lat,
      lng: coords.lng
    },
    hexId: device.hexId ?? coords.hexId
  };
}
