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

const ENDPOINT = '/api/verify-position';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json(
      createApiError(
        ErrorCodes.INVALID_INPUT,
        'That request is not available.',
        'Please retry this action from the dashboard.'
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

  const { miner, latitude, longitude, address } = (req.body ?? {}) as {
    latitude?: number;
    longitude?: number;
    address?: string;
    miner?: string;
  };

  try {
    if (!address || sessionAddress !== address) {
      loggers.apiError(ENDPOINT, new Error('Wallet mismatch during position verification'), {
        address,
        sessionAddress,
        miner_key: miner,
        issueType: 'POSITION_WALLET_MISMATCH',
        part: 'verify-position.auth',
      });
      res.status(401).json(CommonErrors.walletMismatch());
      return;
    }
    if (
      !miner ||
      typeof latitude !== 'number' ||
      Number.isNaN(latitude) ||
      typeof longitude !== 'number' ||
      Number.isNaN(longitude)
    ) {
      res.status(400).json(
        createApiError(
          ErrorCodes.INVALID_INPUT,
          'Latitude and longitude are required',
          'Please provide numeric latitude and longitude values.'
        )
      );
      return;
    }
    const client = await clientPromise;
    const db = client.db('main');
    const collection = db.collection(testMode ? 'test-devices' : 'devices');
    const result = await collection.updateOne(
      { miner_key: miner, address: sessionAddress },
      {
        $set: {
          position: {
            lat: latitude,
            lng: longitude
          }
        }
      }
    );

    if (result.matchedCount === 0) {
      res.status(404).json(CommonErrors.deviceNotFound());
      return;
    }

    loggers.dbOperation('update_position', collection.collectionName, {
      miner_key: miner,
      address,
      sessionAddress,
      testMode,
    });

    res.status(200).json({ message: 'ok' });
  } catch (error) {
    handleApiError(res, ENDPOINT, error, {
      response: createApiError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to update device position',
        'Please try again. If the issue continues, contact support.'
      ),
      minerKey: miner,
      walletAddress: sessionAddress,
      issueType: 'DEVICE_POSITION_UPDATE_ERROR',
      part: 'verify-position.handler',
      metadata: {
        miner_key: miner,
        address,
        latitude,
        longitude,
        testMode,
      },
    });
  }
}
