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

const ENDPOINT = '/api/change-name';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json(
      createApiError(
        ErrorCodes.INVALID_INPUT,
        'Unsupported request method',
        'Please use POST when updating a device nickname.'
      )
    );
    return;
  }

  const testMode =
    process.env.NEXT_PUBLIC_TEST_MODE &&
    process.env.NEXT_PUBLIC_TEST_MODE === 'true';

  const session = await getServerSession(req, res, authOptions);
  // Check if user is authenticated
  if (!session || !session.user?.address) {
    res.status(401).json(CommonErrors.noSession());
    return;
  }

  const sessionAddress = session.user.address.trim();

  const { address, name, miner_key } = (req.body ?? {}) as {
    address?: string;
    name?: string;
    miner_key?: string;
  };

  if (!address || !name || !miner_key) {
    res.status(400).json(
      createApiError(
        ErrorCodes.INVALID_INPUT,
        'Missing required fields',
        'Please include miner key, device address, and nickname.'
      )
    );
    return;
  }

  if (sessionAddress !== address) {
    loggers.apiError(ENDPOINT, new Error('Wallet mismatch during nickname update'), {
      address,
      sessionAddress,
      miner_key,
      issueType: 'NICKNAME_WALLET_MISMATCH',
      part: 'change-name.auth',
    });
    res.status(401).json(CommonErrors.walletMismatch());
    return;
  }
  try {
    const client = await clientPromise;
    const db = client.db('main');
    const collection = db.collection(testMode ? 'test-devices' : 'devices');
    const device = await collection.findOne({ miner_key, address });
    if (!device) {
      res.status(404).json(CommonErrors.deviceNotFound());
      return;
    }
    await collection.updateOne(
      { miner_key, address },
      { $set: { nickname: name } }
    );

    loggers.userAction('device_nickname_updated', sessionAddress, {
      miner_key,
      nickname: name,
      testMode,
    });

    res.status(200).json({ message: 'ok' });
  } catch (error) {
    handleApiError(res, ENDPOINT, error, {
      response: createApiError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to update device nickname',
        'Please try again. If the problem persists, contact support.'
      ),
      minerKey: miner_key,
      walletAddress: sessionAddress,
      issueType: 'DEVICE_NICKNAME_UPDATE_ERROR',
      part: 'change-name.handler',
      metadata: {
        miner_key,
        address,
        testMode,
      },
    });
  }
}
