import { computeClaimableTotals } from '../../../lib/rewards/effective';
import { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import clientPromise from '../../../lib/mongoclient';
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

const WEEKLY_FLAG = process.env.NEXT_PUBLIC_WEEKLY_REWARDS_ENABLED === 'true' || process.env.WEEKLY_REWARDS_ENABLED === 'true';
const CUTOFF_ISO = process.env.WEEKLY_CUTOFF_UTC || '2025-09-12T00:00:00.000Z';
const CUTOFF_DATE = new Date(CUTOFF_ISO);
const round2 = (value: number) => Math.round(value * 100) / 100;
const TFryAssetId = String(normalizeAssetId(tFRY.id));
const fNodeAssetId = String(normalizeAssetId(fNODE.id));
const FRY1AssetId = String(normalizeAssetId(FRY_1.id));
const NODE_PREFIXES = new Set(['RDN', 'SVN', 'SDN', 'CN']);
const AEM_PREFIX = 'AEM';
const FEM_PREFIX = 'FEM';
const MAX_BATCH_SIZE = 200;

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
  const nowUTCms = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours(), now.getUTCMinutes(), now.getUTCSeconds(), now.getUTCMilliseconds());
  const thisUnlock = new Date(thisFridayStart.getTime() + 5 * 60 * 1000);
  const nextUnlockAt = nowUTCms >= thisUnlock.getTime() ? new Date(thisFridayStart.getTime() + 7 * 24 * 60 * 60 * 1000 + 5 * 60 * 1000) : thisUnlock;

  const weekStart = thisFridayStart;
  const dateStrings: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart.getTime() + i * 24 * 60 * 60 * 1000);
    dateStrings.push(formatDateUTC(d));
  }
  return { weekStart, dateStrings, nextUnlockAt };
}

interface SummaryResult {
  pending: number;
  claimable: number;
  claimed: number;
  accruing: number;
  nextUnlockAt: string | null;
  firstRewardAt: string | null;
  legacyFryClaimedSnapshot: number;
  serverTime: number;
}

