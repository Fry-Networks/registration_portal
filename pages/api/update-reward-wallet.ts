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

  const { miner, reward_wallet, address } = (req.body ?? {}) as {
    miner?: number | string;
    reward_wallet?: string;
    address?: string;
  };

  try {
    if (!address || session.user.address !== address) {
      loggers.apiError('/api/update-reward-wallet', new Error('Wallet mismatch during reward wallet update'), {
        sessionAddress: session.user.address,
        address,
        miner,
        issueType: 'UPDATE_REWARD_WALLET_WALLET_MISMATCH',
        part: 'update-reward-wallet.auth',
      });
      res.status(401).json(CommonErrors.walletMismatch());
      return;
    }
    if (!reward_wallet) {
      res.status(400).json(
        createApiError(
          ErrorCodes.INVALID_INPUT,
          'Reward wallet is required',
          'Please provide the wallet address you want to use for rewards.'
        )
      );
      return;
    }
    const client = await clientPromise;
    const db = client.db('main');
    const collection = db.collection(testMode ? 'test-devices' : 'devices');
    const existingDevice = await collection.findOne({
      miner_key: miner,
      address: session.user.address
    });
    if (!existingDevice) {
      res.status(404).json(CommonErrors.deviceNotFound());
      return;
    }
    await collection.updateOne(
      { miner_key: miner, address: session.user.address },
      {
        $set: { reward_wallet: reward_wallet }
      }
    );

    res.status(200).json({ message: 'ok' });
  } catch (error) {
    handleApiError(res, '/api/update-reward-wallet', error, {
      response: createApiError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to update reward wallet',
        'Please try again. If the problem persists, contact support.'
      ),
      minerKey: String(miner ?? ''),
      walletAddress: address,
      issueType: 'UPDATE_REWARD_WALLET_ERROR',
      part: 'update-reward-wallet.handler',
      metadata: {
        miner,
        address,
      },
    });
  }
}
