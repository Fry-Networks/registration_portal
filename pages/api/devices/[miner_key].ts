import { NextApiRequest, NextApiResponse } from 'next';
import clientPromise from '../../../lib/mongoclient';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import { hydrateDeviceWithPosition } from '../../../lib/devicePosition';
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
  const session = await getServerSession(req, res, authOptions);

  if (!session || !session.user) {
    return res.status(401).json(CommonErrors.noSession());
  }

  const walletAddress = session.user.address;

  const { address } = req.body ?? {};

  const testMode =
    process.env.NEXT_PUBLIC_TEST_MODE &&
    process.env.NEXT_PUBLIC_TEST_MODE === 'true';
  const { miner_key } = req.query;

  if (!miner_key || typeof miner_key !== 'string') {
    return res.status(400).json(
      createApiError(
        ErrorCodes.INVALID_INPUT,
        'Invalid or missing miner key',
        'Please provide the device miner key.'
      )
    );
  }

  try {
    const client = await clientPromise;
    const db = client.db('main');

    const device = await db
      .collection(testMode ? 'test-devices' : 'devices')
      .findOne({ miner_key });

    if (!device) {
      return res.status(404).json(
        createApiError(
          ErrorCodes.DEVICE_NOT_FOUND,
          'Device not found',
          'Please verify the miner key and try again.'
        )
      );
    }

    const hydratedDevice = await hydrateDeviceWithPosition(client, device as any);

    if (address) {
      if (walletAddress !== address) {
        loggers.apiError('/api/devices/[miner_key]', new Error('Wallet mismatch loading device detail'), {
          sessionAddress: walletAddress,
          address,
          miner_key,
          issueType: 'DEVICE_DETAIL_WALLET_MISMATCH',
          part: 'devices.miner-key.auth',
        });
        return res.status(401).json(CommonErrors.walletMismatch());
      }

      if (device.address && device.address !== walletAddress) {
        return res.status(401).json(CommonErrors.walletMismatch());
      }
      return res.status(200).json({ device: hydratedDevice });
    }

    return res.status(200).json({
      device: {
        is_registered: hydratedDevice.is_registered,
        registered_portal_model: hydratedDevice?.registered_portal_model,
        position: hydratedDevice?.position
      }
    });
  } catch (error) {
    handleApiError(res, '/api/devices/[miner_key]', error, {
      response: createApiError(
        ErrorCodes.INTERNAL_ERROR,
        'Unable to load device information',
        'Please try again. If the problem persists, contact support.'
      ),
      minerKey: miner_key,
      walletAddress,
      issueType: 'DEVICE_FETCH_ERROR',
      part: 'devices.miner-key.handler',
      metadata: {
        miner_key,
        address,
        hasAddressFilter: Boolean(address),
      },
    });
  }
}
