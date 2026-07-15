import { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import clientPromise from '../../../lib/mongoclient';
import { tFRY, fNODE, FRY_1, normalizeAssetId } from '../../../lib/utils';
import { effectiveAmount, isHeld } from '../../../lib/rewards/effective';

// Real per-wallet recent activity for the home dashboard (replaces the
// hardcoded placeholder feed). Sources: weekly reward rows from device-rewards
// plus device registrations. Held rows are excluded — they are not payable.
const MAX_EVENTS = 12;
const MAX_DEVICES = 300;

const ASSET_SYMBOLS: Record<string, string> = {
  [String(normalizeAssetId(tFRY.id))]: 'tFRY',
  [String(normalizeAssetId(fNODE.id))]: 'fNODE',
  [String(normalizeAssetId(FRY_1.id))]: 'FRY 1.0'
};

type ActivityEvent = {
  type: 'reward_unlocked' | 'reward_claimed' | 'registered';
  miner_key: string;
  nickname: string | null;
  amount?: number;
  asset?: string;
  at: string;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.address) {
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }
  const testMode = process.env.NEXT_PUBLIC_TEST_MODE === 'true';
  try {
    const client = await clientPromise;
    const db = client.db('main');

    const devices = await db
      .collection(testMode ? 'test-devices' : 'devices')
      .find({ address: session.user.address })
      .project({ miner_key: 1, nickname: 1, created_at: 1 })
      .limit(MAX_DEVICES)
      .toArray();
    if (devices.length === 0) {
      return res.status(200).json({ success: true, events: [] });
    }

    const nicknameByKey = new Map<string, string | null>();
    for (const d of devices as any[]) {
      if (d?.miner_key) nicknameByKey.set(d.miner_key, d.nickname ?? null);
    }
    const minerKeys = Array.from(nicknameByKey.keys());

    const events: ActivityEvent[] = [];

    for (const d of devices as any[]) {
      if (!d?.miner_key || !d?.created_at) continue;
      const at = new Date(d.created_at);
      if (Number.isNaN(at.getTime())) continue;
      events.push({
        type: 'registered',
        miner_key: d.miner_key,
        nickname: d.nickname ?? null,
        at: at.toISOString()
      });
    }

    const rewardDocs = await db
      .collection('device-rewards')
      .find(
        { miner_key: { $in: minerKeys } },
        { projection: { miner_key: 1, weekly_rewards: 1 } }
      )
      .toArray();

    for (const doc of rewardDocs as any[]) {
      if (!Array.isArray(doc?.weekly_rewards)) continue;
      for (const wr of doc.weekly_rewards) {
        if (isHeld(wr)) continue;
        const assetKey = String(normalizeAssetId(wr?.asset_id));
        const asset = ASSET_SYMBOLS[assetKey] ?? assetKey;
        const amount = Math.round(effectiveAmount(wr) * 100) / 100;
        if (!(amount > 0)) continue;
        if (wr?.status === 'claimed') {
          const at = new Date(wr.claimed_at ?? wr.unlock_at ?? wr.created_at);
          if (Number.isNaN(at.getTime())) continue;
          events.push({
            type: 'reward_claimed',
            miner_key: doc.miner_key,
            nickname: nicknameByKey.get(doc.miner_key) ?? null,
            amount,
            asset,
            at: at.toISOString()
          });
        } else if (wr?.status === 'claimable' || wr?.status === 'pending') {
          const at = new Date(wr.unlock_at ?? wr.created_at);
          if (Number.isNaN(at.getTime())) continue;
          events.push({
            type: 'reward_unlocked',
            miner_key: doc.miner_key,
            nickname: nicknameByKey.get(doc.miner_key) ?? null,
            amount,
            asset,
            at: at.toISOString()
          });
        }
      }
    }

    events.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    return res.status(200).json({ success: true, events: events.slice(0, MAX_EVENTS) });
  } catch (e) {
    console.error('[/api/activity/recent] Error:', e);
    return res.status(200).json({ success: true, events: [] });
  }
}
