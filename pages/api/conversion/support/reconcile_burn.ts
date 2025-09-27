import { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../auth/[...nextauth]';
import {
  reconcileFryBurn,
  ReconcileBurnError
} from '../../../../lib/conversion/reconcileBurn';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    res.status(405).json({ message: 'Method Not Allowed' });
    return;
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session || !session.user) {
    res.status(401).json({ message: 'Unauthorized' });
    return;
  }

  const isAdmin = Boolean((session.user as any)?.admin);
  if (!isAdmin) {
    res.status(403).json({ message: 'Forbidden' });
    return;
  }

  const data: {
    address?: string;
    txId?: string;
  } = req.body;

  const address = typeof data?.address === 'string' ? data.address.trim() : '';
  const txId =
    typeof data?.txId === 'string' && data.txId.length > 0 ? data.txId : undefined;

  if (!address) {
    res.status(400).json({ success: false, message: 'Wallet address is required.' });
    return;
  }

  try {
    const result = await reconcileFryBurn({
      address,
      txId
    });
    res.status(200).json(result);
  } catch (error) {
    if (error instanceof ReconcileBurnError) {
      res.status(error.status).json({ success: false, message: error.message });
      return;
    }
    console.log(error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
}
