import { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import clientPromise from '../../../lib/mongoclient';

interface GetRewardSummaryData {
  miner_key: string;
}

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

  const { miner_key } = req.body as GetRewardSummaryData;

  try {
    const client = await clientPromise;
    const db = client.db('main');

    const device = await db
      .collection(testMode ? 'test-devices' : 'devices')
      .findOne({ miner_key });

    if (!device) {
      return res.status(404).json({ success: false, code: 'NETWORK_ERROR', message: 'Device not found' });
    }

    if (device.address && device.address !== session.user.address) {
      res.status(401).json({ success: false, code: 'UNAUTHORIZED', message: 'Unauthorized' });
      return;
    }

    const collection = testMode
      ? db.collection('test-rewards')
      : db.collection('rewards');

    // Aggregate totals for pending and claimable in one pass
    const pipeline = [
      { $match: { miner_key, status: { $in: ['pending', 'claimable'] } } },
      {
        $group: {
          _id: '$status',
          total: { $sum: { $toDouble: '$amount' } }
        }
      }
    ];

    const grouped = (await collection
      .aggregate(pipeline)
      .toArray()) as Array<{ _id: string; total: number }>;

    const summary = grouped.reduce(
      (acc: Record<string, number>, cur) => {
        acc[cur._id] = Math.round((cur.total || 0) * 100) / 100;
        return acc;
      },
      { pending: 0, claimable: 0 }
    );

    res.status(200).json({ success: true, summary });
  } catch (error) {
    console.error('get-reward-summary error:', error);
    res.status(500).json({ success: false, code: 'NETWORK_ERROR', message: 'Internal server error' });
  }
}
