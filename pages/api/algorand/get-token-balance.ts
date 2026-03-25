import { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import { getAssetBalance } from '../../../lib/algorand/balances';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  try {
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

    const balance = await getAssetBalance(address, asset_id);

    if (balance === null) {
      res
        .status(200)
        .json({ success: false, message: 'No asset_id opted-in the wallet' });
      return;
    }

    res.status(200).json({ success: true, balance });
  } catch (error) {
    console.error('[get-token-balance] Error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
}