function computeSummary(doc: any, devicePrefix: string): SummaryResult {
  const isNodeDevice = NODE_PREFIXES.has(devicePrefix);
  const isAemDevice = devicePrefix === AEM_PREFIX || devicePrefix === FEM_PREFIX;
  const allowedAssets = (isNodeDevice || isAemDevice) ? new Set([fNodeAssetId]) : new Set([TFryAssetId, FRY1AssetId]);

  const totals = {
    pending: round2(doc?.total_pending ?? 0),
    claimable: computeClaimableTotals(doc).claimable,
    claimed: round2(doc?.total_claimed ?? 0),
    accruing: 0
  };
  let nextUnlockAt: string | null = null;
  let firstRewardAt: string | null = null;
  let firstRewardMs = Number.POSITIVE_INFINITY;
  const legacyFryClaimedSnapshot = round2(doc?.legacy_fry_claimed_snapshot ?? 0);

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

  if (doc) {
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
        if (!allowedAssets.has(assetKey)) continue;
        if ((dr.status === 'accruing' || dr.status === 'pending') && dateStrings.includes(dr.date)) {
          totals.accruing = round2(totals.accruing + (dr.amount || 0));
        }
      }
    }
  }

  return {
    pending: totals.pending,
    claimable: totals.claimable,
    claimed: totals.claimed,
    accruing: totals.accruing,
    nextUnlockAt,
    firstRewardAt,
    legacyFryClaimedSnapshot,
    serverTime: Date.now()
  };
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  const session = await getServerSession(req, res, authOptions);
  if (session?.user?.address) {
    (req as NextApiRequest & { _sessionWalletAddress?: string })._sessionWalletAddress =
      session.user.address;
  }

  const isAdmin = await isAdminRequest(req);

  if (!isAdmin) {
    const tokenVerified = await verifyClientToken(req, res);
    if (!tokenVerified) return;

    const signature = req.headers['x-request-signature'] as string;
    const timestamp = req.headers['x-request-timestamp'] as string;

    if (!signature || !timestamp) {
      return res.status(403).json({
        success: false,
        code: 'MISSING_SIGNATURE',
        message: 'Request signature or timestamp missing'
      });
    }

    const signatureValid = await verifyRequestSignatureAsync('POST', '/api/rewards/get-reward-summary-batch', req.body, Number(timestamp), signature, req);
    if (!signatureValid) {
      return res.status(403).json({
        success: false,
        code: 'INVALID_SIGNATURE',
        message: 'Invalid or expired request signature'
      });
    }
  }

  const testMode = process.env.NEXT_PUBLIC_TEST_MODE === 'true';

  if (!session || !session.user) {
    return res.status(401).json(CommonErrors.noSession());
  }

  const walletAddress = session.user.address;
  const { miner_keys } = req.body as { miner_keys: string[] };

  if (!Array.isArray(miner_keys) || miner_keys.length === 0) {
    return res.status(400).json({ success: false, message: 'miner_keys must be a non-empty array' });
  }

  if (miner_keys.length > MAX_BATCH_SIZE) {
    return res.status(400).json({ success: false, message: `Maximum ${MAX_BATCH_SIZE} miner keys per batch request` });
  }

  const uniqueKeys = Array.from(new Set(miner_keys.filter(k => typeof k === 'string' && k.length > 0)));

  // Fingerprint check (batch-level, not per-key)
  const fingerprintStatus = await verifyDeviceFingerprintMiddleware(req, session, isAdmin, { walletAddress: session.user.address, minerKey: 'batch' });
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
    const devicesCol = db.collection(testMode ? 'test-devices' : 'devices');
    const devRewardsCol = db.collection('device-rewards');

    // Verify all requested devices belong to this wallet (by address)
    const devices = await devicesCol.find(
      { miner_key: { $in: uniqueKeys } },
      { projection: { miner_key: 1, address: 1, user_id: 1 } }
    ).toArray();

    const ownedKeys = new Set<string>();
    for (const device of devices) {
      const ownedByAddress = Boolean(device.address) && device.address === walletAddress;
      if (!ownedByAddress) continue;
      ownedKeys.add(device.miner_key);
    }

    // Fetch all device-rewards docs in one query
    const rewardDocs = await devRewardsCol.find(
      { miner_key: { $in: Array.from(ownedKeys) } }
    ).toArray();

    const rewardsByKey = new Map<string, any>();
    for (const doc of rewardDocs) {
      rewardsByKey.set(doc.miner_key, doc);
    }

    // Compute summaries
    const summaries: Record<string, SummaryResult> = {};
    for (const key of uniqueKeys) {
      if (!ownedKeys.has(key)) {
        // Device not found or not owned — return empty summary
        summaries[key] = {
          pending: 0, claimable: 0, claimed: 0, accruing: 0,
          nextUnlockAt: null, firstRewardAt: null, legacyFryClaimedSnapshot: 0,
          serverTime: Date.now()
        };
        continue;
      }
      const devicePrefix = key.split('-')[0] || '';
      const doc = rewardsByKey.get(key);
      summaries[key] = computeSummary(doc, devicePrefix);
    }

    return res.status(200).json({ success: true, summaries });
  } catch (error) {
    handleApiError(res, '/api/rewards/get-reward-summary-batch', error, {
      response: createApiError(
        ErrorCodes.INTERNAL_ERROR,
        'Unable to load batch reward summaries',
        'Please refresh the page. If the problem persists, contact support.'
      ),
      walletAddress,
      issueType: 'REWARDS_BATCH_SUMMARY_ERROR',
      part: 'get-reward-summary-batch.handler',
      metadata: {
        batchSize: miner_keys?.length,
        address: walletAddress,
      },
    });
  }
}

