import { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import clientPromise from '../../../lib/mongoclient';
import { FRY_1, fNODE } from '../../../lib/utils';
import { verifyClientToken } from '../../../lib/clientTokenMiddleware';
import { verifyRequestSignature } from '../../../lib/requestSignature.server';

const WEEKLY_FLAG = process.env.NEXT_PUBLIC_WEEKLY_REWARDS_ENABLED === 'true' || process.env.WEEKLY_REWARDS_ENABLED === 'true';
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

function getCurrentWeekDates(): { dateStrings: string[]; nextUnlockAt: Date } {
  const now = new Date();
  const thisFridayStart = getThisFridayStartUTC(now);
  const thisUnlock = new Date(thisFridayStart.getTime() + 5 * 60 * 1000);
  const nextUnlockAt = now.getTime() >= thisUnlock.getTime()
    ? new Date(thisFridayStart.getTime() + 7 * 24 * 60 * 60 * 1000 + 5 * 60 * 1000)
    : thisUnlock;
  const dateStrings: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(thisFridayStart.getTime() + i * 24 * 60 * 60 * 1000);
    dateStrings.push(formatDateUTC(d));
  }
  return { dateStrings, nextUnlockAt };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Layer 1: Verify client token
  if (!verifyClientToken(req, res)) {
    return;
  }

  // Layer 2: Verify request signature
  const signature = req.headers['x-request-signature'] as string;
  const timestamp = req.headers['x-request-timestamp'] as string;

  if (!signature || !timestamp) {
    res.status(403).json({
      success: false,
      code: 'MISSING_SIGNATURE',
      message: 'Request signature or timestamp missing'
    });
    return;
  }

  if (!verifyRequestSignature('POST', '/api/rewards/get-asset-totals', req.body, Number(timestamp), signature)) {
    res.status(403).json({
      success: false,
      code: 'INVALID_SIGNATURE',
      message: 'Invalid or expired request signature'
    });
    return;
  }

  // Layer 3: Session check
  const session = await getServerSession(req, res, authOptions);
  if (!session || !session.user) {
    res.status(401).json({ success: false, code: 'UNAUTHORIZED', message: 'Unauthorized' });
    return;
  }

  const testMode = process.env.NEXT_PUBLIC_TEST_MODE === 'true';

  try {
    const client = await clientPromise;
    const db = client.db('main');

    // Get all devices owned by this user
    const devices = await db
      .collection(testMode ? 'test-devices' : 'devices')
      .find({ address: session.user.address })
      .project({ miner_key: 1 })
      .toArray();

    const minerKeys = devices.map((d: any) => d.miner_key);
    if (minerKeys.length === 0) {
      res.status(200).json({ success: true, totals: { fry1: { pending: 0, claimable: 0, claimed: 0, accruing: 0 }, fnode: { pending: 0, claimable: 0, claimed: 0, accruing: 0 } }, nextUnlockAt: null });
      return;
    }

    const devRewards = await db
      .collection('device-rewards')
      .find({ miner_key: { $in: minerKeys } })
      .toArray();

    const sum = () => ({ pending: 0, claimable: 0, claimed: 0, accruing: 0 });
    const fry1 = sum();
    const fnode = sum();

    const { dateStrings, nextUnlockAt } = getCurrentWeekDates();

    for (const doc of devRewards) {
      // Weekly (post-cutoff)
      if (Array.isArray(doc.weekly_rewards)) {
        for (const wr of doc.weekly_rewards) {
          const unlock = wr.unlock_at ? new Date(wr.unlock_at) : null;
          if (unlock && unlock >= CUTOFF_DATE) {
            const bucket = wr.asset_id === FRY_1.id ? fry1 : wr.asset_id === fNODE.id ? fnode : null;
            if (!bucket) continue;
            if (wr.status === 'pending') bucket.pending = Math.round((bucket.pending + (wr.amount || 0)) * 100) / 100;
            if (wr.status === 'claimable') bucket.claimable = Math.round((bucket.claimable + (wr.amount || 0)) * 100) / 100;
            if (wr.status === 'claimed') bucket.claimed = Math.round((bucket.claimed + (wr.amount || 0)) * 100) / 100;
          }
        }
      }

      // Daily (pre-cutoff) + this week accrual preview
      if (Array.isArray(doc.daily_rewards)) {
        for (const dr of doc.daily_rewards) {
          const created = dr.created_at ? new Date(dr.created_at) : null;
          // Pre-cutoff daily totals
          if (created && created < CUTOFF_DATE) {
            const bucket = dr.asset_id === FRY_1.id ? fry1 : dr.asset_id === fNODE.id ? fnode : null;
            if (!bucket) continue;
            if (dr.status === 'pending') bucket.pending = Math.round((bucket.pending + (dr.amount || 0)) * 100) / 100;
            if (dr.status === 'claimable') bucket.claimable = Math.round((bucket.claimable + (dr.amount || 0)) * 100) / 100;
            if (dr.status === 'claimed') bucket.claimed = Math.round((bucket.claimed + (dr.amount || 0)) * 100) / 100;
          }
          // Accrual preview for current week
          if (dr.status && (dr.status === 'accruing' || dr.status === 'pending') && dateStrings.includes(dr.date)) {
            const bucket = dr.asset_id === FRY_1.id ? fry1 : dr.asset_id === fNODE.id ? fnode : null;
            if (!bucket) continue;
            bucket.accruing = Math.round((bucket.accruing + (dr.amount || 0)) * 100) / 100;
          }
        }
      }
    }

    res.status(200).json({
      success: true,
      totals: {
        fry1,
        fnode
      },
      nextUnlockAt: nextUnlockAt.toISOString()
    });
  } catch (error) {
    console.error('get-asset-totals error:', error);
    res.status(500).json({ success: false, code: 'NETWORK_ERROR', message: 'Internal server error' });
  }
}
