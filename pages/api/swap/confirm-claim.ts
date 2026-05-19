/**
 * POST /api/swap/confirm-claim
 *
 * Frontend calls after successful on-chain claim to update MongoDB.
 * Keeps DB in sync with on-chain state.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { markClaimed, getOutcomeByQuoteId } from '../../../lib/swap/guaranteeStore';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { quoteId, claimTxId } = req.body;
  if (!quoteId || typeof quoteId !== 'string') {
    return res.status(400).json({ success: false, error: 'quoteId required' });
  }
  if (!claimTxId || typeof claimTxId !== 'string') {
    return res.status(400).json({ success: false, error: 'claimTxId required' });
  }

  try {
    const outcome = await getOutcomeByQuoteId(quoteId);
    if (!outcome) {
      return res.status(404).json({ success: false, error: 'outcome_not_found' });
    }
    if (outcome.settlementStatus !== 'claimable') {
      return res.status(200).json({ success: true, confirmed: false, reason: 'not_claimable' });
    }

    await markClaimed(quoteId, claimTxId);
    return res.status(200).json({ success: true, confirmed: true });
  } catch (err: any) {
    console.error('[swap/confirm-claim]', err);
    return res.status(500).json({ success: false, error: 'Failed to confirm claim' });
  }
}
