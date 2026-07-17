import type { NextApiRequest, NextApiResponse } from 'next';
import clientPromise from '../../../lib/mongoclient';
import { trustedPayer } from '../../../lib/x402/payerTrust';
import { ownershipQuery, devicesCollectionName } from '../../../lib/x402/ownership';

// Payer-scoped device list. Mirrors devices/list.ts projection+status but owner = the
// facilitator-verified payer (set by the sidecar). Zero owned devices -> empty 200.
// Safe projection: never returns connectivity_wallet (mnemonic) or IP/geo/internal fields.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const payer = trustedPayer(req);
  if (!payer) return res.status(403).json({ success: false, code: 'FORBIDDEN' });
  try {
    const db = (await clientPromise).db('main');
    const products = await db.collection('products').find({}).project({ key: 1, name: 1 }).toArray();
    const productMap = new Map<string, string>();
    products.forEach((p: any) => { if (p?.key && p?.name) productMap.set(String(p.key), String(p.name)); });

    const query = await ownershipQuery(db, payer);
    const items = await db.collection(devicesCollectionName()).find(query)
      .project({
        miner_key: 1, nickname: 1, user_id: 1, is_registered: 1, virtual: 1, activated: 1,
        verified: 1, staked: 1, legacy_stake_unlocked: 1, byod: 1, node: 1, address: 1,
      })
      .sort({ miner_key: 1 }).toArray();

    const seen = new Set<string>();
    const deduped = items.filter((d: any) => {
      const k = String(d._id); if (seen.has(k)) return false; seen.add(k); return true;
    });

    const status = (d: any): string => {
      if (d.virtual && !d.activated) return 'pending';
      if (!d.is_registered && !d.virtual) return 'unregistered';
      if (d.legacy_stake_unlocked || (d.user_id && !d.address)) return 'migrated';
      if (d.is_registered && (d.verified || d.staked)) return 'active';
      if (d.virtual && d.activated) return 'active';
      if (d.is_registered) return 'active';
      return 'pending';
    };

    const devices = deduped.map((d: any) => ({
      miner_key: d.miner_key,
      nickname: d.nickname ?? null,
      productName: productMap.get(String(d.miner_key || '').split('-')[0] ?? '') ?? null,
      status: status(d),
      is_registered: Boolean(d.is_registered),
      virtual: Boolean(d.virtual),
      activated: Boolean(d.activated),
      verified: Boolean(d.verified),
      staked: Boolean(d.staked),
      byod: Boolean(d.byod),
      node: Boolean(d.node),
    }));

    return res.status(200).json({ success: true, payer, count: devices.length, devices });
  } catch {
    return res.status(502).json({ success: false, code: 'DATA_ERROR' });
  }
}
