import { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import clientPromise from '../../../lib/mongoclient';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const testMode =
    process.env.NEXT_PUBLIC_TEST_MODE &&
    process.env.NEXT_PUBLIC_TEST_MODE === 'true';

  const session = await getServerSession(req, res, authOptions);
  if (!session || !session.user) {
    res.status(401).json({ success: false, code: 'UNAUTHORIZED', message: 'Unauthorized' });
    return;
  }

  const { miner_key, page = 1 } = req.body as {
    miner_key: string;
    page?: number;
  };

  if (!miner_key || typeof miner_key !== 'string') {
    res.status(400).json({ message: 'Invalid miner_key' });
    return;
  }

  const pageSize = 20;

  try {
    const client = await clientPromise;
    const db = client.db('main');
    const collection = db.collection(testMode ? 'test-rewards' : 'rewards');

    const total = await collection.countDocuments({ miner_key });
    const totalPages = Math.ceil(total / pageSize) || 1;
    const items = await collection
      .find({ miner_key })
      .sort({ _id: -1 })
      .skip((Number(page) - 1) * pageSize)
      .limit(pageSize)
      .toArray();

    res.status(200).json({ success: true, items, totalPages });
  } catch (error) {
    console.error('get-rewards-page error:', error);
    res.status(500).json({ success: false, code: 'NETWORK_ERROR', message: 'Internal server error' });
  }
}
