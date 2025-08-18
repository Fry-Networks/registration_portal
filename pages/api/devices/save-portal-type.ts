import { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import clientPromise from '../../../lib/mongoclient';

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

  const { miner_key, type, address } = req.body;
  if (!miner_key || !type || !address) {
    return res.status(400).json({ message: 'Missing required fields' });
  }
  if (session.user.address !== address) {
    return res.status(401).json({ message: 'Unauthorized address' });
  }

  const testMode =
    process.env.NEXT_PUBLIC_TEST_MODE &&
    process.env.NEXT_PUBLIC_TEST_MODE === 'true';

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

    const updateResult = await collection.updateOne(
      { miner_key },
      {
        $set: {
          registered_portal_model: type,
        }
      }
    );

    if (updateResult.matchedCount === 0) {
      return res.status(400).json({ message: 'Failed to update credential' });
    }

    return res.status(200).json({
      message: 'Credential updated successfully',
      device: await collection.findOne({ miner_key })
    });
  } catch (error) {
    console.error('Error saving portal credential:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}
