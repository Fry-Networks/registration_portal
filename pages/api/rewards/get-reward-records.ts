import { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import clientPromise from '../../../lib/mongoclient';
import { verifyClientToken } from '../../../lib/clientTokenMiddleware';
import { verifyRequestSignatureAsync } from '../../../lib/requestSignature.server';
import { isAdminRequest } from '../../../lib/adminCheck';

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
  // Check if user is admin (bypasses all security layers)
  const isAdmin = await isAdminRequest(req);

  if (!isAdmin) {
    // Layer 1: Verify client token
    const tokenVerified = await verifyClientToken(req, res);
    if (!tokenVerified) {
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

    const signatureValid = await verifyRequestSignatureAsync('POST', '/api/rewards/get-reward-records', req.body, Number(timestamp), signature, req);
    if (!signatureValid) {
      res.status(403).json({
        success: false,
        code: 'INVALID_SIGNATURE',
        message: 'Invalid or expired request signature'
      });
      return;
    }
  }

  // Layer 3: Session check
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

    const daysBetween = (a: Date, b: Date): number => {
      const ms = Math.max(0, b.getTime() - a.getTime());
      return Math.min(30, Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24))));
    };
    const weekLabelForRange = (start: Date, end: Date): string => {
      const fmt = (d: Date) => d.toISOString().slice(0, 10);
      return `${fmt(start)} – ${fmt(end)}`;
    };

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
          claimedAt: wr.claimed_at,
          isWeekly: true,
          progressDays: daysBetween(new Date(wr.unlock_at), new Date()),
          etaDate: new Date(new Date(wr.unlock_at).getTime() + 30 * 24 * 60 * 60 * 1000),
          weekLabel: weekLabelForRange(new Date(wr.week_start), new Date(wr.week_end))
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
          claimedAt: dr.claimed_at,
          isWeekly: false,
          progressDays: daysBetween(new Date(dr.created_at), new Date()),
          etaDate: new Date(new Date(dr.created_at).getTime() + 30 * 24 * 60 * 60 * 1000)
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
        claimedAt: dr.claimed_at,
        isWeekly: false,
        progressDays: daysBetween(new Date(dr.created_at), new Date()),
        etaDate: new Date(new Date(dr.created_at).getTime() + 30 * 24 * 60 * 60 * 1000)
      }))
      .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    res.status(200).json({ success: true, records: list });
    return;

  } catch (error) {
    console.error(`Reward Amount: error`);
    res.status(500).json({ message: 'Internal server error' });
  }
}
