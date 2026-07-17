import type { NextApiRequest, NextApiResponse } from 'next';
import clientPromise from '../../../../lib/mongoclient';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const client = await clientPromise;
    const db = client.db('main');

    // Resolve active token name for labelling (token-version agnostic:
    // names come from admin config, never hardcoded per-token logic)
    const rewardModeDoc = await db.collection('configs').findOne({ _id: 'reward_mode' } as any);
    const mode = rewardModeDoc?.mode || 'FRY2';
    const fry3AsaId = String(rewardModeDoc?.fry3_asa_id || '3612979527');
    const activeAsaId = mode === 'FRY3' ? fry3AsaId : '2485314946';
    const activeName = mode === 'FRY3' ? 'FRY' : 'FRY 2.0';

    const docs = await db
      .collection('fry_fee_genesis_distributions')
      .find({})
      .sort({ distributed_at: -1 })
      .limit(100)
      .toArray();

    const distributions = docs.map((doc: any) => {
      const assetId = doc.asset_id;
      return {
        distributed_at: doc.distributed_at,
        // dbRewards ffg-distribute doc shape: total_amount (micro), per_pass,
        // holder_count, txids[]
        amount: Number(doc.total_amount ?? doc.amount ?? 0) / 1e6,
        asset_id: assetId ?? null,
        token:
          assetId !== undefined && String(assetId) === activeAsaId
            ? activeName
            : assetId !== undefined
              ? `ASA ${assetId}`
              : '',
        per_pass: doc.per_pass !== undefined ? Number(doc.per_pass) / 1e6 : undefined,
        holder_count: doc.holder_count,
        txn_id: (Array.isArray(doc.txids) && doc.txids[0]) || doc.txn_id,
        txn_count: Array.isArray(doc.txids) ? doc.txids.length : undefined,
      };
    });

    return res.status(200).json({ distributions });
  } catch (err: any) {
    console.error('Genesis distributions fetch error:', err);
    return res.status(200).json({ distributions: [] });
  }
}
