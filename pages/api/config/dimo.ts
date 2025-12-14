import type { NextApiRequest, NextApiResponse } from 'next';
import { getConfigFlag } from '../../../lib/config';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  // Prevent caches from pinning the toggle so ops can flip the switch instantly.
  res.setHeader('Cache-Control', 'no-store');
  const enabled = await getConfigFlag('dimo_enabled', true);
  return res.status(200).json({ success: true, enabled });
}
