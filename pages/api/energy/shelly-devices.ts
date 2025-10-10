import type { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import ShellyApi from './shellyapi';

import { authOptions } from '../auth/[...nextauth]';
import clientPromise from '../../../lib/mongoclient';

type DeviceSummary = {
  deviceId: string;
  deviceName: string;
  deviceType: string | undefined;
};

const CREDENTIAL_DB_NAME = process.env.MONGO_CREDS_DB ?? 'creds';
const CREDENTIAL_COLLECTION =
  process.env.MONGO_ENERGY_COLLECTION ??
  (process.env.NEXT_PUBLIC_TEST_MODE === 'true' ? 'test-energy' : 'energy');

const normalizeString = (value: unknown): string | undefined => {
  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value) && typeof value[0] === 'string') {
    return value[0];
  }

  return undefined;
};

const normalizeServerUrl = (url: string) => {
  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return trimmed.replace(/\/$/, '');
};

const getShellyActiveDevices = async (
  serverUrl: string,
  authKey: string
): Promise<string[]> => {
  const api = new ShellyApi(normalizeServerUrl(serverUrl), authKey, 5000);
  const ids = await api.get_active_device_ids();
  return ids.map((id) => id.toString());
};

const extractDeviceSummary = (deviceId: string): DeviceSummary => {
  return {
    deviceId: deviceId.toString(),
    deviceName: `Shelly Device ${deviceId}`,
    deviceType: 'shelly'
  };
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    res.status(405).json({ message: 'Method Not Allowed' });
    return;
  }

  const session = await getServerSession(req, res, authOptions);

  if (!session || !session.user?.address) {
    res.status(401).json({ message: 'Unauthorized' });
    return;
  }

  const body = req.body as {
    authKey?: string;
    serverURL?: string;
    address?: string;
    miner_key?: string | string[];
    currentDeviceId?: string;
  };

  const authKey = normalizeString(body.authKey)?.trim();
  const serverURL = normalizeString(body.serverURL)?.trim();
  const address = normalizeString(body.address)?.trim();
  const minerKey = normalizeString(body.miner_key)?.trim();
  const currentDeviceId = normalizeString(body.currentDeviceId)?.trim();

  if (!authKey || !serverURL || !address || !minerKey) {
    res.status(400).json({ message: 'Missing required fields' });
    return;
  }

  if (address !== session.user.address) {
    res.status(401).json({ message: 'Unauthorized address' });
    return;
  }

  if (authKey.length < 10) {
    res.status(400).json({ message: 'Shelly auth key is too short.' });
    return;
  }

  try {
    // Get active device IDs using Python API
    const activeDeviceIds = await getShellyActiveDevices(serverURL, authKey);

    if (!Array.isArray(activeDeviceIds)) {
      res.status(400).json({ message: 'Failed to retrieve active Shelly devices.' });
      return;
    }

    // Convert device IDs to device summaries
    const records = activeDeviceIds
      .map((deviceId) => extractDeviceSummary(deviceId))
      .filter((entry): entry is DeviceSummary => entry !== undefined);

    // Check which devices are already registered
    const clientConn = await clientPromise;
    const credentialCollection = clientConn
      .db(CREDENTIAL_DB_NAME)
      .collection(CREDENTIAL_COLLECTION);

    const existing = await credentialCollection
      .find({ api_type: 'shelly' }, { projection: { 'credentials.deviceId': 1 } })
      .toArray();

    const registeredIds = new Set(
      existing
        .map((doc) =>
          typeof doc.credntials?.deviceId === 'string' ? doc.credentials.deviceId.trim() : undefined
        )
        .filter((id): id is string => Boolean(id))
    );

    // Remove current device ID from registered list if provided (for updates)
    if (currentDeviceId) {
      registeredIds.delete(currentDeviceId);
    }

    // Filter out already registered devices
    const availableDevices = records.filter(
      (record) => !registeredIds.has(record.deviceId)
    );

    res.status(200).json({ devices: availableDevices });
  } catch (error) {
    console.error('[energy/shelly-devices] error', error);
    const message =
      error instanceof Error ? error.message : 'Failed to fetch Shelly devices';
    const knownError = error as Error & { statusCode?: number };
    const statusCode =
      typeof knownError.statusCode === 'number' ? knownError.statusCode : 500;

    res.status(statusCode).json({ status: 'ERROR', message });
  }
}