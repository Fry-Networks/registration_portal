import { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import clientPromise from '../../../lib/mongoclient';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions);
  if (!session || !session.user) {
    res.status(401).json({ success: false, code: 'UNAUTHORIZED', message: 'Unauthorized' });
    return;
  }
  const testMode = process.env.NEXT_PUBLIC_TEST_MODE === 'true';
  try {
    const client = await clientPromise;
    const db = client.db('main');
    // Preload product names to avoid per-device roundtrips.
    const products = await db.collection('products').find({}).project({ key: 1, name: 1 }).toArray();
    const productMap = new Map<string, string>();
    products.forEach((p: any) => {
      if (p?.key && p?.name) productMap.set(String(p.key), String(p.name));
    });

    // Resolve user _id for user_id fallback (matches my-keys.ts pattern).
    // user_id stored as ObjectId in devices collection (sampled 2026-07-04).
    // Defensive: query with both ObjectId and string forms to cover both storage types.
    const userDoc = await db.collection('registration-users').findOne(
      { address: session.user.address },
      { projection: { _id: 1 } }
    );
    const userIdString = userDoc?._id?.toString();
    const userObjectId = userDoc?._id;

    // Ownership clauses: address match OR user_id match (ObjectId + string defensive).
    const ownershipClauses: any[] = [{ address: session.user.address }];
    if (userObjectId) ownershipClauses.push({ user_id: userObjectId });
    if (userIdString && userIdString !== userObjectId?.toString()) ownershipClauses.push({ user_id: userIdString });
    const query = { $or: ownershipClauses };

    // Explicit inclusion projection — NEVER project connectivity_wallet (mnemonic secret).
    const cursor = db.collection(testMode ? 'test-devices' : 'devices')
      .find(query)
      .project({
        miner_key: 1, nickname: 1, user_id: 1,
        is_registered: 1, virtual: 1, activated: 1, verified: 1,
        staked: 1, legacy_stake_unlocked: 1, byod: 1, node: 1, note: 1,
        address: 1, reward_wallet: 1, created_at: 1, name: 1
      })
      .sort({ miner_key: 1 });
    const items = await cursor.toArray();

    // Dedup by _id (same device may match both address and user_id clauses).
    const seen = new Set<string>();
    const deduped = items.filter((d: any) => {
      const k = String(d._id);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    const deriveStatusLabel = (d: any): string => {
      if (d.virtual && !d.activated) return 'pending';
      if (!d.is_registered && !d.virtual) return 'unregistered';
      if (d.legacy_stake_unlocked || (d.user_id && !d.address)) return 'migrated';
      if (d.is_registered && (d.verified || d.staked)) return 'active';
      if (d.virtual && d.activated) return 'active';
      if (d.is_registered) return 'active';
      return 'pending';
    };

    const miner_keys = deduped.map((d: any) => ({
      miner_key: d.miner_key,
      nickname: d.nickname ?? null,
      productName: productMap.get(String(d.miner_key || '').split('-')[0] ?? '') ?? null,
      status: deriveStatusLabel(d),
      is_registered: Boolean(d.is_registered),
      virtual: Boolean(d.virtual),
      activated: Boolean(d.activated),
      verified: Boolean(d.verified),
      staked: Boolean(d.staked),
      legacy_stake_unlocked: Boolean(d.legacy_stake_unlocked),
      byod: Boolean(d.byod),
      node: Boolean(d.node)
    }));
    res.status(200).json({ success: true, miner_keys });
  } catch (e) {
    res.status(500).json({ success: false, code: 'NETWORK_ERROR', message: 'Internal server error' });
  }
}