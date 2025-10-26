import type { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import ShellyApi from './shellyapi';

import { authOptions } from '../auth/[...nextauth]';
import clientPromise from '../../../lib/mongoclient';
import { loggers } from '../../../lib/logger';
import {
  CommonErrors,
  createApiError,
  ErrorCodes,
  handleApiError,
} from '../../../lib/api-errors';

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
    return res.status(405).json(
      createApiError(
        ErrorCodes.INVALID_INPUT,
        'That request is not available.',
        'Please retry this action from the dashboard.'
      )
    );  
  }

  const session = await getServerSession(req, res, authOptions);

  if (!session || !session.user?.address) {
    return res.status(401).json(CommonErrors.noSession());
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
    return res.status(400).json(
      createApiError(
        ErrorCodes.INVALID_INPUT,
        'Missing required fields',
        'Please provide Shelly auth key, server URL, device miner key, and address.'
      )
    );
  }

  if (address !== session.user.address) {
    loggers.apiError('/api/energy/shelly-devices', new Error('Wallet mismatch during Shelly device listing'), {
      sessionAddress: session.user.address,
      address,
      miner_key: minerKey,
      issueType: 'SHELLY_DEVICE_WALLET_MISMATCH',
      part: 'energy.shelly-devices.auth',
    });
    return res.status(401).json(CommonErrors.walletMismatch());
  }

  if (authKey.length < 10) {
    return res.status(400).json(
      createApiError(
        ErrorCodes.INVALID_INPUT,
        'Shelly auth key is too short',
        'Please copy the full auth key from the Shelly dashboard.'
      )
    );
  }

  try {
    // Get active device IDs using Python API
    const activeDeviceIds = await getShellyActiveDevices(serverURL, authKey);

    if (!Array.isArray(activeDeviceIds)) {
      return res.status(400).json(
        createApiError(
          ErrorCodes.INVALID_INPUT,
          'Failed to retrieve active Shelly devices',
          'Please verify your Shelly credentials and try again.'
        )
      );
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
          typeof (doc as any)?.credentials?.deviceId === 'string'
            ? String((doc as any).credentials.deviceId).trim()
            : undefined
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
    const knownError = error as Error & { statusCode?: number };
    const statusCode =
      typeof knownError.statusCode === 'number' ? knownError.statusCode : 500;

    handleApiError(res, '/api/energy/shelly-devices', error, {
      status: statusCode,
      response: createApiError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to fetch Shelly devices',
        'Please try again. If the problem persists, contact support.'
      ),
      walletAddress: session.user.address,
      issueType: 'SHELLY_DEVICE_LIST_ERROR',
      part: 'energy.shelly-devices.handler',
      metadata: {
        address,
        minerKey,
      },
    });
  }
}
