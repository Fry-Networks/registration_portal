import type { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';

import { authOptions } from '../auth/[...nextauth]';
import clientPromise from '../../../lib/mongoclient';
import {
  MIN_SECRET_LENGTH,
  MIN_TOKEN_LENGTH,
  SwitchbotClient,
  sanitizeDeviceId
} from '../../../lib/switchbot';
import type { SwitchbotDeviceRecord } from '../../../lib/switchbot';

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

const extractDeviceSummary = (
  record: SwitchbotDeviceRecord | undefined
): DeviceSummary | undefined => {
  if (!record || typeof record !== 'object') {
    return undefined;
  }

  const rawId = normalizeString(record.deviceId);
  if (!rawId) {
    return undefined;
  }

  const deviceId = sanitizeDeviceId(rawId);
  return {
    deviceId,
    deviceName: normalizeString(record.deviceName) ?? deviceId,
    deviceType: normalizeString(record.deviceType) ?? undefined
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
    token?: string;
    secret?: string;
    address?: string;
    miner_key?: string | string[];
    currentDeviceId?: string;
  };

  const token = normalizeString(body.token)?.trim();
  const secret = normalizeString(body.secret)?.trim();
  const address = normalizeString(body.address)?.trim();
  const minerKey = normalizeString(body.miner_key)?.trim();
  const currentDeviceIdRaw = normalizeString(body.currentDeviceId);
  const currentDeviceId = currentDeviceIdRaw
    ? sanitizeDeviceId(currentDeviceIdRaw)
    : undefined;

  if (!token || !secret || !address || !minerKey) {
    res.status(400).json({ message: 'Missing required fields' });
    return;
  }

  if (address !== session.user.address) {
    res.status(401).json({ message: 'Unauthorized address' });
    return;
  }

  if (token.length < MIN_TOKEN_LENGTH || secret.length < MIN_SECRET_LENGTH) {
    res.status(400).json({ message: 'SwitchBot token or secret is too short.' });
    return;
  }

  try {
    const client = new SwitchbotClient(token, secret);
    const payload = await client.listDevices();

    if (!payload || payload.statusCode !== 100) {
      const message =
        payload?.message ?? 'SwitchBot API rejected the provided credentials.';
      res.status(400).json({ message });
      return;
    }

    const records = (payload.body?.deviceList ?? [])
      .map((entry) => extractDeviceSummary(entry))
      .filter((entry): entry is DeviceSummary => entry !== undefined);

    const clientConn = await clientPromise;
    const credentialCollection = clientConn
      .db(CREDENTIAL_DB_NAME)
      .collection(CREDENTIAL_COLLECTION);

    const existing = await credentialCollection
      .find({ api_type: 'switchbot' }, { projection: { deviceId: 1 } })
      .toArray();

    const registeredIds = new Set(
      existing
        .map((doc) =>
          typeof doc.deviceId === 'string' ? sanitizeDeviceId(doc.deviceId) : undefined
        )
        .filter((id): id is string => Boolean(id))
    );

    if (currentDeviceId) {
      registeredIds.delete(currentDeviceId);
    }

    const availableDevices = records.filter(
      (record) => !registeredIds.has(record.deviceId)
    );

    res.status(200).json({ devices: availableDevices });
  } catch (error) {
    console.error('[energy/switchbot-devices] error', error);
    const message =
      error instanceof Error ? error.message : 'Failed to fetch SwitchBot devices';
    const knownError = error as Error & { statusCode?: number };
    const statusCode =
      typeof knownError.statusCode === 'number' ? knownError.statusCode : 500;

    res.status(statusCode).json({ status: 'ERROR', message });
  }
}
