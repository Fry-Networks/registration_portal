import { NextApiRequest, NextApiResponse } from 'next';
import axios from 'axios';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import algosdk from 'algosdk';
import clientPromise from '../../../lib/mongoclient';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const testMode =
    process.env.NEXT_PUBLIC_TEST_MODE &&
    process.env.NEXT_PUBLIC_TEST_MODE === 'true';

  const session = await getServerSession(req, res, authOptions);
  // Check if user is authenticated
  if (!session || !session.user) {
    res.status(401).json({ success: false, code: 'UNAUTHORIZED', message: 'Unauthorized' });
    return;
  }

  const data: {
    miner_key: string;
    reward_wallet: string;
    address: string;
  } = req.body;

  const { miner_key, reward_wallet, address } = data;
  if (session.user.address !== address || !address) {
    res.status(401).json({ success: false, code: 'UNAUTHORIZED', message: 'Unauthorized' });
    return;
  }

  try {
    const client = await clientPromise;
    const db = client.db('main');
    const collection = db.collection(testMode ? 'test-devices' : 'devices');
    const exists = await collection.findOne({ miner_key });

    if (!exists) {
      res.status(404).json({ success: false, code: 'NETWORK_ERROR', message: 'Not found' });
      return;
    }

    if (exists.address && exists.address !== session.user.address) {
      res.status(401).json({ success: false, code: 'UNAUTHORIZED', message: 'Unauthorized' });
      return;
    }

    await collection.updateOne(
      { miner_key },
      {
        $set: {
          reward_wallet: reward_wallet
        }
      }
    );

    res.status(200).json({ success: true });
  } catch (error) {
    console.error(miner_key + ':' + error);
    res.status(500).json({ success: false, code: 'NETWORK_ERROR', message: 'Internal server error' });
  }
}
