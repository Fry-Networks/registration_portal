import { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import clientPromise from '../../../lib/mongoclient';
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

function getCurrentWeekWindow(now: Date): { weekStart: Date; dateStrings: string[]; nextUnlockAt: Date } {
  const thisFridayStart = getThisFridayStartUTC(now);
  // If we are already past Friday 00:05 UTC, next unlock is next Friday
  const nowUTCms = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours(), now.getUTCMinutes(), now.getUTCSeconds(), now.getUTCMilliseconds());
  const thisUnlock = new Date(thisFridayStart.getTime() + 5 * 60 * 1000);
  const nextUnlockAt = nowUTCms >= thisUnlock.getTime() ? new Date(thisFridayStart.getTime() + 7 * 24 * 60 * 60 * 1000 + 5 * 60 * 1000) : thisUnlock;

  // Build current week date strings from thisFridayStart to today
  const weekStart = thisFridayStart;
  const dateStrings: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart.getTime() + i * 24 * 60 * 60 * 1000);
    dateStrings.push(formatDateUTC(d));
  }
  return { weekStart, dateStrings, nextUnlockAt };
}

interface GetRewardSummaryData {
  miner_key: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
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

  if (!verifyRequestSignature('POST', '/api/rewards/get-reward-summary', req.body, Number(timestamp), signature)) {
    res.status(403).json({
      success: false,
      code: 'INVALID_SIGNATURE',
      message: 'Invalid or expired request signature'
    });
    return;
  }

  // Layer 3: Session check
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

    // Device-rewards is the single source of truth
    const devRewardsCol = db.collection('device-rewards');
    const doc = await devRewardsCol.findOne({ miner_key });
    let pending = 0;
    let claimable = 0;
    let claimed = 0;
    let accruing = 0;
    let nextUnlockAt: string | null = null;

    if (doc) {
      // Sum weekly (post-cutoff)
      if (Array.isArray(doc.weekly_rewards)) {
        for (const wr of doc.weekly_rewards) {
          if (wr.unlock_at && new Date(wr.unlock_at) >= CUTOFF_DATE) {
            if (wr.status === 'pending') pending = Math.round((pending + (wr.amount || 0)) * 100) / 100;
            if (wr.status === 'claimable') claimable = Math.round((claimable + (wr.amount || 0)) * 100) / 100;
            if (wr.status === 'claimed') claimed = Math.round((claimed + (wr.amount || 0)) * 100) / 100;
          }
        }
      }

      // Include pre-cutoff daily totals (historical daily behavior)
      if (Array.isArray(doc.daily_rewards)) {
        for (const dr of doc.daily_rewards) {
          const created = new Date(dr.created_at);
          if (created < CUTOFF_DATE) {
            if (dr.status === 'pending') pending = Math.round((pending + (dr.amount || 0)) * 100) / 100;
            if (dr.status === 'claimable') claimable = Math.round((claimable + (dr.amount || 0)) * 100) / 100;
            if (dr.status === 'claimed') claimed = Math.round((claimed + (dr.amount || 0)) * 100) / 100;
          }
        }
      }

      // Sum daily accruals within this week for preview (always from device-rewards)
      const { dateStrings, nextUnlockAt: nua } = getCurrentWeekWindow(new Date());
      nextUnlockAt = nua.toISOString();
      if (Array.isArray(doc.daily_rewards)) {
        for (const dr of doc.daily_rewards) {
          if ((dr.status === 'accruing' || dr.status === 'pending') && dateStrings.includes(dr.date)) {
            accruing = Math.round((accruing + (dr.amount || 0)) * 100) / 100;
          }
        }
      }
    }

    res.status(200).json({ success: true, summary: { pending, claimable, claimed, accruing, nextUnlockAt } });
  } catch (error) {
    console.error('get-reward-summary error:', error);
    res.status(500).json({ success: false, code: 'NETWORK_ERROR', message: 'Internal server error' });
  }
}
