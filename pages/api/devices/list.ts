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

    const cursor = db.collection(testMode ? 'test-devices' : 'devices')
      .find({ address: session.user.address })
      // Include friendly labels so the UI can show nicknames alongside miner keys.
      .project({ miner_key: 1, nickname: 1 })
      .sort({ miner_key: 1 });
    const items = await cursor.toArray();
    const miner_keys = items.map((d: any) => ({
      miner_key: d.miner_key,
      nickname: d.nickname ?? null,
      productName: productMap.get(String(d.miner_key || '').split('-')[0] ?? '') ?? null
    }));
    res.status(200).json({ success: true, miner_keys });
  } catch (e) {
    res.status(500).json({ success: false, code: 'NETWORK_ERROR', message: 'Internal server error' });
  }
}
