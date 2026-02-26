import { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from './auth/[...nextauth]';
import clientPromise from '../../lib/mongoclient';
import { loggers } from '../../lib/logger';
import {
  CommonErrors,
  createApiError,
  ErrorCodes,
  handleApiError,
} from '../../lib/api-errors';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const session = await getServerSession(req, res, authOptions);
  // Check if user is authenticated
  if (!session || !session.user?.address) {
    res.status(401).json(CommonErrors.noSession());
    return;
  }

  const { address, key } = (req.body ?? {}) as {
    address?: string;
    key?: string;
  };

  if (!address || session.user.address !== address) {
    loggers.apiError('/api/stake-amount', new Error('Wallet mismatch during stake amount lookup'), {
      sessionAddress: session.user.address,
      address,
      key,
      issueType: 'STAKE_AMOUNT_WALLET_MISMATCH',
      part: 'stake-amount.auth',
    });
    res.status(401).json(CommonErrors.walletMismatch());
    return;
  }

  if (!key) {
    res.status(400).json(
      createApiError(
        ErrorCodes.INVALID_INPUT,
        'Product key is required',
        'Submit the product key to fetch staking amounts.'
      )
    );
    return;
  }
  try {
    const client = await clientPromise;
    const db = client.db('main');
    const collection = db.collection('products');
    const product = await collection.findOne({ key: key });
    if (!product) {
      res.status(404).json(CommonErrors.productNotFound());
      return;
    }
    /*let price = await getFRYPrice();
        if (!price) return 1;
        const USD = product.reward.stake ?? 0;
        price = Math.floor((USD / price)) 
        */
    let price = product.reward.stake ?? { stake_one: 0, stake_two: 0 };

    const data = {
      stake: price
    };

    res.status(200).json({ message: 'ok', data });
  } catch (error) {
    handleApiError(res, '/api/stake-amount', error, {
      response: createApiError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to retrieve product stake data',
        'Please try again. If the problem persists, contact support.'
      ),
      issueType: 'STAKE_AMOUNT_ERROR',
      part: 'stake-amount.handler',
      metadata: {
        key,
        address,
      },
    });
  }
}
