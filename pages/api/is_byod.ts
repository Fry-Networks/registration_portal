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
  const testMode =
    process.env.NEXT_PUBLIC_TEST_MODE &&
    process.env.NEXT_PUBLIC_TEST_MODE === 'true';

  const session = await getServerSession(req, res, authOptions);
  // Check if user is authenticated
  if (!session || !session.user?.address) {
    res.status(401).json(CommonErrors.noSession());
    return;
  }

  const { miner_key, address } = (req.body ?? {}) as {
    miner_key?: string;
    address?: string;
  };

  if (!miner_key || !address) {
    res.status(400).json(
      createApiError(
        ErrorCodes.INVALID_INPUT,
        'Missing BYOD lookup parameters',
        'Provide the miner key and wallet address to check BYOD status.'
      )
    );
    return;
  }

  if (session.user.address !== address) {
    loggers.apiError('/api/is_byod', new Error('Wallet mismatch during BYOD check'), {
      sessionAddress: session.user.address,
      address,
      miner_key,
      issueType: 'BYOD_WALLET_MISMATCH',
      part: 'is_byod.auth',
    });
    res.status(401).json(CommonErrors.walletMismatch());
    return;
  }
  try {
    const miner_type = miner_key.split('-')[0];
    const client = await clientPromise;
    const db = client.db('main');
    const collection = db.collection('products');
    const test = await collection.findOne({ key: miner_type });
    if (!test) {
      res.status(404).json(CommonErrors.productNotFound());
      return;
    }
    const exists = await db
      .collection(testMode ? 'test-devices' : 'devices')
      .findOne({ miner_key: miner_key });
    if (!exists) {
      res.status(400).json({ message: 'Not found' });
      return;
    }

    res
      .status(200)
      .json({ message: 'ok', byod: exists.byod ? exists.byod : '' });
  } catch (error) {
    handleApiError(res, '/api/is_byod', error, {
      response: createApiError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to check BYOD status',
        'Please try again. If the problem persists, contact support.'
      ),
      minerKey: miner_key,
      walletAddress: address,
      issueType: 'BYOD_STATUS_ERROR',
      part: 'is_byod.handler',
      metadata: {
        miner_key,
        address,
      },
    });
  }
}
