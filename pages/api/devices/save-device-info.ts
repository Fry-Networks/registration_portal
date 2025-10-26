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
    names: { [key: string]: string };
    email: string;
    address: string;
    nickname: string;
    [key: string]: any; // Add index signature
  } = req.body;

  const { miner_key, names, email, address, nickname } = data;
  if (session.user.address !== address || !address) {
    loggers.apiError('/api/devices/save-device-info', new Error('Wallet mismatch during device info save'), {
      sessionAddress: session.user.address,
      address,
      miner_key,
      issueType: 'DEVICE_INFO_WALLET_MISMATCH',
      part: 'devices.save-device-info.auth',
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

    const result = await collection.updateOne(
      { miner_key: miner_key },
      {
        $set: {
          names: names,
          email: email,
          nickname: nickname
        }
      }
    );

    if (result.matchedCount <= 0) {
      return res.status(400).json(
        createApiError(
          ErrorCodes.UPDATE_FAILED,
          'Failed to update device information',
          'Please try again. If the problem persists, contact support.'
        )
      );
    }

    // console.log(`Registered ${miner_key}`);

    res.status(200).json({ message: 'ok' });
  } catch (error) {
    handleApiError(res, '/api/devices/save-device-info', error, {
      response: createApiError(
        ErrorCodes.INTERNAL_ERROR,
        'Unable to update device information',
        'Please try again. If the problem persists, contact support.'
      ),
      minerKey: miner_key,
      walletAddress: address,
      issueType: 'DEVICE_INFO_UPDATE_ERROR',
      part: 'devices.save-device-info.handler',
      metadata: {
        miner_key,
        address,
        email,
      },
    });
  }
}
