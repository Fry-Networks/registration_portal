import { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import clientPromise from '../../../lib/mongoclient';
import { getFRYPrice } from '../../../lib/price';
import { verifyClientToken } from '../../../lib/clientTokenMiddleware';
import { verifyRequestSignatureAsync } from '../../../lib/requestSignature.server';
import { isAdminRequest } from '../../../lib/adminCheck';
import { verifyDeviceFingerprintMiddleware } from '../../../lib/deviceFingerprint';
import {
  CommonErrors,
  createApiError,
  ErrorCodes,
  handleApiError,
} from '../../../lib/api-errors';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const session = await getServerSession(req, res, authOptions);
  if (session?.user?.address) {
    (req as NextApiRequest & { _sessionWalletAddress?: string })._sessionWalletAddress =
      session.user.address;
  }

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

    const signatureValid = await verifyRequestSignatureAsync('POST', '/api/rewards/get-rewards-page', req.body, Number(timestamp), signature, req);
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

  if (!session || !session.user) {
    res.status(401).json(CommonErrors.noSession());
    return;
  }
  const walletAddress = session.user.address;

  const { miner_key, page = 1 } = req.body as {
    miner_key: string;
    page?: number;
  };

  // Layer 4: Verify device fingerprint to prevent cookie replay from different devices/scripts
  // Admins can use scripts; non-admins must use same browser/device
  const fingerprintStatus = await verifyDeviceFingerprintMiddleware(req, session, isAdmin, { walletAddress: session.user.address, minerKey: miner_key });
  if (fingerprintStatus === 'retry') {
    return res.status(409).json({
      success: false,
      code: 'DEVICE_FINGERPRINT_REFRESH',
      message: 'Security check refreshed your session. Please retry the request.'
    });
  }
  if (fingerprintStatus === 'blocked') {
    return res.status(403).json({
      success: false,
      code: 'DEVICE_MISMATCH',
      message: 'Request originated from different device or script'
    });
  }
  const CUTOFF_ISO = process.env.WEEKLY_CUTOFF_UTC || '2025-09-12T00:00:00.000Z';
  const CUTOFF_DATE = new Date(CUTOFF_ISO);

  if (!miner_key || typeof miner_key !== 'string') {
    res.status(400).json(
      createApiError(
        ErrorCodes.INVALID_INPUT,
        'A miner key is required to view reward history',
        'Please select a device and try again.'
      )
    );
    return;
  }

  const pageSize = 10;

  try {
    const client = await clientPromise;
    const db = client.db('main');

    const device = await db
      .collection(testMode ? 'test-devices' : 'devices')
      .findOne({ miner_key });
    if (!device) {
      res.status(404).json(CommonErrors.deviceNotFound());
      return;
    }
    if (device.address && device.address !== walletAddress) {
      res.status(401).json(CommonErrors.walletMismatch());
      return;
    }

    // Always use device-rewards as source of truth; legacy collections are deprecated
    const devRewardsCol = db.collection('device-rewards');
    const doc = await devRewardsCol.findOne({ miner_key });
    if (!doc) {
      // Strict device-rewards only: if no doc, return empty dataset
      res.status(200).json({ success: true, items: [], totalPages: 1, weeklyCount: 0, dailyCount: 0, totalCount: 0 });
      return;
    }
    const daysBetween = (a: Date, b: Date): number => {
      const ms = Math.max(0, b.getTime() - a.getTime());
      return Math.min(30, Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24))));
    };

    const dayMs = 24 * 60 * 60 * 1000;
    const formatRange = (start: Date, end: Date): string => {
      const fmt = (d: Date) =>
        d.toLocaleDateString('en-US', { month: 'short', day: '2-digit', timeZone: 'UTC' });
      return `${fmt(start)} – ${fmt(end)}`;
    };
    const getThisFridayStartUTC = (ref: Date): Date => {
      const d = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate(), 0, 0, 0, 0));
      const day = d.getUTCDay();
      const diffToFriday = (day + 7 - 5) % 7;
      d.setUTCDate(d.getUTCDate() - diffToFriday);
      return d;
    };

    const weekly = (doc?.weekly_rewards || [])
      .filter((wr: any) => wr.unlock_at && new Date(wr.unlock_at) >= CUTOFF_DATE)
      .map((wr: any) => ({
        _id: wr._id,
        miner_key,
        no: wr.reward_number,
        status: wr.status,
        asset_id: wr.asset_id,
        amount: typeof wr.corrected_amount === 'number' ? wr.corrected_amount : wr.amount,
        originalAmount: wr.amount,
        onHold: wr.payout_hold === true || wr.ghost_device === true || wr.evidence_unavailable === true,
        txId: wr.tx_id,
        createdAt: wr.unlock_at,
        claimedAt: wr.claimed_at,
        // derived fields for UI
        isWeekly: true,
        progressDays: daysBetween(new Date(wr.unlock_at), new Date()),
        etaDate: new Date(new Date(wr.unlock_at).getTime() + 30 * dayMs),
        weekLabel: (() => {
          const wkStart = wr.week_start ? new Date(wr.week_start) : new Date(getThisFridayStartUTC(new Date(wr.unlock_at)).getTime() - 7 * dayMs);
          const wkEnd = wr.week_end ? new Date(wr.week_end) : new Date(wkStart.getTime() + 6 * dayMs);
          return formatRange(wkStart, wkEnd);
        })()
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
        claimedAt: dr.claimed_at,
        // derived fields for UI
        isWeekly: false,
        progressDays: daysBetween(new Date(dr.created_at), new Date()),
        etaDate: new Date(new Date(dr.created_at).getTime() + 30 * dayMs)
      }));

    const weeklyCount = weekly.length;
    const dailyCount = daily.length;
    const all = weekly.concat(daily)
      .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const total = all.length;
    const totalPages = Math.ceil(total / pageSize) || 1;
    const start = (Number(page) - 1) * pageSize;
    const items = all.slice(start, start + pageSize);

    // Attach fiatValue using cached prices per asset for this page only.
    const priceCache: Record<string, { ts: number; usd: number }> = {};
    const nowTs = Date.now();
    const TTL = 5 * 60 * 1000; // 5 minutes
    const uniqueAssetIds: string[] = Array.from(new Set<string>(items.map((it: any) => String(it.asset_id))));
    for (const aid of uniqueAssetIds) {
      try {
        // Basic in-function cache; in real app consider process-level memo
        if (!priceCache[aid] || (nowTs - priceCache[aid].ts) > TTL) {
          const p = await getFRYPrice(aid);
          priceCache[aid] = { ts: nowTs, usd: Number(p || 0) };
        }
      } catch {
        priceCache[aid] = { ts: nowTs, usd: 0 };
      }
    }
    const itemsWithFiat = items.map((it: any) => ({
      ...it,
      fiatValue: priceCache[it.asset_id]?.usd ? Number(it.amount || 0) * priceCache[it.asset_id].usd : undefined
    }));

    res.status(200).json({ success: true, items: itemsWithFiat, totalPages, weeklyCount, dailyCount, totalCount: total,
      serverTime: Date.now()
    });
  } catch (error) {
    handleApiError(res, '/api/rewards/get-rewards-page', error, {
      response: createApiError(
        ErrorCodes.INTERNAL_ERROR,
        'Unable to load reward history',
        'Please refresh the page. If the problem persists, contact support.'
      ),
      minerKey: miner_key,
      walletAddress,
      issueType: 'REWARDS_HISTORY_ERROR',
      part: 'get-rewards-page.handler',
      metadata: {
        miner_key,
        address: walletAddress,
        page,
      },
    });
  }
}
