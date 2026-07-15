import { computeClaimableTotals } from '../../../lib/rewards/effective';
import { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import clientPromise from '../../../lib/mongoclient';
import { FRY_1, fNODE, tFRY, normalizeAssetId } from '../../../lib/utils';
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

const WEEKLY_FLAG = process.env.NEXT_PUBLIC_WEEKLY_REWARDS_ENABLED === 'true' || process.env.WEEKLY_REWARDS_ENABLED === 'true';
const CUTOFF_ISO = process.env.WEEKLY_CUTOFF_UTC || '2025-09-12T00:00:00.000Z';
const CUTOFF_DATE = new Date(CUTOFF_ISO);
const round2 = (value: number) => Math.round(value * 100) / 100;
const DAY_MS = 24 * 60 * 60 * 1000;
const TFryAssetId = String(normalizeAssetId(tFRY.id));
const fNodeAssetId = String(normalizeAssetId(fNODE.id));
const FRY1AssetId = String(normalizeAssetId(FRY_1.id));
const NODE_PREFIXES = new Set(['RDN', 'SVN', 'SDN', 'CN']);
const AEM_PREFIX = 'AEM';
const FEM_PREFIX = 'FEM';

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

type RewardBucket = { pending: number; claimable: number; claimed: number; accruing: number };
const createBucket = (): RewardBucket => ({ pending: 0, claimable: 0, claimed: 0, accruing: 0 });

function formatWeekRangeFromUnlock(unlockAt: Date, weekStart?: Date | string | null, weekEnd?: Date | string | null): string | null {
  const unlock = unlockAt instanceof Date ? unlockAt : new Date(unlockAt);
  if (Number.isNaN(unlock.getTime())) return null;

  const start =
    weekStart && !Number.isNaN(new Date(weekStart).getTime())
      ? new Date(weekStart)
      : new Date(getThisFridayStartUTC(unlock).getTime() - 7 * DAY_MS);
  const end =
    weekEnd && !Number.isNaN(new Date(weekEnd).getTime())
      ? new Date(weekEnd)
      : new Date(start.getTime() + 6 * DAY_MS);

  const fmt = (d: Date) =>
    d.toLocaleDateString('en-US', { month: 'short', day: '2-digit', timeZone: 'UTC' });
  return `${fmt(start)} – ${fmt(end)}`;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
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

    const signatureValid = await verifyRequestSignatureAsync('POST', '/api/rewards/get-asset-totals', req.body, Number(timestamp), signature, req);
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
  if (!session || !session.user) {
    res.status(401).json(CommonErrors.noSession());
    return;
  }
  const walletAddress = session.user.address;

  // Layer 4: Verify device fingerprint to prevent cookie replay from different devices/scripts
  // Admins can use scripts; non-admins must use same browser/device
  const fingerprintStatus = await verifyDeviceFingerprintMiddleware(req, session, isAdmin, { walletAddress: session.user.address, minerKey: 'get-totals' });
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
      message: 'Request originated from a different device or script'
    });
  }

  const testMode = process.env.NEXT_PUBLIC_TEST_MODE === 'true';

  try {
    const client = await clientPromise;
    const db = client.db('main');

    // Get all devices owned by this user
    const devices = await db
      .collection(testMode ? 'test-devices' : 'devices')
      .find({ address: walletAddress })
      .project({ miner_key: 1 })
      .toArray();

    const isMinerDeviceByKey = new Map<string, boolean>();
    for (const device of devices) {
      const key = device?.miner_key;
      if (!key) continue;
      const prefix = key.split('-')[0] || '';
      const isNode = NODE_PREFIXES.has(prefix);
      const isAem = prefix === AEM_PREFIX || prefix === FEM_PREFIX;
      isMinerDeviceByKey.set(key, !(isNode || isAem));
    }

    const minerKeys = devices.map((d: any) => d.miner_key);
    if (minerKeys.length === 0) {
    res.status(200).json({
      success: true,
      totals: {
        fnode: { pending: 0, claimable: 0, claimed: 0, accruing: 0 },
        tfry: { pending: 0, claimable: 0, claimed: 0, accruing: 0 }
      },
      nextUnlockAt: null,
      nextClaimableAt: null,
      legacyFryClaimedSnapshot: 0
    });
      return;
    }

    const devRewards = await db
      .collection('device-rewards')
      .find({ miner_key: { $in: minerKeys } })
      .toArray();

    const fnode = createBucket();
    const tfry = createBucket();
    let legacyFryClaimedSnapshot = 0;
    let nextClaimableAt: Date | null = null;
    let nextClaimableRange: string | null = null;

    const { dateStrings, nextUnlockAt } = getCurrentWeekDates();
    const nowMs = Date.now();

    for (const doc of devRewards) {
      const deviceKey = doc?.miner_key as string | undefined;
      const isMinerDevice = deviceKey ? isMinerDeviceByKey.get(deviceKey) !== false : true;
      const bucket = isMinerDevice ? tfry : fnode;

      bucket.pending = round2(bucket.pending + Number(doc?.total_pending ?? 0));
      bucket.claimable = round2(bucket.claimable + computeClaimableTotals(doc).claimable);
      bucket.claimed = round2(bucket.claimed + Number(doc?.total_claimed ?? 0));

      if (isMinerDevice) {
        legacyFryClaimedSnapshot = round2(
          legacyFryClaimedSnapshot + Number(doc?.legacy_fry_claimed_snapshot ?? 0)
        );
      }

      if (Array.isArray(doc.daily_rewards)) {
        const allowedAssets = isMinerDevice ? new Set([TFryAssetId, FRY1AssetId]) : new Set([fNodeAssetId]);
        for (const dr of doc.daily_rewards) {
          const assetKey = String(normalizeAssetId(dr.asset_id));
          if (!allowedAssets.has(assetKey)) {
            continue;
          }
          if ((dr.status === 'accruing' || dr.status === 'pending') && dateStrings.includes(dr.date)) {
            bucket.accruing = round2(bucket.accruing + (dr.amount || 0));
          }
        }
      }

      if (Array.isArray(doc.weekly_rewards)) {
        for (const wr of doc.weekly_rewards) {
          if (wr?.status !== 'pending' || !wr?.unlock_at) continue;
          const unlockMs = new Date(wr.unlock_at).getTime();
          if (!Number.isFinite(unlockMs)) continue;
          const maturityMs = unlockMs + 30 * DAY_MS;
          if (!Number.isFinite(maturityMs)) continue;
          // Keep the earliest pending → claimable maturity so we can show users when pending clears.
          if (!nextClaimableAt || maturityMs < nextClaimableAt.getTime()) {
            nextClaimableAt = new Date(Math.max(maturityMs, nowMs));
            nextClaimableRange =
              formatWeekRangeFromUnlock(new Date(wr.unlock_at), wr.week_start, wr.week_end) ?? null;
          }
        }
      }
    }

    res.status(200).json({
      success: true,
      totals: {
        fnode,
        tfry
      },
      nextUnlockAt: nextUnlockAt.toISOString(),
      nextClaimableAt: nextClaimableAt ? nextClaimableAt.toISOString() : null,
      pendingWindowLabel: nextClaimableRange,
      legacyFryClaimedSnapshot: round2(legacyFryClaimedSnapshot),
      serverTime: Date.now()
    });
  } catch (error) {
    handleApiError(res, '/api/rewards/get-asset-totals', error, {
      response: createApiError(
        ErrorCodes.INTERNAL_ERROR,
        'Unable to load asset totals',
        'Please refresh the page. If the problem persists, contact support.'
      ),
      walletAddress,
      issueType: 'REWARDS_TOTALS_ERROR',
      part: 'get-asset-totals.handler',
      metadata: {
        address: walletAddress,
      },
    });
  }
}

