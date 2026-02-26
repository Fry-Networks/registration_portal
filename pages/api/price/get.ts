import { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import { getFRYPrice } from '../../../lib/price';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Require auth to reduce abuse; user session is already required for most pages
  const session = await getServerSession(req, res, authOptions);
  if (!session || !session.user) {
    res.status(401).json({ success: false, code: 'UNAUTHORIZED', message: 'Unauthorized' });
    return;
  }

  try {
    const body = (req.method === 'POST' ? req.body : {}) as { asset_ids?: string[] };
    const assetIds = Array.isArray(body.asset_ids) && body.asset_ids.length > 0
      ? Array.from(new Set(body.asset_ids.map(String)))
      : ['2485314946', '2485202024']; // FRY 2.0, fNODE

    const prices: Record<string, number> = {};
    for (const id of assetIds) {
      try {
        prices[id] = await getFRYPrice(id);
      } catch {
        prices[id] = 0;
      }
    }
    res.status(200).json({ success: true, prices });
  } catch (e) {
    res.status(500).json({ success: false, code: 'NETWORK_ERROR', message: 'Internal server error' });
  }
}
