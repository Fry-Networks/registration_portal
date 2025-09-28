import { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import clientPromise from '../../../lib/mongoclient';

const WEATHER_DB_NAME = process.env.MONGO_CREDS_DB ?? 'creds';
const WEATHER_COLLECTION =
  process.env.MONGO_WEATHER_COLLECTION ??
  (process.env.NEXT_PUBLIC_TEST_MODE === 'true' ? 'test-weather' : 'weather');

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session || !session.user) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  const { miner_key, address } = req.body as {
    miner_key: string;
    address: string;
  };

  if (!miner_key || !address) {
    return res.status(400).json({ message: 'Missing required fields' });
  }

  if (session.user.address !== address) {
    return res.status(401).json({ message: 'Unauthorized address' });
  }

  const testMode = process.env.NEXT_PUBLIC_TEST_MODE === 'true';

  try {
    const client = await clientPromise;
    const db = client.db('main');
    const collection = db.collection(testMode ? 'test-devices' : 'devices');

    const device = await collection.findOne({ miner_key });
    if (!device) {
      return res.status(404).json({ message: 'Device not found' });
    }

    if (device.address && device.address !== session.user.address) {
      return res.status(401).json({ message: 'Unauthorized device owner' });
    }

    const normalizedPortalModel =
      typeof device.registered_portal_model === 'string'
        ? device.registered_portal_model.toLowerCase()
        : undefined;

    const weatherDb = client.db(WEATHER_DB_NAME);
    const weatherCollection = weatherDb.collection(WEATHER_COLLECTION);

    const weatherQuery: Record<string, unknown> = {
      miner_key,
      owner_address: session.user.address
    };

    if (normalizedPortalModel) {
      weatherQuery.api_type = normalizedPortalModel;
    }

    const weatherDeleteResult = await weatherCollection.deleteMany(weatherQuery);

    if (weatherDeleteResult.deletedCount === 0) {
      const legacyQuery: Record<string, unknown> = { miner_key };

      if (normalizedPortalModel) {
        legacyQuery.api_type = normalizedPortalModel;
      }

      legacyQuery.owner_address = { $exists: false };

      await weatherCollection.deleteMany(legacyQuery);
    }

    const unsetFields: Record<string, ''> = {
      registered_portal_model: ''
    };

    if (!device.is_registered) {
      unsetFields.registration = '';

      if (device.address) {
        unsetFields.address = '';
      }

      if (device.node) {
        unsetFields.node = '';
      }
    }

    const update = { $unset: unsetFields };

    const result = await collection.updateOne({ miner_key }, update);

    if (result.matchedCount === 0) {
      return res.status(400).json({ message: 'Cancel failed' });
    }

    return res.status(200).json({
      message: device.is_registered
        ? 'Device portal reset successfully.'
        : 'Registration canceled'
    });
  } catch (error) {
    console.error('Cancel error for', miner_key, error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}
