import { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import clientPromise from '../../../lib/mongoclient';

interface GetRewardAmountData {
  miner_key: string;
  status: string;
  date?: Date;
  mode?: 'weekly' | 'dailyPreview';
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
    res.status(401).json({ message: 'Unauthorized 1' });
    return;
  }

  const { miner_key, status, date, mode } = req.body as GetRewardAmountData;
  const CUTOFF_ISO = process.env.WEEKLY_CUTOFF_UTC || '2025-09-12T00:00:00.000Z';
  const CUTOFF_DATE = new Date(CUTOFF_ISO);

  function formatDateUTC(d: Date): string {
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }
  function getThisFridayStartUTC(ref: Date): Date {
    const d = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate(), 0, 0, 0, 0));
    const day = d.getUTCDay();
    const diffToFriday = (day + 7 - 5) % 7;
    d.setUTCDate(d.getUTCDate() - diffToFriday);
    return d;
  }

  // console.log(`Miner Key: ${miner_key} Status: ${status}`);

  const client = await clientPromise;

  try {
    const db = client.db('main');

    const device = await db
      .collection(testMode ? 'test-devices' : 'devices')
      .findOne({ miner_key });

    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }

    if (device.address && device.address !== session.user.address) {
      res.status(401).json({ message: 'Unauthorized 1' });
      return;
    }

    const weeklyMode = mode === 'weekly' || mode === 'dailyPreview';

    // Always use device-rewards as SoT; legacy only as soft fallback
    const devRewardsCol = db.collection('device-rewards');
    const doc = await devRewardsCol.findOne({ miner_key });

    if (!doc) {
      // Strict device-rewards only: return empty if not yet migrated
      res.status(200).json({ success: true, records: [] });
      return;
    }

    if (mode === 'weekly') {
      // Weekly entries (post-cutoff) + daily historical entries (pre-cutoff)
      const weeklyList = (doc.weekly_rewards || [])
        .filter((wr: any) => wr.status === status && wr.unlock_at && new Date(wr.unlock_at) >= CUTOFF_DATE)
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

      const dailyList = (doc.daily_rewards || [])
        .filter((dr: any) => dr.status === status && dr.created_at && new Date(dr.created_at) < CUTOFF_DATE)
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

      const list = weeklyList.concat(dailyList)
        .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      res.status(200).json({ success: true, records: list });
      return;
    }

    // mode === 'dailyPreview'
    const thisFridayStart = getThisFridayStartUTC(new Date());
    const dateStrings: string[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(thisFridayStart.getTime() + i * 24 * 60 * 60 * 1000);
      dateStrings.push(formatDateUTC(d));
    }
    const list = (doc.daily_rewards || [])
      .filter((dr: any) => dr.status === 'accruing' && dateStrings.includes(dr.date))
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
      }))
      .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    res.status(200).json({ success: true, records: list });
    return;

  } catch (error) {
    console.error(`Reward Amount: error`);
    res.status(500).json({ message: 'Internal server error' });
  }
}
