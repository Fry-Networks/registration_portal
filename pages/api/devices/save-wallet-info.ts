import { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import clientPromise from '../../../lib/mongoclient';
import { loggers } from '../../../lib/logger';
import {
  CommonErrors,
  createApiError,
  ErrorCodes,
  handleApiError,
} from '../../../lib/api-errors';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json(
      createApiError(
        ErrorCodes.INVALID_INPUT,
        'That request is not available.',
        'Please retry this action from the dashboard.'
      )
    );
  }

  const testMode =
    process.env.NEXT_PUBLIC_TEST_MODE &&
    process.env.NEXT_PUBLIC_TEST_MODE === 'true';

  const session = await getServerSession(req, res, authOptions);
  // Check if user is authenticated
  if (!session || !session.user) {
    return res.status(401).json(CommonErrors.noSession());
  }

  const data: {
    miner_key: string;
    reward_wallet: string;
    address: string;
  } = req.body;

  const { miner_key, reward_wallet, address } = data;
  if (session.user.address !== address || !address) {
    loggers.apiError('/api/devices/save-wallet-info', new Error('Wallet mismatch during reward wallet update'), {
      sessionAddress: session.user.address,
      address,
      miner_key,
      issueType: 'DEVICE_WALLET_UPDATE_WALLET_MISMATCH',
      part: 'devices.save-wallet-info.auth',
    });
    return res.status(401).json(CommonErrors.walletMismatch());
  }

  try {
    const client = await clientPromise;
    const db = client.db('main');
    const collection = db.collection(testMode ? 'test-devices' : 'devices');
    const exists = await collection.findOne({ miner_key });

    if (!exists) {
      return res.status(404).json(
        createApiError(
          ErrorCodes.DEVICE_NOT_FOUND,
          'Device not found',
          'Please verify the miner key and try again.'
        )
      );
    }

    if (exists.address && exists.address !== session.user.address) {
      return res.status(401).json(CommonErrors.walletMismatch());
    }

    await collection.updateOne(
      { miner_key },
      {
        $set: {
          reward_wallet: reward_wallet
        }
      }
    );

    res.status(200).json({ success: true });
  } catch (error) {
    handleApiError(res, '/api/devices/save-wallet-info', error, {
      response: createApiError(
        ErrorCodes.INTERNAL_ERROR,
        'Unable to update reward wallet',
        'Please try again. If the problem persists, contact support.'
      ),
      minerKey: miner_key,
      walletAddress: address,
      issueType: 'DEVICE_WALLET_UPDATE_ERROR',
      part: 'devices.save-wallet-info.handler',
      metadata: {
        miner_key,
        address,
        reward_wallet,
      },
    });
  }
}
