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
  const CUTOFF_ISO = process.env.WEEKLY_CUTOFF_UTC || '2025-09-12T00:00:00.000Z';
  const CUTOFF_DATE = new Date(CUTOFF_ISO);

  if (!miner_key || typeof miner_key !== 'string') {
    res.status(400).json({ message: 'Invalid miner_key' });
    return;
  }

  const pageSize = 20;

  try {
    const client = await clientPromise;
    const db = client.db('main');
    // Always use device-rewards as source of truth; legacy collections are deprecated
    const devRewardsCol = db.collection('device-rewards');
    const doc = await devRewardsCol.findOne({ miner_key });
    if (!doc) {
      // Strict device-rewards only: if no doc, return empty dataset
      res.status(200).json({ success: true, items: [], totalPages: 1 });
      return;
    }
    const weekly = (doc?.weekly_rewards || [])
      .filter((wr: any) => wr.unlock_at && new Date(wr.unlock_at) >= CUTOFF_DATE)
      .map((wr: any) => ({
        _id: wr._id,
        miner_key,
        no: wr.reward_number,
        status: wr.status,
        asset_id: wr.asset_id,
        amount: wr.amount,
        txId: wr.tx_id,
        createdAt: wr.unlock_at,
        claimedAt: wr.claimed_at
      }));

    const daily = (doc?.daily_rewards || [])
      .filter((dr: any) => dr.created_at && new Date(dr.created_at) < CUTOFF_DATE)
      .map((dr: any) => ({
        _id: dr._id,
        miner_key,
        no: dr.reward_number,
        status: dr.status,
        asset_id: dr.asset_id,
        amount: dr.amount,
        txId: dr.tx_id,
        createdAt: dr.created_at,
        claimedAt: dr.claimed_at
      }));

    const all = weekly.concat(daily)
      .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const total = all.length;
    const totalPages = Math.ceil(total / pageSize) || 1;
    const start = (Number(page) - 1) * pageSize;
    const items = all.slice(start, start + pageSize);
    res.status(200).json({ success: true, items, totalPages });
  } catch (error) {
    console.error('get-rewards-page error:', error);
    res.status(500).json({ success: false, code: 'NETWORK_ERROR', message: 'Internal server error' });
  }
}
