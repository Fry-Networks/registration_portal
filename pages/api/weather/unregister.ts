import type { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import clientPromise from '../../../lib/mongoclient';

type UnregisterRequestBody = {
  miner_key?: string | string[];
  api_type?: string;
  address?: string;
};

type UnregisterSuccessResponse = {
  message: string;
  status: 'SUCCESS';
};

type UnregisterErrorResponse = {
  message: string;
  status: 'ERROR';
};

type UnregisterApiResponse =
  | UnregisterSuccessResponse
  | UnregisterErrorResponse;

const WEATHER_DB_NAME = process.env.MONGO_CREDS_DB ?? 'creds';
const WEATHER_COLLECTION =
  process.env.MONGO_WEATHER_COLLECTION ??
  (process.env.NEXT_PUBLIC_TEST_MODE === 'true' ? 'test-weather' : 'weather');

const normalizeString = (value: unknown): string | undefined => {
  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value) && typeof value[0] === 'string') {
    return value[0];
  }

  return undefined;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<UnregisterApiResponse>
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

  const body = (req.body as UnregisterRequestBody) ?? {};
  const minerKey = normalizeString(body.miner_key);
  const apiType = normalizeString(body.api_type) ?? 'tempest';
  const address = normalizeString(body.address);

  if (!minerKey || !apiType || !address) {
    res
      .status(400)
      .json({ message: 'Missing required fields', status: 'ERROR' });
    return;
  }

  if (address !== session.user.address) {
    res.status(401).json({ message: 'Unauthorized address', status: 'ERROR' });
    return;
  }

  try {
    const client = await clientPromise;
    const weatherDb = client.db(WEATHER_DB_NAME);
    const weatherCollection = weatherDb.collection(WEATHER_COLLECTION);

    const existingRecord = await weatherCollection.findOne({
      miner_key: minerKey,
      api_type: apiType
    });

    if (
      existingRecord &&
      existingRecord.owner_address &&
      existingRecord.owner_address !== session.user.address
    ) {
      res.status(403).json({ message: 'Forbidden', status: 'ERROR' });
      return;
    }

    const deleteResult = await weatherCollection.deleteOne({
      miner_key: minerKey,
      api_type: apiType
    });

    if (deleteResult.deletedCount === 0) {
      res
        .status(404)
        .json({ message: 'No credential found to remove.', status: 'ERROR' });
      return;
    }

    const testMode =
      process.env.NEXT_PUBLIC_TEST_MODE &&
      process.env.NEXT_PUBLIC_TEST_MODE === 'true';

    const devicesCollection = client
      .db('main')
      .collection(testMode ? 'test-devices' : 'devices');

    await devicesCollection.updateOne(
      { miner_key: minerKey, address: session.user.address },
      { $unset: { registered_portal_model: '' } }
    );

    res.status(200).json({
      message: 'Weather credential deleted successfully.',
      status: 'SUCCESS'
    });
  } catch (error) {
    console.error('[weather/unregister] error', error);
    res.status(500).json({ message: 'Internal server error', status: 'ERROR' });
  }
}
