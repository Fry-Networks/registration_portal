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

type UnregisterApiResponse =
  | { status: 'SUCCESS'; message: string }
  | (ApiErrorResponse & { status: 'ERROR' });

const CREDENTIAL_DB_NAME = process.env.MONGO_CREDS_DB ?? 'creds';
const CREDENTIAL_COLLECTION =
  process.env.MONGO_ENERGY_COLLECTION ??
  (process.env.NEXT_PUBLIC_TEST_MODE === 'true' ? 'test-energy' : 'energy');

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
  const makeErrorResponse = (payload: ApiErrorResponse) => ({
    status: 'ERROR' as const,
    ...payload,
  });

  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json(
      makeErrorResponse(
        createApiError(
          ErrorCodes.INVALID_INPUT,
          'That request is not available.',
          'Please retry this action from the dashboard.'
        )
      )
    );
  }

  const session = await getServerSession(req, res, authOptions);

  if (!session || !session.user?.address) {
    return res.status(401).json(makeErrorResponse(CommonErrors.noSession()));
  }

  const body = (req.body as UnregisterRequestBody) ?? {};
  const minerKey = normalizeString(body.miner_key);
  const apiType = normalizeString(body.api_type) ?? 'switchbot';
  const address = normalizeString(body.address);

  if (!minerKey || !apiType || !address) {
    return res.status(400).json(
      makeErrorResponse(
        createApiError(
          ErrorCodes.INVALID_INPUT,
          'Missing required fields',
          'Please provide the miner key, credential type, and address.'
        )
      )
    );
  }

  if (address !== session.user.address) {
    loggers.apiError('/api/energy/unregister', new Error('Wallet mismatch during energy credential unregister'), {
      sessionAddress: session.user.address,
      address,
      miner_key: minerKey,
      api_type: apiType,
      issueType: 'ENERGY_UNREGISTER_WALLET_MISMATCH',
      part: 'energy.unregister.auth',
    });
    return res.status(401).json(makeErrorResponse(CommonErrors.walletMismatch()));
  }

  try {
    const client = await clientPromise;
    const credentialDb = client.db(CREDENTIAL_DB_NAME);
    const credentialCollection = credentialDb.collection(CREDENTIAL_COLLECTION);

    const existingRecord = await credentialCollection.findOne({
      miner_key: minerKey,
      api_type: apiType
    });

    if (
      existingRecord &&
      existingRecord.owner_address &&
      existingRecord.owner_address !== session.user.address
    ) {
      return res.status(403).json(
        makeErrorResponse(
          createApiError(
            ErrorCodes.FORBIDDEN,
            'This credential belongs to another wallet',
            'Please sign in with the wallet that owns this credential.'
          )
        )
      );
    }

    const deleteResult = await credentialCollection.deleteOne({
      miner_key: minerKey,
      api_type: apiType
    });

    if (deleteResult.deletedCount === 0) {
      return res.status(404).json(
        makeErrorResponse(
          createApiError(
            ErrorCodes.DEVICE_NOT_FOUND,
            'No credential found to remove',
            'Please refresh the page and confirm the credential is still linked.'
          )
        )
      );
    }

    const testMode = process.env.NEXT_PUBLIC_TEST_MODE === 'true';

    const devicesCollection = client
      .db('main')
      .collection(testMode ? 'test-devices' : 'devices');

    await devicesCollection.updateOne(
      { miner_key: minerKey, address: session.user.address },
      { $unset: { registered_portal_model: '' } }
    );

    res.status(200).json({
      message: 'Energy credential deleted successfully.',
      status: 'SUCCESS'
    });
  } catch (error) {
    handleApiError(res, '/api/energy/unregister', error, {
      response: makeErrorResponse(
        createApiError(
          ErrorCodes.INTERNAL_ERROR,
          'Unable to unregister energy credential',
          'Please try again. If the problem persists, contact support.'
        )
      ),
      minerKey,
      walletAddress: session.user.address,
      issueType: 'ENERGY_UNREGISTER_ERROR',
      part: 'energy.unregister.handler',
      metadata: {
        miner_key: minerKey,
        api_type: apiType,
        address,
      },
    });
  }
}
