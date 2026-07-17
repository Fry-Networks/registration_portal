import type { NextApiRequest, NextApiResponse } from 'next';
import clientPromise from '../../../lib/mongoclient';
import { computeClaimableTotals } from '../../../lib/rewards/effective';
import { trustedPayer } from '../../../lib/x402/payerTrust';
import { ownershipQuery, devicesCollectionName } from '../../../lib/x402/ownership';

// Payer-scoped reward summary. Sums computeClaimableTotals() over the payer's owned
// devices' device-rewards docs (corrected_amount only; payout_hold/ghost_device excluded
// inside computeClaimableTotals via isHeld). Token resolved per-request from configs.reward_mode.
// Zero owned devices -> empty-but-valid 200.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const payer = trustedPayer(req);
  if (!payer) return res.status(403).json({ success: false, code: 'FORBIDDEN' });
  try {
    const db = (await clientPromise).db('main');

    // Live token identity (no hardcoded ASA beyond the app's own FRY2 fallback).
    const modeDoc = await db.collection('configs').findOne({ _id: 'reward_mode' } as any);
    const mode = (modeDoc as any)?.mode || 'FRY2';
    const activeFryAsaId = mode === 'FRY3' ? ((modeDoc as any)?.fry3_asa_id || '3612979527') : '2485314946';
    const activeFryName = mode === 'FRY3' ? 'FRY' : 'FRY 2.0';

    const query = await ownershipQuery(db, payer);
    const owned = await db.collection(devicesCollectionName()).find(query).project({ miner_key: 1 }).toArray();
    const minerKeys = Array.from(new Set(owned.map((d: any) => d.miner_key).filter(Boolean)));

    let claimable = 0;
    let held = 0;
    if (minerKeys.length) {
      const rewardsCol = db.collection('device-rewards');
      const docs = await rewardsCol.find({ miner_key: { $in: minerKeys } }).toArray();
      for (const doc of docs) {
        const t = computeClaimableTotals(doc);
        claimable += t.claimable;
        held += t.held;
      }
    }
    const round2 = (n: number) => Math.round(n * 100) / 100;
    return res.status(200).json({
      success: true,
      payer,
      token: { mode, asa_id: activeFryAsaId, name: activeFryName },
      device_count: minerKeys.length,
      claimable: round2(claimable),
      held: round2(held),
    });
  } catch {
    return res.status(502).json({ success: false, code: 'DATA_ERROR' });
  }
}
