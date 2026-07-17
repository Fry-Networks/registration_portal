import type { NextApiRequest, NextApiResponse } from 'next';
import clientPromise from '../../../lib/mongoclient';
import { trustedPayer } from '../../../lib/x402/payerTrust';
import { ownershipQuery, devicesCollectionName } from '../../../lib/x402/ownership';

// Payer-scoped single-device detail. Returns the device ONLY if the payer owns it.
// A device the payer does not own -> 404, IDENTICAL to a nonexistent key: never a 403
// that confirms existence, never any field of another owner's device.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const payer = trustedPayer(req);
  if (!payer) return res.status(403).json({ success: false, code: 'FORBIDDEN' });

  const raw = req.query.miner_key;
  const miner_key = (Array.isArray(raw) ? raw[0] : raw || '').trim();
  if (!miner_key) return res.status(400).json({ success: false, code: 'INVALID_INPUT' });

  try {
    const db = (await clientPromise).db('main');
    const ownership = await ownershipQuery(db, payer);
    // Ownership AND key must both match, else indistinguishable 404.
    const doc: any = await db.collection(devicesCollectionName()).findOne(
      { $and: [{ miner_key }, ownership] },
      {
        projection: {
          miner_key: 1, nickname: 1, is_registered: 1, virtual: 1, activated: 1, verified: 1,
          staked: 1, legacy_stake_unlocked: 1, byod: 1, node: 1, created_at: 1, reward_wallet: 1,
        },
      }
    );
    if (!doc) return res.status(404).json({ success: false, code: 'NOT_FOUND' });

    return res.status(200).json({
      success: true,
      payer,
      device: {
        miner_key: doc.miner_key,
        nickname: doc.nickname ?? null,
        is_registered: Boolean(doc.is_registered),
        virtual: Boolean(doc.virtual),
        activated: Boolean(doc.activated),
        verified: Boolean(doc.verified),
        staked: Boolean(doc.staked),
        legacy_stake_unlocked: Boolean(doc.legacy_stake_unlocked),
        byod: Boolean(doc.byod),
        node: Boolean(doc.node),
        created_at: doc.created_at ?? null,
        reward_wallet: doc.reward_wallet ?? null,
      },
    });
  } catch {
    return res.status(502).json({ success: false, code: 'DATA_ERROR' });
  }
}
