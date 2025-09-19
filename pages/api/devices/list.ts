import { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import clientPromise from '../../../lib/mongoclient';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions);
  if (!session || !session.user) {
    res.status(401).json({ success: false, code: 'UNAUTHORIZED', message: 'Unauthorized' });
    return;
  }
  const testMode = process.env.NEXT_PUBLIC_TEST_MODE === 'true';
  try {
    const client = await clientPromise;
    const db = client.db('main');
    const cursor = db.collection(testMode ? 'test-devices' : 'devices')
      .find({ address: session.user.address })
      .project({ miner_key: 1 })
      .sort({ miner_key: 1 });
    const items = await cursor.toArray();
    const miner_keys = items.map((d: any) => d.miner_key);
    res.status(200).json({ success: true, miner_keys });
  } catch (e) {
    res.status(500).json({ success: false, code: 'NETWORK_ERROR', message: 'Internal server error' });
  }
}

