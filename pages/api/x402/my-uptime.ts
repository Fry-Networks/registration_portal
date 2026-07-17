import type { NextApiRequest, NextApiResponse } from 'next';
import clientPromise from '../../../lib/mongoclient';
import { computeActiveSet } from '../../../lib/deviceActivity';
import { trustedPayer } from '../../../lib/x402/payerTrust';
import { ownershipQuery, devicesCollectionName } from '../../../lib/x402/ownership';

// Payer-scoped uptime/PoC summary. Mirrors devices/status-summary.ts (computeActiveSet).
// Zero owned devices -> empty-but-valid 200 (total 0, online 0).
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const payer = trustedPayer(req);
  if (!payer) return res.status(403).json({ success: false, code: 'FORBIDDEN' });
  try {
    const client = await clientPromise;
    const db = client.db('main');
    const query = await ownershipQuery(db, payer);
    const items = await db.collection(devicesCollectionName()).find(query).project({ miner_key: 1 }).toArray();
    const seen = new Set<string>();
    const minerKeys: string[] = [];
    for (const d of items as any[]) {
      if (!d?.miner_key || seen.has(String(d._id))) continue;
      seen.add(String(d._id));
      minerKeys.push(d.miner_key);
    }
    const activeSet = await computeActiveSet(client, minerKeys);
    return res.status(200).json({ success: true, payer, total: minerKeys.length, online: activeSet.size });
  } catch {
    return res.status(502).json({ success: false, code: 'DATA_ERROR' });
  }
}
