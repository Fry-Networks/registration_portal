import algosdk from 'algosdk';
import type { NextApiRequest, NextApiResponse } from 'next';
import { V2_APP_ID, readV2Box, readV2TokenRegistry } from '../../../lib/rewards/v2Box';

const ALGOD_URL = process.env.ALGOD_URL || 'https://mainnet-api.algonode.cloud';

interface V2StatusResponse {
  v2Exists: boolean;
  reason?: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<V2StatusResponse>
) {
  const { wallet } = req.query;
  if (!wallet || typeof wallet !== 'string') {
    return res.status(400).json({ v2Exists: false, reason: 'wallet param required' });
  }

  try {
    const algod = new algosdk.Algodv2('', ALGOD_URL, '');

    // Read V2 token registry to get token count
    const registry = await readV2TokenRegistry(algod);
    if (registry.length === 0) {
      return res.status(200).json({ v2Exists: false, reason: 'no_v2_tokens' });
    }

    // Check if wallet has V2 box
    const boxState = await readV2Box(algod, wallet, registry.length);
    if (boxState) {
      return res.status(200).json({ v2Exists: true });
    }

    return res.status(200).json({ v2Exists: false, reason: 'no_v2_box' });
  } catch (err: any) {
    console.error('claim-status-v2 error:', err);
    return res.status(200).json({ v2Exists: false, reason: 'error' });
  }
}
