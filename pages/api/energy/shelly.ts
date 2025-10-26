import type { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { ObjectId } from 'mongodb';

import { authOptions } from '../auth/[...nextauth]';
import clientPromise from '../../../lib/mongoclient';
import { loggers } from '../../../lib/logger';
import {
  CommonErrors,
  createApiError,
  ErrorCodes,
  handleApiError,
} from '../../../lib/api-errors';

type ShellyRequestBody = {
  miner_key?: string | string[];
  authKey?: string;
  serverURL?: string;
  deviceId?: string;
  address?: string;
};

import type { ApiErrorResponse } from '../../../lib/api-errors';

type ShellyApiResponse =
  | { status: 'SUCCESS'; message: string }
  | ApiErrorResponse;

type ShellyDevice = {
  id?: string;
  type?: string;
  name?: string;
};

type ShellyResponse = {
  data?: {
    devices?: ShellyDevice[];
  };
  devices?: ShellyDevice[];
  error?: { code?: number; message?: string };
  message?: string;
  code?: number;
};

const ENERGY_DB_NAME = process.env.MONGO_CREDS_DB ?? 'creds';
const ENERGY_COLLECTION =
  process.env.MONGO_ENERGY_COLLECTION ??
  (process.env.NEXT_PUBLIC_TEST_MODE === 'true' ? 'test-energy' : 'energy');

const normalizeString = (value: unknown): string | undefined => {
  if (typeof value === 'string') {
    return value.trim();
  }

  if (Array.isArray(value) && typeof value[0] === 'string') {
    return value[0].trim();
  }

  return undefined;
};

const normalizeDeviceId = (value: string) => value.trim();

const normalizeServerUrl = (url: string) => {
  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return trimmed.replace(/\/$/, '');
};

const fetchShellyDevice = async (
  serverUrl: string,
  authKey: string,
  deviceId: string
): Promise<ShellyDevice | undefined> => {
  const url = `${normalizeServerUrl(serverUrl)}/v2/devices/api/get?auth_key=${encodeURIComponent(authKey)}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids: [deviceId], id: deviceId })
  });

  const payload = (await response.json().catch(() => ({}))) as ShellyResponse;

  if (!response.ok || payload.error) {
    const message =
      payload?.error?.message ??
      payload?.message ??
      `Shelly API returned HTTP ${response.status}`;
    const error = new Error(message);
    (error as Error & { statusCode?: number }).statusCode = response.status;
    throw error;
  }

  const devices =
    payload.data?.devices ??
    (Array.isArray(payload.devices) ? payload.devices : undefined);

  if (!devices || devices.length === 0) {
    return undefined;
  }

  return devices.find((device) => device?.id === deviceId) ?? devices[0];
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ShellyApiResponse>
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

  const body = (req.body as ShellyRequestBody) ?? {};
  const minerKey = normalizeString(body.miner_key);
  const authKey = normalizeString(body.authKey);
  const serverURL = normalizeString(body.serverURL);
  const deviceIdInput = normalizeString(body.deviceId);
  const address = normalizeString(body.address);

  if (!minerKey || !authKey || !serverURL || !deviceIdInput || !address) {
    return res.status(400).json(
      createApiError(
        ErrorCodes.INVALID_INPUT,
        'Missing required fields',
        'Provide miner key, auth key, server URL, device ID, and address.'
      )
    );
  }

  if (address !== session.user.address) {
    loggers.apiError('/api/energy/shelly', new Error('Wallet mismatch during Shelly credential save'), {
      sessionAddress: session.user.address,
      address,
      miner_key: minerKey,
      issueType: 'SHELLY_WALLET_MISMATCH',
      part: 'energy.shelly.auth',
    });
    return res.status(401).json(CommonErrors.walletMismatch());
  }

  const normalizedDeviceId = normalizeDeviceId(deviceIdInput);

  try {
    const client = await clientPromise;
    const db = client.db(ENERGY_DB_NAME);
    const collection = db.collection(ENERGY_COLLECTION);

    const existing = await collection.findOne<{
      owner_address?: string;
      deviceId?: string;
    }>({
      api_type: 'shelly',
      deviceId: normalizedDeviceId
    });

    if (
      existing &&
      existing.owner_address &&
      existing.owner_address !== session.user.address
    ) {
      return res.status(409).json(
        createApiError(
          ErrorCodes.DEVICE_OWNER_MISMATCH,
          'Shelly device is already registered by another wallet',
          'Please unlink the device from the other account or contact support.'
        )
      );
    }

    const device = await fetchShellyDevice(
      serverURL,
      authKey,
      normalizedDeviceId
    );

    if (!device) {
      return res.status(404).json(
        createApiError(
          ErrorCodes.DEVICE_NOT_FOUND,
          'Device ID not found in Shelly account',
          'Confirm the device is linked to your Shelly account and try again.'
        )
      );
    }

    const userObjectId =
      typeof session.user.id === 'string' && ObjectId.isValid(session.user.id)
        ? new ObjectId(session.user.id)
        : undefined;

    const now = new Date();
    const minerSubtype = minerKey.includes('-')
      ? minerKey.split('-')[0]
      : minerKey;

    const document = {
      miner_key: minerKey,
      user_id: userObjectId ?? session.user.id ?? session.user.address,
      timestamp: now,
      miner_type: 'energy',
      miner_subtype: minerSubtype,
      api_type: 'shelly',
      auth_key: authKey,
      server_url: normalizeServerUrl(serverURL),
      deviceId: normalizedDeviceId,
      device_name: device.name,
      device_type: device.type,
      owner_address: session.user.address
    };

    await collection.updateOne(
      { miner_key: minerKey, api_type: 'shelly' },
      { $set: document },
      { upsert: true }
    );

    const testMode = process.env.NEXT_PUBLIC_TEST_MODE === 'true';
    const devicesCollection = client
      .db('main')
      .collection(testMode ? 'test-devices' : 'devices');

    const deviceRecord = await devicesCollection.findOne<{ address?: string }>({
      miner_key: minerKey
    });

    if (
      deviceRecord?.address &&
      deviceRecord.address !== session.user.address
    ) {
      return res.status(403).json(
        createApiError(
          ErrorCodes.DEVICE_OWNER_MISMATCH,
          'Device is registered to another address',
          'Sign in with the wallet that owns this device or or ask support to unregister it and retry.'
        )
      );
    }

    await devicesCollection.updateOne(
      { miner_key: minerKey },
      {
        $set: { registered_portal_model: 'shelly' },
        $currentDate: { updated_at: true }
      }
    );

    res.status(200).json({
      status: 'SUCCESS',
      message: 'Shelly credentials validated and saved.'
    });
  } catch (error) {
    const knownError = error as Error & { statusCode?: number };
    const statusCode =
      typeof knownError.statusCode === 'number' ? knownError.statusCode : 500;

    handleApiError(res, '/api/energy/shelly', error, {
      status: statusCode,
      response: createApiError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to submit Shelly credentials',
        'Please try again. If the problem persists, contact support.'
      ),
      minerKey,
      walletAddress: session.user.address,
      issueType: 'SHELLY_SUBMISSION_ERROR',
      part: 'energy.shelly.handler',
      metadata: {
        miner_key: minerKey,
        address,
        deviceId: normalizedDeviceId,
      },
    });
  }
}
