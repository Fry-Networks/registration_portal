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

const WEATHER_DB_NAME = process.env.MONGO_CREDS_DB ?? 'creds';
const WEATHER_COLLECTION =
  process.env.MONGO_WEATHER_COLLECTION ??
  (process.env.NEXT_PUBLIC_TEST_MODE === 'true' ? 'test-weather' : 'weather');

const ENDPOINT = '/api/registrations/cancel';

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
        'Please manage registrations from the dashboard.'
      )
    );
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session || !session.user?.address) {
    return res.status(401).json(CommonErrors.noSession());
  }

  const { miner_key, address } = req.body as {
    miner_key?: string;
    address?: string;
  };

  if (!miner_key || !address) {
    return res.status(400).json(
      createApiError(
        ErrorCodes.INVALID_INPUT,
        'Missing required fields',
        'Please submit the miner key and wallet address.'
      )
    );
  }

  const sessionAddress = session.user.address.trim();

  if (sessionAddress !== address) {
    loggers.apiError(ENDPOINT, new Error('Wallet mismatch during registration cancel'), {
      miner_key,
      address,
      sessionAddress,
      issueType: 'REGISTRATION_CANCEL_WALLET_MISMATCH',
      part: 'registrations.cancel.auth',
    });
    return res.status(401).json(CommonErrors.walletMismatch());
  }

  const testMode = process.env.NEXT_PUBLIC_TEST_MODE === 'true';

  try {
    const client = await clientPromise;
    const db = client.db('main');
    const collection = db.collection(testMode ? 'test-devices' : 'devices');

    const device = await collection.findOne({ miner_key });
    if (!device) {
      return res.status(404).json(CommonErrors.deviceNotFound());
    }

    if (device.address && device.address !== sessionAddress) {
      return res.status(409).json(CommonErrors.deviceOwnerMismatch());
    }

    const normalizedPortalModel =
      typeof device.registered_portal_model === 'string'
        ? device.registered_portal_model.toLowerCase()
        : undefined;

    const weatherDb = client.db(WEATHER_DB_NAME);
    const weatherCollection = weatherDb.collection(WEATHER_COLLECTION);

    const weatherQuery: Record<string, unknown> = {
      miner_key,
      owner_address: session.user.address
    };

    if (normalizedPortalModel) {
      weatherQuery.api_type = normalizedPortalModel;
    }

    const weatherDeleteResult = await weatherCollection.deleteMany(weatherQuery);

    if (weatherDeleteResult.deletedCount === 0) {
      const legacyQuery: Record<string, unknown> = { miner_key };

      if (normalizedPortalModel) {
        legacyQuery.api_type = normalizedPortalModel;
      }

      legacyQuery.owner_address = { $exists: false };

      await weatherCollection.deleteMany(legacyQuery);
    }

    const unsetFields: Record<string, ''> = {
      registered_portal_model: ''
    };

    if (!device.is_registered) {
      unsetFields.registration = '';

      if (device.address) {
        unsetFields.address = '';
      }

      if (device.node) {
        unsetFields.node = '';
      }
    }

    const update = { $unset: unsetFields };

    const result = await collection.updateOne({ miner_key }, update);

    if (result.matchedCount === 0) {
      loggers.apiError(ENDPOINT, new Error('Registration cancel update failed'), {
        miner_key,
        address,
        issueType: 'REGISTRATION_CANCEL_UPDATE_FAILED',
        part: 'registrations.cancel.update',
        testMode,
      });
      return res.status(500).json(
        createApiError(
          ErrorCodes.UPDATE_FAILED,
          'Unable to cancel registration',
          'Please retry in a few minutes or contact support.'
        )
      );
    }

    loggers.dbOperation('registration_cancelled', collection.collectionName, {
      miner_key,
      address,
      testMode,
      portalReset: Boolean(device.is_registered),
      weatherDeleted: weatherDeleteResult.deletedCount,
    });

    return res.status(200).json({
      message: device.is_registered
        ? 'Device portal reset successfully.'
        : 'Registration canceled'
    });
  } catch (error) {
    handleApiError(res, ENDPOINT, error, {
      response: createApiError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to cancel registration',
        'Please try again. If the problem continues, contact support.'
      ),
      minerKey: miner_key,
      walletAddress: sessionAddress,
      issueType: 'REGISTRATION_CANCEL_ERROR',
      part: 'registrations.cancel.handler',
      metadata: {
        miner_key,
        address,
        testMode,
        weatherCollection: WEATHER_COLLECTION,
      },
    });
  }
}
