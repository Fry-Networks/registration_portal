import { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import clientPromise from '../../../lib/mongoclient';
import { computeGatedTotals, isDeviceAGateExempt } from '../../../lib/rewards/effective';
import { loadEvidenceBatch } from '../../../lib/rewards/pocEvidence';

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
      .find({ address: walletAddress }, { projection: { miner_key: 1, virtual: 1, activated: 1 } })
      .toArray();

    if (devices.length === 0) {
      return res.status(200).json({
        success: true,
        summary: { claimable: 0, held: 0, pendingEvidence: 0, pending: 0, accruing: 0 }
      });
    }

    const minerKeys = devices.map((d: any) => d.miner_key);
    const exemptByKey = new Map<string, boolean>(
      devices.map((d: any) => [String(d.miner_key), isDeviceAGateExempt(d)])
    );

    // Truthful claimable: computed from row statuses with corrected amounts, held rows
    // excluded, and the claim path's PoC A-gate applied — mirrors exactly what
    // /api/rewards/claim will pay. (total_claimable is a stale precomputed field that predates
    // the F3-y correction pass and includes held rows.)
    //
    // These docs are read whole on purpose. The previous projection listed hold flags for
    // weekly_rewards only, so every held daily row read back as unheld and was counted as
    // claimable — and it also dropped corrected_amount for daily rows, so held daily value was
    // reported at the pre-correction amount.
    const rewardDocs = await db.collection('device-rewards')
      .find({ miner_key: { $in: minerKeys } })
      .toArray();

    const evidenceByKey = await loadEvidenceBatch(client, minerKeys);

    let claimable = 0;
    let held = 0;
    let pendingEvidence = 0;
    // Not-yet-claimable value, so the home tile can say why the claimable figure is 0:
    // weekly rows maturing (unlock_at + 30d) and daily rows still accruing this week.
    let pending = 0;
    let accruing = 0;
    const rowAmount = (r: any): number => (typeof r?.corrected_amount === 'number' ? r.corrected_amount : Number(r?.amount ?? 0));
    for (const doc of rewardDocs) {
      const key = String((doc as any)?.miner_key ?? '');
      const totals = computeGatedTotals(
        doc,
        evidenceByKey.get(key),
        exemptByKey.get(key) === true
      );
      claimable += totals.claimable;
      held += totals.held;
      pendingEvidence += totals.pendingEvidence;
      for (const r of ((doc as any)?.weekly_rewards || []).concat((doc as any)?.daily_rewards || [])) {
        if (r?.status === 'pending') pending += rowAmount(r);
        else if (r?.status === 'accruing') accruing += rowAmount(r);
      }
    }

    return res.status(200).json({
      success: true,
      summary: {
        claimable: round2(claimable),
        held: round2(held),
        pendingEvidence: round2(pendingEvidence),
        pending: round2(pending),
        accruing: round2(accruing)
      }
    });
  } catch (error) {
    console.error('[/api/rewards/summary] Error:', error);
    // Reporting 0 as a successful total made a lookup failure indistinguishable from a genuinely
    // empty balance. Surface the failure so the caller can show "couldn't load" instead of "0".
    return res.status(500).json({
      success: false,
      code: 'INTERNAL_ERROR',
      message: 'Unable to load reward summary'
    });
  }
}
