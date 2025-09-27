import type { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import clientPromise from '../../../lib/mongoclient';

type CredentialRequestBody = {
  miner_key?: string | string[];
  type?: string;
};

type CredentialRecord = {
  miner_key: string;
  api_type: string;
  stationID?: number;
  token?: string;
  lat?: number;
  lon?: number;
  device_name?: string;
  timestamp?: Date;
  updated_at?: Date;
  owner_address?: string;
};

type CredentialSuccessResponse = {
  data: {
    miner_key: string;
    api_type: string;
    stationID?: number;
    token?: string;
    lat?: number;
    lon?: number;
    device_name?: string;
    timestamp?: Date;
  } | null;
};

type CredentialErrorResponse = {
  message: string;
  status: 'ERROR';
};

type CredentialApiResponse =
  | CredentialSuccessResponse
  | CredentialErrorResponse;

const normalizeString = (value: unknown): string | undefined => {
  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value) && typeof value[0] === 'string') {
    return value[0];
  }

  return undefined;
};

const WEATHER_DB_NAME = process.env.MONGO_CREDS_DB ?? 'creds';
const WEATHER_COLLECTION =
  process.env.MONGO_WEATHER_COLLECTION ??
  (process.env.NEXT_PUBLIC_TEST_MODE === 'true' ? 'test-weather' : 'weather');
const DEFAULT_API_TYPE = 'tempest';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<CredentialApiResponse>
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

  const body = (req.body as CredentialRequestBody) ?? {};
  const minerKey = normalizeString(body.miner_key);
  const apiType = normalizeString(body.type) ?? DEFAULT_API_TYPE;

  if (!minerKey) {
    res.status(400).json({ message: 'Missing miner key', status: 'ERROR' });
    return;
  }

  try {
    const client = await clientPromise;
    const db = client.db(WEATHER_DB_NAME);
    const collection = db.collection(WEATHER_COLLECTION);

    const record = await collection.findOne<
      CredentialRecord & { owner_address?: string }
    >({ miner_key: minerKey, api_type: apiType });

    if (
      record &&
      record.owner_address &&
      record.owner_address !== session.user.address
    ) {
      res.status(403).json({ message: 'Forbidden', status: 'ERROR' });
      return;
    }

    const sanitized = record
      ? {
          miner_key: record.miner_key,
          api_type: record.api_type,
          stationID: record.stationID,
          token: record.token,
          lat: record.lat,
          lon: record.lon,
          device_name: record.device_name,
          timestamp: record.timestamp ?? record.updated_at
        }
      : null;

    res.status(200).json({ data: sanitized });
  } catch (error) {
    console.error('[devices/get-credential] error', error);
    res.status(500).json({ message: 'Internal server error', status: 'ERROR' });
  }
}
