import { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import clientPromise from '../../../lib/mongoclient';
import { computeClaimableTotals } from '../../../lib/rewards/effective';

const round2 = (v: number) => Math.round(v * 100) / 100;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.address) {
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }

  try {
    const client = await clientPromise;
    const db = client.db('main');
    const walletAddress = session.user.address;

    // 2-step join: devices.address → miner_keys → device-rewards
    const devices = await db.collection('devices')
      .find({ address: walletAddress }, { projection: { miner_key: 1 } })
      .toArray();

    if (devices.length === 0) {
      return res.status(200).json({ success: true, summary: { claimable: 0 } });
    }

    const minerKeys = devices.map((d: any) => d.miner_key);
    // Truthful claimable: computed from row statuses with corrected amounts and
    // held rows excluded — mirrors exactly what the weekly publisher will pay.
    // (total_claimable is a stale precomputed field that predates the F3-y
    // correction pass and includes held rows.)
    const rewardDocs = await db.collection('device-rewards')
      .find(
        { miner_key: { $in: minerKeys } },
        {
          projection: {
            'weekly_rewards.status': 1,
            'weekly_rewards.amount': 1,
            'weekly_rewards.corrected_amount': 1,
            'weekly_rewards.payout_hold': 1,
            'weekly_rewards.ghost_device': 1,
            'weekly_rewards.evidence_unavailable': 1,
            'daily_rewards.status': 1,
            'daily_rewards.amount': 1
          }
        }
      )
      .toArray();

    const claimable = round2(
      rewardDocs.reduce((sum: number, doc: any) => sum + computeClaimableTotals(doc).claimable, 0)
    );

    return res.status(200).json({ success: true, summary: { claimable } });
  } catch (error) {
    console.error('[/api/rewards/summary] Error:', error);
    return res.status(200).json({ success: true, summary: { claimable: 0 } });
  }
}
