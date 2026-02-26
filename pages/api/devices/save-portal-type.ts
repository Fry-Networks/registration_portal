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
    return res.status(405).json(
      createApiError(
        ErrorCodes.INVALID_INPUT,
        'That request is not available.',
        'Please retry this action from the dashboard.'
      )
    );
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session || !session.user) {
    return res.status(401).json(CommonErrors.noSession());
  }

  const { miner_key, type, address } = req.body;
  if (!miner_key || !type || !address) {
    return res.status(400).json(
      createApiError(
        ErrorCodes.INVALID_INPUT,
        'Missing required fields',
        'Please include miner key, portal type, and wallet address.'
      )
    );
  }
  if (session.user.address !== address) {
    loggers.apiError('/api/devices/save-portal-type', new Error('Wallet mismatch updating portal type'), {
      sessionAddress: session.user.address,
      address,
      miner_key,
      issueType: 'PORTAL_TYPE_WALLET_MISMATCH',
      part: 'devices.save-portal-type.auth',
    });
    return res.status(401).json(CommonErrors.walletMismatch());
  }

  const testMode =
    process.env.NEXT_PUBLIC_TEST_MODE &&
    process.env.NEXT_PUBLIC_TEST_MODE === 'true';

  try {
    const client = await clientPromise;
    const db = client.db('main');
    const collection = db.collection(testMode ? 'test-devices' : 'devices');
    const device = await collection.findOne({ miner_key });

    if (!device) {
      return res.status(404).json(
        createApiError(
          ErrorCodes.DEVICE_NOT_FOUND,
          'Device not found',
          'Please verify the miner key and try again.'
        )
      );
    }

    if (device.address && device.address !== session.user.address) {
      return res.status(401).json(CommonErrors.deviceOwnerMismatch());
    }

    const updateResult = await collection.updateOne(
      { miner_key },
      {
        $set: {
          registered_portal_model: type,
        }
      }
    );

    if (updateResult.matchedCount === 0) {
      return res.status(400).json(
        createApiError(
          ErrorCodes.UPDATE_FAILED,
          'Failed to update portal credential',
          'Please try again. If the problem persists, contact support.'
        )
      );
    }

    return res.status(200).json({
      message: 'Credential updated successfully',
      device: await collection.findOne({ miner_key })
    });
  } catch (error) {
    handleApiError(res, '/api/devices/save-portal-type', error, {
      response: createApiError(
        ErrorCodes.INTERNAL_ERROR,
        'Unable to update portal credential',
        'Please try again. If the problem persists, contact support.'
      ),
      minerKey: miner_key,
      walletAddress: address,
      issueType: 'PORTAL_TYPE_UPDATE_ERROR',
      part: 'devices.save-portal-type.handler',
      metadata: {
        miner_key,
        type,
        address,
      },
    });
  }
}
