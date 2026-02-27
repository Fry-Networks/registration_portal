import { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import clientPromise from '../../../lib/mongoclient';
import rewardsClientPromise from '../../../lib/rewardsMongoClient';
import {
  CommonErrors,
  createApiError,
  ErrorCodes,
  handleApiError,
} from '../../../lib/api-errors';
import { verifyClientToken } from '../../../lib/clientTokenMiddleware';
import { verifyRequestSignatureAsync } from '../../../lib/requestSignature.server';
import { isAdminRequest } from '../../../lib/adminCheck';
import { verifyDeviceFingerprintMiddleware } from '../../../lib/deviceFingerprint';
import { tFRY, fNODE, FRY_1, normalizeAssetId } from '../../../lib/utils';
import {
  getDailyRewardDate,
  isBeforeRewardsCutoff,
  isOnOrAfterRewardsCutoff,
  resolveRewardsCollectionName,
  RewardsDbSource
} from '../../../lib/rewardsDb';

const WEEKLY_FLAG = process.env.NEXT_PUBLIC_WEEKLY_REWARDS_ENABLED === 'true' || process.env.WEEKLY_REWARDS_ENABLED === 'true';
const round2 = (value: number) => Math.round(value * 100) / 100;
const TFryAssetId = String(normalizeAssetId(tFRY.id));
const fNodeAssetId = String(normalizeAssetId(fNODE.id));
const FRY1AssetId = String(normalizeAssetId(FRY_1.id));
const NODE_PREFIXES = new Set(['RDN', 'SVN', 'SDN', 'CN']);
const AEM_PREFIX = 'AEM';

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

    const signatureValid = await verifyRequestSignatureAsync('POST', '/api/rewards/get-reward-summary', req.body, Number(timestamp), signature, req);
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

  const { miner_key } = req.body as GetRewardSummaryData;

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

  try {
    const client = await clientPromise;
    const db = client.db('main');
    // Rewards are split post-cutoff; load the dbrewards client for the current view.
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

    // Pull reward docs from both databases and merge totals post-cutoff.
    const [mainDoc, newDoc] = await Promise.all([
      db.collection(resolveRewardsCollectionName('main', testMode)).findOne({ miner_key }),
      rewardsDb.collection(resolveRewardsCollectionName('dbrewards', testMode)).findOne({ miner_key })
    ]);
    const docs: Array<{ source: RewardsDbSource; doc: any | null }> = [
      { source: 'main', doc: mainDoc },
      { source: 'dbrewards', doc: newDoc }
    ];
    const totals = {
      pending: 0,
      claimable: 0,
      claimed: 0,
      accruing: 0
    };
    let nextUnlockAt: string | null = null;
    let firstRewardAt: string | null = null;
    let firstRewardMs = Number.POSITIVE_INFINITY;
    let legacyFryClaimedSnapshot = 0;

    const devicePrefix = (device?.miner_key || '').split('-')[0] || '';
    const isNodeDevice = NODE_PREFIXES.has(devicePrefix);
    const isAemDevice = devicePrefix === AEM_PREFIX;
    const isMinerDevice = !(isNodeDevice || isAemDevice);
    const allowedAssets = isMinerDevice ? new Set([TFryAssetId, FRY1AssetId]) : new Set([fNodeAssetId]);

    const considerDate = (raw?: string | Date | null) => {
      if (!raw) return;
      const date = raw instanceof Date ? raw : new Date(raw);
      if (Number.isNaN(date.getTime())) return;
      const ms = date.getTime();
      if (ms < firstRewardMs) {
        firstRewardMs = ms;
        firstRewardAt = date.toISOString();
      }
    };

    for (const { source, doc } of docs) {
      if (!doc) continue;
      // Sum totals across both reward databases.
      totals.pending = round2(totals.pending + Number(doc?.total_pending ?? 0));
      totals.claimable = round2(totals.claimable + Number(doc?.total_claimable ?? 0));
      totals.claimed = round2(totals.claimed + Number(doc?.total_claimed ?? 0));
      legacyFryClaimedSnapshot = round2(
        legacyFryClaimedSnapshot + Number(doc?.legacy_fry_claimed_snapshot ?? 0)
      );

      if (Array.isArray(doc.weekly_rewards)) {
        for (const wr of doc.weekly_rewards) {
          considerDate(wr?.unlock_at);
        }
      }

      if (Array.isArray(doc.daily_rewards)) {
        for (const dr of doc.daily_rewards) {
          considerDate(dr?.created_at);
        }
      }

      const { dateStrings, nextUnlockAt: nua } = getCurrentWeekWindow(new Date());
      nextUnlockAt = nua.toISOString();
      if (Array.isArray(doc.daily_rewards)) {
        for (const dr of doc.daily_rewards) {
          const assetKey = String(normalizeAssetId(dr.asset_id));
          if (!allowedAssets.has(assetKey)) {
            continue;
          }
          // Enforce the rewards split when counting accruing amounts.
          const rewardDate = getDailyRewardDate(dr);
          const includeForSource = source === 'main'
            ? isBeforeRewardsCutoff(rewardDate)
            : isOnOrAfterRewardsCutoff(rewardDate);
          if ((dr.status === 'accruing' || dr.status === 'pending') && dateStrings.includes(dr.date) && includeForSource) {
            totals.accruing = round2(totals.accruing + (dr.amount || 0));
          }
        }
      }
    }

    res.status(200).json({
      success: true,
      summary: {
        pending: totals.pending,
        claimable: totals.claimable,
        claimed: totals.claimed,
        accruing: totals.accruing,
        nextUnlockAt,
        firstRewardAt,
        legacyFryClaimedSnapshot
      }
    });
  } catch (error) {
    handleApiError(res, '/api/rewards/get-reward-summary', error, {
      response: createApiError(
        ErrorCodes.INTERNAL_ERROR,
        'Unable to load reward summary',
        'Please refresh the page. If the problem persists, contact support.'
      ),
      minerKey: miner_key,
      walletAddress,
      issueType: 'REWARDS_SUMMARY_ERROR',
      part: 'get-reward-summary.handler',
      metadata: {
        miner_key,
        address: walletAddress,
      },
    });
  }
}
