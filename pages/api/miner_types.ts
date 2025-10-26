import { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from './auth/[...nextauth]';
import { loggers } from '../../lib/logger';
import clientPromise from '../../lib/mongoclient';
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
        'Missing miner type lookup parameters',
        'Submit the miner key and wallet address to check the product.'
      )
    );
    return;
  }

  if (session.user.address !== address) {
    loggers.apiError('/api/miner_types', new Error('Wallet mismatch during miner type lookup'), {
      sessionAddress: session.user.address,
      address,
      miner_key,
      issueType: 'MINER_TYPES_WALLET_MISMATCH',
      part: 'miner-types.auth',
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
    if (exists.is_registered) {
      res.status(400).json({ message: 'Already registered' });
      return;
    }

    res.status(200).json({ message: 'ok', name: test.name, type: test.type });
  } catch (error) {
    handleApiError(res, '/api/miner_types', error, {
      response: createApiError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to fetch miner data',
        'Please try again. If the problem persists, contact support.'
      ),
      minerKey: miner_key,
      walletAddress: address,
      issueType: 'MINER_TYPES_FETCH_ERROR',
      part: 'miner-types.handler',
      metadata: {
        miner_key,
        address,
      },
    });
  }
}
