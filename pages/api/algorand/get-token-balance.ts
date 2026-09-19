import { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import { getAssetBalance } from '../../../lib/algorand/balances';
import { createApiError, ErrorCodes } from '../../../lib/api-errors';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const session = await getServerSession(req, res, authOptions);
  // Check if user is authenticated  
  if (!session || !session.user) {
    res.status(401).json({ message: 'Unauthorized' });
    return;
  }

  const { address, asset_id } = req.body as {
    address?: string;
    asset_id?: string;
  };

  if (!address || !asset_id) {
    res.status(400).json({ message: 'Invalid input param' });
    return;
  }

  let balance: number | null;
  try {
    balance = await getAssetBalance(address, asset_id);
  } catch (err) {
    console.error('[get-token-balance] balance check failed', err);
    return res.status(503).json(
      createApiError(
        ErrorCodes.NETWORK_ERROR,
        'Could not verify on-chain balance',
        'Please try again in a few minutes.'
      )
    );
  }

  if (balance === null) {
    res
      .status(200)
      .json({ success: false, message: 'No asset_id opted-in the wallet' });
    return;
  }

  res.status(200).json({ success: true, balance });
}
