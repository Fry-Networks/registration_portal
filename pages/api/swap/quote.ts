import type { NextApiRequest, NextApiResponse } from 'next';
import { getVestigeQuote } from '../../../lib/swap/fryfarmAdapter';
import { isSourceAssetAllowed, isTargetTokenSupported } from '../../../lib/swap/allowlist';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { fromASA, toASA, amount } = req.method === 'GET' ? req.query : req.body;

  const fromId = Number(fromASA);
  const toId = Number(toASA);
  const amt = Number(amount);

  if (!Number.isFinite(fromId) || !Number.isFinite(toId) || !Number.isFinite(amt) || amt <= 0) {
    return res.status(400).json({ success: false, error: 'Invalid parameters' });
  }

  if (!isSourceAssetAllowed(fromId)) {
    return res.status(400).json({ success: false, error: 'Source asset not allowed' });
  }

  if (!isTargetTokenSupported(toId)) {
    return res.status(400).json({ success: false, error: 'Target token not supported' });
  }

  try {
    const quote = await getVestigeQuote(fromId, toId, amt);
    return res.status(200).json({ success: true, quote });
  } catch (err: any) {
    console.error('[swap/quote]', err);
    return res.status(500).json({ success: false, error: err.message || 'Quote failed' });
  }
}
