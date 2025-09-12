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

    // If another owner already set, block
    if (device.address && device.address !== session.user.address) {
      return res.status(401).json({ message: 'Unauthorized device owner' });
    }

    // If fully registered, direct the user to delete instead
    if (device.is_registered) {
      return res.status(400).json({ message: 'Device already registered' });
    }

    const update: any = {
      $unset: {
        registration: '',
        registered_portal_model: ''
      }
    };

    // If address was set prematurely, clear it to unlock future attempts
    if (device.address && !device.is_registered) {
      update.$unset.address = '';
    }

    // Clear any partial node section if present without registration
    if (device.node && !device.is_registered) {
      update.$unset.node = '';
    }

    const result = await collection.updateOne({ miner_key }, update);

    if (result.matchedCount === 0) {
      return res.status(400).json({ message: 'Cancel failed' });
    }

    return res.status(200).json({ message: 'Registration canceled' });
  } catch (error) {
    console.error('Cancel error for', miner_key, error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

