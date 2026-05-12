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

const ENDPOINT = '/api/devices/cancel-virtual';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json(
      createApiError(
        ErrorCodes.INVALID_INPUT,
        'Method not allowed.',
        'Please use POST to cancel a virtual device.'
      )
    );
  }

  const testMode =
    process.env.NEXT_PUBLIC_TEST_MODE &&
    process.env.NEXT_PUBLIC_TEST_MODE === 'true';

  const session = await getServerSession(req, res, authOptions);
  if (!session || !session.user?.address) {
    return res.status(401).json(CommonErrors.noSession());
  }

  const sessionAddress = session.user.address.trim();
  const sessionEmail = session.user.email?.trim().toLowerCase();

  const { miner_key } = (req.body ?? {}) as { miner_key?: string };

  if (!miner_key || typeof miner_key !== 'string') {
    return res.status(400).json(
      createApiError(
        ErrorCodes.INVALID_INPUT,
        'Missing miner key',
        'Please include the miner key of the virtual device to cancel.'
      )
    );
  }

  try {
    const client = await clientPromise;
    const db = client.db('main');
    const collection = db.collection(testMode ? 'test-devices' : 'devices');

    const device = await collection.findOne({ miner_key, virtual: true });

    if (!device) {
      return res.status(404).json(
        createApiError(
          ErrorCodes.DEVICE_NOT_FOUND,
          'Virtual device not found',
          'Please verify the miner key and try again.'
        )
      );
    }

    if (device.canceled_at) {
      return res.status(409).json(
        createApiError(
          'ALREADY_CANCELED',
          'Device already canceled',
          'This virtual device has already been canceled.'
        )
      );
    }

    if (device.transitioned_at) {
      return res.status(409).json(
        createApiError(
          'ALREADY_TRANSITIONED',
          'Device already transitioned',
          'This virtual device has already been transitioned.'
        )
      );
    }

    // Ownership validation: email match
    const deviceEmail = (device.email || '').trim().toLowerCase();
    const emailMatch = sessionEmail && deviceEmail && sessionEmail === deviceEmail;

    if (!emailMatch) {
      return res.status(403).json(
        createApiError(
          'CANCEL_DENIED',
          'Cannot cancel this device',
          'This device belongs to a different account.'
        )
      );
    }

    const now = new Date();
    const result = await collection.findOneAndUpdate(
      { miner_key, virtual: true, canceled_at: null, transitioned_at: null },
      {
        $set: {
          canceled_at: now,
          activated: false,
          activated_at: null,
          reward_wallet: null,
          address: null,
        },
      },
      { returnDocument: 'after' }
    );

    if (!result) {
      return res.status(409).json(
        createApiError(
          'STATE_CHANGED',
          'Device state changed during cancellation',
          'Please refresh and try again.'
        )
      );
    }

    loggers.dbOperation('virtual_device_canceled', collection.collectionName, {
      miner_key,
      address: sessionAddress,
      email: sessionEmail,
      testMode,
    });

    return res.status(200).json({
      success: true,
      miner_key,
      canceled_at: now.toISOString(),
      device: JSON.parse(JSON.stringify(result)),
    });
  } catch (error) {
    handleApiError(res, ENDPOINT, error, {
      response: createApiError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to cancel virtual device',
        'Please try again or contact support.'
      ),
      minerKey: miner_key,
      walletAddress: sessionAddress,
      issueType: 'VIRTUAL_DEVICE_CANCELLATION_ERROR',
      part: 'devices.cancel-virtual.handler',
      metadata: { miner_key, address: sessionAddress, testMode },
    });
  }
}
