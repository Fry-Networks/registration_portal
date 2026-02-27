import { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import clientPromise from '../../../lib/mongoclient';
import rewardsClientPromise from '../../../lib/rewardsMongoClient';
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
import {
  getDailyRewardDate,
  getWeeklyRewardDate,
  isBeforeRewardsCutoff,
  isOnOrAfterRewardsCutoff,
  resolveRewardsCollectionName,
  RewardsDbSource
} from '../../../lib/rewardsDb';

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
  // Normalize test mode flag to a strict boolean for type safety.
  const testMode = process.env.NEXT_PUBLIC_TEST_MODE === 'true';

  if (!session || !session.user) {
    res.status(401).json(CommonErrors.noSession());
    return;
  }
  const walletAddress = session.user.address;

  const { miner_key, status, date, mode } = req.body as GetRewardAmountData;
  if (!miner_key || typeof miner_key !== 'string') {
    res.status(400).json(
      createApiError(
        ErrorCodes.INVALID_INPUT,
        'A miner key is required to view reward records',
        'Please select a device and try again.'
      )
    );
    return;
  }

  // Weekly cutoff still gates weekly vs daily classification (distinct from DB split cutoff).
  const CUTOFF_ISO = process.env.WEEKLY_CUTOFF_UTC || '2025-09-12T00:00:00.000Z';
  const CUTOFF_DATE = new Date(CUTOFF_ISO);

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

  try {
    const client = await clientPromise;
    const db = client.db('main');
    // Rewards are split post-cutoff; pull both databases for merged views.
    const rewardsClient = await rewardsClientPromise;
    const rewardsDb = rewardsClient.db('dbrewards');

    const device = await db
      .collection(testMode ? 'test-devices' : 'devices')
      .findOne({ miner_key });

    if (!device) {
      return res.status(404).json(CommonErrors.deviceNotFound());
    }

    if (device.address && device.address !== walletAddress) {
      res.status(401).json(CommonErrors.walletMismatch());
      return;
    }

    // Load reward docs from both databases and combine them by cutoff.
    const [mainDoc, newDoc] = await Promise.all([
      db.collection(resolveRewardsCollectionName('main', testMode)).findOne({ miner_key }),
      rewardsDb.collection(resolveRewardsCollectionName('dbrewards', testMode)).findOne({ miner_key })
    ]);
    if (!mainDoc && !newDoc) {
      res.status(200).json({ success: true, records: [] });
      return;
    }
    const docs: Array<{ source: RewardsDbSource; doc: any | null }> = [
      { source: 'main', doc: mainDoc },
      { source: 'dbrewards', doc: newDoc }
    ];

    const daysBetween = (a: Date, b: Date): number => {
      const ms = Math.max(0, b.getTime() - a.getTime());
      return Math.min(30, Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24))));
    };
    const weekLabelForRange = (start: Date, end: Date): string => {
      const fmt = (d: Date) => d.toISOString().slice(0, 10);
      return `${fmt(start)} – ${fmt(end)}`;
    };

    if (mode === 'weekly') {
      // Weekly entries (post-cutoff) + daily historical entries (pre-cutoff) across both DBs.
      const weeklyList = docs.flatMap(({ source, doc }) =>
        (doc?.weekly_rewards || [])
          .filter((wr: any) => {
            if (wr.status !== status) return false;
            const rewardDate = getWeeklyRewardDate(wr);
            if (!wr?.unlock_at || !rewardDate) return false;
            const inDbSplit = source === 'main'
              ? isBeforeRewardsCutoff(rewardDate)
              : isOnOrAfterRewardsCutoff(rewardDate);
            // Weekly cutoff remains in effect for weekly records.
            return inDbSplit && rewardDate >= CUTOFF_DATE;
          })
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
            weekLabel: weekLabelForRange(new Date(wr.week_start), new Date(wr.week_end)),
            // Include source metadata so claim/boost can route correctly.
            reward_db: source,
            reward_id: wr?._id ? String(wr._id) : undefined
          }))
      );

      const dailyList = docs.flatMap(({ source, doc }) =>
        (doc?.daily_rewards || [])
          .filter((dr: any) => {
            if (dr.status !== status) return false;
            const rewardDate = getDailyRewardDate(dr);
            // dbrewards does not store daily rewards; keep daily strictly in main pre-cutoff.
            if (source !== 'main') return false;
            const inDbSplit = isBeforeRewardsCutoff(rewardDate);
            return inDbSplit && rewardDate !== null && rewardDate < CUTOFF_DATE;
          })
          .map((dr: any) => ({
            _id: dr._id,
            miner_key,
            no: dr.reward_number,
            status: dr.status,
            asset_id: dr.asset_id,
            amount: dr.amount,
            txId: dr.tx_id,
            // Preserve date fallback when created_at is missing in legacy records.
            createdAt: dr.created_at ?? dr.date,
            claimedAt: dr.claimed_at,
            isWeekly: false,
            progressDays: daysBetween(new Date(dr.created_at ?? dr.date), new Date()),
            etaDate: new Date(new Date(dr.created_at ?? dr.date).getTime() + 30 * 24 * 60 * 60 * 1000),
            // Include source metadata so claim/boost can route correctly.
            reward_db: source,
            reward_id: dr?._id ? String(dr._id) : undefined
          }))
      );

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
    const list = docs.flatMap(({ source, doc }) =>
      (doc?.daily_rewards || [])
        .filter((dr: any) => {
          if (dr.status !== 'accruing' || !dateStrings.includes(dr.date)) return false;
          const rewardDate = getDailyRewardDate(dr);
          // dbrewards does not store daily rewards; keep daily strictly in main pre-cutoff.
          if (source !== 'main') return false;
          const inDbSplit = isBeforeRewardsCutoff(rewardDate);
          return inDbSplit && rewardDate !== null && rewardDate < CUTOFF_DATE;
        })
        .map((dr: any) => ({
          _id: dr._id,
          miner_key,
          no: dr.reward_number,
          status: dr.status,
          asset_id: dr.asset_id,
          amount: dr.amount,
          txId: dr.tx_id,
          // Preserve date fallback when created_at is missing in legacy records.
          createdAt: dr.created_at ?? dr.date,
          claimedAt: dr.claimed_at,
          isWeekly: false,
          progressDays: daysBetween(new Date(dr.created_at ?? dr.date), new Date()),
          etaDate: new Date(new Date(dr.created_at ?? dr.date).getTime() + 30 * 24 * 60 * 60 * 1000),
          // Include source metadata so claim/boost can route correctly.
          reward_db: source,
          reward_id: dr?._id ? String(dr._id) : undefined
        }))
    )
      .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    res.status(200).json({ success: true, records: list });
    return;

  } catch (error) {
    handleApiError(res, '/api/rewards/get-reward-records', error, {
      response: createApiError(
        ErrorCodes.INTERNAL_ERROR,
        'Unable to load reward records',
        'Please refresh the page. If the problem persists, contact support.'
      ),
      minerKey: miner_key,
      walletAddress,
      issueType: 'REWARD_RECORDS_ERROR',
      part: 'get-reward-records.handler',
      metadata: {
        miner_key,
        address: walletAddress,
        status,
        mode,
        date: date instanceof Date ? date.toISOString() : date,
      },
    });
  }
}
