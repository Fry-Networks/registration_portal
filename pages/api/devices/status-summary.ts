import { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import clientPromise from '../../../lib/mongoclient';
import { computeActiveSetDetailed } from '../../../lib/deviceActivity';

// Lightweight per-wallet device status counts for the home dashboard tile (B2).
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

    const items = await db
      .collection(testMode ? 'test-devices' : 'devices')
      .find({ address: session.user.address })
      .project({ miner_key: 1 })
      .toArray();

    const seen = new Set<string>();
    const minerKeys: string[] = [];
    for (const d of items as any[]) {
      if (!d?.miner_key || seen.has(String(d._id))) continue;
      seen.add(String(d._id));
      minerKeys.push(d.miner_key);
    }

    const { active, degraded } = await computeActiveSetDetailed(client, minerKeys);
    if (degraded) {
      // Reporting 0 online here would be indistinguishable from every miner being
      // offline, so say the status is unknown instead.
      return res.status(503).json({
        success: false,
        code: 'ACTIVITY_UNAVAILABLE',
        message: 'Device status is temporarily unavailable',
        total: minerKeys.length
      });
    }
    return res.status(200).json({
      success: true,
      total: minerKeys.length,
      online: active.size
    });
  } catch (e) {
    console.error('[/api/devices/status-summary] Error:', e);
    return res.status(503).json({
      success: false,
      code: 'ACTIVITY_UNAVAILABLE',
      message: 'Device status is temporarily unavailable'
    });
  }
}
