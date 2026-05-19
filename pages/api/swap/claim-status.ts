/**
 * GET /api/swap/claim-status?wallet=<address>
 *
 * Returns claimable settlement certificates for a wallet.
 * Frontend polls this to show claim UI.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { getClaimableByWallet } from '../../../lib/swap/guaranteeStore';
import { getVaultAppId } from '../../../lib/swap/guaranteeConfig';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const wallet = typeof req.query.wallet === 'string' ? req.query.wallet : '';
  if (!wallet || wallet.length < 58) {
    return res.status(400).json({ success: false, error: 'Valid wallet address required' });
  }

  try {
    const outcomes = await getClaimableByWallet(wallet);
    const claimable = outcomes.map(o => ({
      quoteId: o.quoteId,
      orderHash: o.certificateOrderHash,
      amount: o.settlementAmount,
      assetId: o.outputAsset,
      vaultAppId: getVaultAppId(),
    }));

    return res.status(200).json({ success: true, claimable });
  } catch (err: any) {
    console.error('[swap/claim-status]', err);
    return res.status(500).json({ success: false, error: 'Failed to check claim status' });
  }
}
