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

const ENDPOINT = '/api/devices/activate-virtual';

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
        'Please use POST to activate a virtual device.'
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
        'Please include the miner key of the virtual device to activate.'
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

    if (device.activated) {
      return res.status(409).json(
        createApiError(
          'ALREADY_ACTIVATED',
          'Device already activated',
          'This virtual device has already been activated.'
        )
      );
    }

    // Ownership validation: email match OR unclaimed manual claim
    const deviceEmail = (device.email || '').trim().toLowerCase();
    const emailMatch = sessionEmail && deviceEmail && sessionEmail === deviceEmail;
    const isUnclaimed = !device.address;

    if (!emailMatch && !isUnclaimed) {
      // Device has an address set (claimed by someone) but email doesn't match
      return res.status(403).json(
        createApiError(
          'ACTIVATION_DENIED',
          'Cannot activate this device',
          'This device belongs to a different account.'
        )
      );
    }

    if (!emailMatch && isUnclaimed) {
      // Manual claim path — device is unclaimed, user has the miner_key
      loggers.dbOperation('virtual_activation_manual_claim', collection.collectionName, {
        miner_key,
        sessionAddress,
        sessionEmail,
        deviceEmail,
      });
    }

    const now = new Date();
    await collection.updateOne(
      { miner_key, virtual: true, activated: false },
      {
        $set: {
          address: sessionAddress,
          activated: true,
          activated_at: now,
          reward_wallet: sessionAddress,
        }
      }
    );

    loggers.dbOperation('virtual_device_activated', collection.collectionName, {
      miner_key,
      address: sessionAddress,
      method: emailMatch ? 'email_match' : 'manual_claim',
      testMode,
    });

    return res.status(200).json({
      success: true,
      miner_key,
      activated_at: now.toISOString(),
    });
  } catch (error) {
    handleApiError(res, ENDPOINT, error, {
      response: createApiError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to activate virtual device',
        'Please try again or contact support.'
      ),
      minerKey: miner_key,
      walletAddress: sessionAddress,
      issueType: 'VIRTUAL_DEVICE_ACTIVATION_ERROR',
      part: 'devices.activate-virtual.handler',
      metadata: { miner_key, address: sessionAddress, testMode },
    });
  }
}
