import { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import { getAlgoBalance } from '../../../lib/algorand/balances';
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

  const { address } = req.body as { address?: string };

  if (!address) {
    res.status(400).json({ message: 'Invalid input param' });
    return;
  }

  let balance: number;
  try {
    balance = await getAlgoBalance(address);
  } catch (err) {
    console.error('[get-algo-balance] balance check failed', err);
    res.status(503).json(
      createApiError(
        ErrorCodes.NETWORK_ERROR,
        'Could not verify on-chain balance',
        'Please try again in a few minutes.'
      )
    );
    return;
  }

  // Full precision — formatting belongs to the display layer.
  res.status(200).json({ success: true, balance });
}
