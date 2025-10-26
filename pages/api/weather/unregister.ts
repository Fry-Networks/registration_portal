import type { NextApiRequest, NextApiResponse } from 'next';
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
import type { ApiErrorResponse } from '../../../lib/api-errors';

type UnregisterRequestBody = {
  miner_key?: string | string[];
  api_type?: string;
  address?: string;
};

type UnregisterSuccessResponse = {
  message: string;
  status: 'SUCCESS';
};

type UnregisterApiResponse =
  | UnregisterSuccessResponse
  | ApiErrorResponse;

const WEATHER_DB_NAME = process.env.MONGO_CREDS_DB ?? 'creds';
const WEATHER_COLLECTION =
  process.env.MONGO_WEATHER_COLLECTION ??
  (process.env.NEXT_PUBLIC_TEST_MODE === 'true' ? 'test-weather' : 'weather');

const normalizeString = (value: unknown): string | undefined => {
  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value) && typeof value[0] === 'string') {
    return value[0];
  }

  return undefined;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<UnregisterApiResponse>
) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json(
      createApiError(
        ErrorCodes.INVALID_INPUT,
        'That request is not available.',
        'Please retry this action from the dashboard.'
      )
    );
  }

  const session = await getServerSession(req, res, authOptions);

  if (!session || !session.user?.address) {
    return res.status(401).json(CommonErrors.noSession());
  }

  const body = (req.body as UnregisterRequestBody) ?? {};
  const minerKey = normalizeString(body.miner_key);
  const apiType = normalizeString(body.api_type) ?? 'tempest';
  const address = normalizeString(body.address);

  if (!minerKey || !apiType || !address) {
    return res
      .status(400)
      .json(
        createApiError(
          ErrorCodes.INVALID_INPUT,
          'Missing required fields',
          'Provide miner key, credential type, and wallet address.'
        )
      );
  }

  if (address !== session.user.address) {
    loggers.apiError('/api/weather/unregister', new Error('Wallet mismatch during weather credential unregister'), {
      sessionAddress: session.user.address,
      address,
      miner_key: minerKey,
      api_type: apiType,
      issueType: 'WEATHER_UNREGISTER_WALLET_MISMATCH',
      part: 'weather.unregister.auth',
    });
    return res
      .status(401)
      .json(CommonErrors.walletMismatch());
  }

  try {
    const client = await clientPromise;
    const weatherDb = client.db(WEATHER_DB_NAME);
    const weatherCollection = weatherDb.collection(WEATHER_COLLECTION);

    const existingRecord = await weatherCollection.findOne({
      miner_key: minerKey,
      api_type: apiType
    });

    if (
      existingRecord &&
      existingRecord.owner_address &&
      existingRecord.owner_address !== session.user.address
    ) {
      return res.status(403).json(CommonErrors.deviceOwnerMismatch());
    }

    const deleteResult = await weatherCollection.deleteOne({
      miner_key: minerKey,
      api_type: apiType
    });

    if (deleteResult.deletedCount === 0) {
      return res
        .status(404)
        .json(
          createApiError(
            ErrorCodes.DEVICE_NOT_FOUND,
            'No credential found to remove.',
            'Refresh the page to confirm the credential is still linked.'
          )
        );
    }

    const testMode =
      process.env.NEXT_PUBLIC_TEST_MODE &&
      process.env.NEXT_PUBLIC_TEST_MODE === 'true';

    const devicesCollection = client
      .db('main')
      .collection(testMode ? 'test-devices' : 'devices');

    await devicesCollection.updateOne(
      { miner_key: minerKey, address: session.user.address },
      { $unset: { registered_portal_model: '' } }
    );

    res.status(200).json({
      message: 'Weather credential deleted successfully.',
      status: 'SUCCESS'
    });
  } catch (error) {
    handleApiError(res, '/api/weather/unregister', error, {
      response: createApiError(
        ErrorCodes.INTERNAL_ERROR,
        'Internal server error',
        'Please try again. If the problem persists, contact support.'
      ),
      minerKey,
      walletAddress: session.user.address,
      issueType: 'WEATHER_UNREGISTER_ERROR',
      part: 'weather.unregister.handler',
      metadata: {
        miner_key: minerKey,
        api_type: apiType,
        address,
      },
    });
  }
}
