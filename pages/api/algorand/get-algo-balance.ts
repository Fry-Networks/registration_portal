import { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import { getAlgoBalance } from '../../../lib/algorand/balances';

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

  const balance = await getAlgoBalance(address);

  if (balance === null) {
    res
      .status(200)
      .json({ success: false, message: 'Unable to fetch ALGO balance' });
    return;
  }

  res.status(200).json({ success: true, balance: balance.toFixed(3) });
}
