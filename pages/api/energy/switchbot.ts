import type { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';

import { authOptions } from '../auth/[...nextauth]';
import clientPromise from '../../../lib/mongoclient';
import { ObjectId } from 'mongodb';
import {
  MIN_SECRET_LENGTH,
  MIN_TOKEN_LENGTH,
  SwitchbotClient,
  sanitizeDeviceId
} from '../../../lib/switchbot';
import type { SwitchbotDeviceRecord } from '../../../lib/switchbot';

type SwitchbotRequestBody = {
  miner_key?: string | string[];
  token?: string;
  secret?: string;
  deviceId?: string;
  address?: string;
};

type SwitchbotSuccessResponse = {
  message: string;
  status: 'SUCCESS';
};

type SwitchbotErrorResponse = {
  message: string;
  status: 'ERROR';
};

type SwitchbotApiResponse = SwitchbotSuccessResponse | SwitchbotErrorResponse;

const ENERGY_DB_NAME = process.env.MONGO_CREDS_DB ?? 'creds';
const ENERGY_COLLECTION =
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


const extractDeviceSummary = (record: SwitchbotDeviceRecord | undefined) => {
  if (!record || typeof record !== 'object') {
    return {};
  }

  const deviceIdRaw = normalizeString(record.deviceId);
  const deviceId = deviceIdRaw ? sanitizeDeviceId(deviceIdRaw) : undefined;
  const deviceName = normalizeString(record.deviceName);
  const deviceType = normalizeString(record.deviceType);
  const hubDeviceId = normalizeString(record.hubDeviceId);

  return { deviceId, deviceName, deviceType, hubDeviceId };
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<SwitchbotApiResponse>
) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    res.status(405).json({ message: 'Method Not Allowed', status: 'ERROR' });
    return;
  }

  const session = await getServerSession(req, res, authOptions);

  if (!session || !session.user?.address) {
    res.status(401).json({ message: 'Unauthorized', status: 'ERROR' });
    return;
  }

  const body = (req.body as SwitchbotRequestBody) ?? {};
  const minerKey = normalizeString(body.miner_key)?.trim();
  const token = normalizeString(body.token)?.trim();
  const secret = normalizeString(body.secret)?.trim();
  const rawDeviceId = normalizeString(body.deviceId);
  const deviceId = rawDeviceId ? sanitizeDeviceId(rawDeviceId) : undefined;
  const address = normalizeString(body.address)?.trim();

  if (!minerKey || !token || !secret || !deviceId || !address) {
    res
      .status(400)
      .json({ message: 'Missing required fields', status: 'ERROR' });
    return;
  }

  if (address !== session.user.address) {
    res.status(401).json({ message: 'Unauthorized address', status: 'ERROR' });
    return;
  }

  if (token.length < MIN_TOKEN_LENGTH || secret.length < MIN_SECRET_LENGTH) {
    res.status(400).json({ message: 'SwitchBot token or secret is too short.', status: 'ERROR' });
    return;
  }

  if (deviceId.length !== 12) {
    res.status(400).json({ message: 'Device ID must be 12 hexadecimal characters.', status: 'ERROR' });
    return;
  }

  try {
    const client = new SwitchbotClient(token, secret);

    const devicesPayload = await client.listDevices();
    if (!devicesPayload || devicesPayload.statusCode !== 100) {
      const error = new Error(
        devicesPayload?.message ?? 'SwitchBot API rejected the provided credentials.'
      );
      (error as Error & { statusCode?: number }).statusCode = 400;
      throw error;
    }

    const list = devicesPayload.body?.deviceList ?? [];
    const deviceSummary = extractDeviceSummary(
      list.find(
        (record) =>
          sanitizeDeviceId(normalizeString(record.deviceId) ?? '') === deviceId
      )
    );

    if (!deviceSummary.deviceId) {
      const error = new Error('Device ID not found in SwitchBot account.');
      (error as Error & { statusCode?: number }).statusCode = 404;
      throw error;
    }

    const statusPayload = await client.getDeviceStatus(deviceSummary.deviceId);
    if (!statusPayload || statusPayload.statusCode !== 100) {
      const error = new Error(
        statusPayload?.message ?? 'Failed to verify SwitchBot device status.'
      );
      (error as Error & { statusCode?: number }).statusCode = 400;
      throw error;
    }

    const clientConn = await clientPromise;
    const db = clientConn.db(ENERGY_DB_NAME);
    const collection = db.collection(ENERGY_COLLECTION);

    const existingCredential = await collection.findOne<{
      owner_address?: string;
      miner_key?: string;
    }>({
      api_type: 'switchbot',
      deviceId: deviceSummary.deviceId
    });

    if (
      existingCredential &&
      existingCredential.owner_address &&
      existingCredential.owner_address !== session.user.address
    ) {
      res.status(409).json({
        message: 'This SwitchBot device is already registered by another user.',
        status: 'ERROR'
      });
      return;
    }

    const now = new Date();
    const minerSubtype = minerKey.includes('-')
      ? minerKey.split('-')[0]
      : minerKey;

    const userObjectId =
      typeof session.user.id === 'string' && ObjectId.isValid(session.user.id)
        ? new ObjectId(session.user.id)
        : undefined;

    const document = {
      miner_key: minerKey,
      user_id: userObjectId ?? session.user.id ?? session.user.address,
      timestamp: now,
      miner_type: 'energy',
      miner_subtype: minerSubtype,
      api_type: 'switchbot',
      token,
      secret,
      deviceId: deviceSummary.deviceId,
      device_name: deviceSummary.deviceName,
      device_type: deviceSummary.deviceType,
      hub_device_id: deviceSummary.hubDeviceId,
      owner_address: session.user.address
    };

    await collection.updateOne(
      { miner_key: minerKey, api_type: 'switchbot' },
      { $set: document },
      { upsert: true }
    );

    const testMode = process.env.NEXT_PUBLIC_TEST_MODE === 'true';
    const devicesCollection = clientConn
      .db('main')
      .collection(testMode ? 'test-devices' : 'devices');

    const deviceRecord = await devicesCollection.findOne<{ address?: string }>({
      miner_key: minerKey
    });

    if (
      deviceRecord?.address &&
      deviceRecord.address !== session.user.address
    ) {
      res.status(403).json({
        message: 'Device is registered to another address.',
        status: 'ERROR'
      });
      return;
    }

    await devicesCollection.updateOne(
      { miner_key: minerKey },
      {
        $set: { registered_portal_model: 'switchbot' },
        $currentDate: { updated_at: true }
      }
    );

    res.status(200).json({
      message: 'SwitchBot credentials validated and saved.',
      status: 'SUCCESS'
    });
  } catch (error) {
    console.error('[energy/switchbot] submission error', error);
    const message =
      error instanceof Error ? error.message : 'Failed to submit SwitchBot credentials';
    const statusCode =
      error instanceof Error &&
      'statusCode' in error &&
      typeof (error as Error & { statusCode?: number }).statusCode === 'number'
        ? (error as Error & { statusCode?: number }).statusCode
        : 500;

    res.status(statusCode).json({ message, status: 'ERROR' });
  }
}
