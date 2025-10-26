import { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import { loggers } from '../../../lib/logger';
import clientPromise from '../../../lib/mongoclient';
import {
  CommonErrors,
  createApiError,
  ErrorCodes,
  handleApiError,
} from '../../../lib/api-errors';

const ENDPOINT = '/api/registrations/create';

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
        'Please start registrations from the dashboard.'
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

  const { miner_key, names, email, address, ...rest } = (req.body ?? {}) as {
    miner_key?: string;
    names?: { [key: string]: string };
    email?: string;
    address?: string;
    [key: string]: unknown;
  };

  if (!miner_key || !address || !names || typeof names !== 'object') {
    res.status(400).json(
      createApiError(
        ErrorCodes.INVALID_INPUT,
        'Missing registration details',
        'Please provide miner key, wallet address, and contact information.'
      )
    );
    return;
  }

  if (!email || typeof email !== 'string') {
    res.status(400).json(
      createApiError(
        ErrorCodes.INVALID_INPUT,
        'Email is required',
        'Please provide a valid contact email.'
      )
    );
    return;
  }

  const firstName = names.first_name;
  const lastName = names.last_name;

  if (sessionAddress !== address) {
    loggers.apiError(ENDPOINT, new Error('Wallet mismatch during registration create'), {
      miner_key,
      address,
      sessionAddress,
      issueType: 'REGISTRATION_WALLET_MISMATCH',
      part: 'registrations.create.auth',
    });
    res.status(401).json(CommonErrors.walletMismatch());
    return;
  }

  const body = {
    miner_key,
    names,
    email,
    address,
    ...rest,
  };

  const validationError = validateRegistrationPayload(body);
  if (validationError) {
    res.status(400).json(
      createApiError(
        ErrorCodes.INVALID_INPUT,
        validationError,
        'Please correct the highlighted fields and try again.'
      )
    );
    return;
  }

  try {
    const client = await clientPromise;
    const db = client.db('main');
    const collection = db.collection(testMode ? 'test-devices' : 'devices');
    const exists = await collection.findOne({ miner_key });
    if (!exists) {
      res.status(404).json(CommonErrors.deviceNotFound());
      return;
    }
    if (exists.is_registered) {
      res.status(400).json(
        createApiError(
          ErrorCodes.ALREADY_REGISTERED,
          'Device already registered',
          'No further action is required.'
        )
      );
      return;
    }
    const updateResult = await collection.updateOne(
      { miner_key },
      {
        $set: {
          is_registered: true,
          names,
          email,
          address
        }
      }
    );

    if (updateResult.matchedCount === 0) {
      res.status(404).json(CommonErrors.deviceNotFound());
      return;
    }

    loggers.dbOperation('registration_created', collection.collectionName, {
      miner_key,
      address,
      first_name: firstName,
      last_name: lastName,
      testMode,
    });

    res.status(200).json({ message: 'ok' });
  } catch (error) {
    handleApiError(res, ENDPOINT, error, {
      response: createApiError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to start registration',
        'Please try again or contact support.'
      ),
      minerKey: miner_key,
      walletAddress: sessionAddress,
      issueType: 'DEVICE_REGISTRATION_ERROR',
      part: 'registrations.create.handler',
      metadata: {
        miner_key,
        address,
        email,
        first_name: firstName,
        last_name: lastName,
        testMode,
      },
    });
  }
}

function validateRegistrationPayload(payload: {
  miner_key: string;
  names: { [key: string]: string };
  email: string;
  address: string;
  [key: string]: any;
}): string | null {
  for (const key of Object.keys(payload)) {
    if (key === 'names') {
      const firstName = payload.names?.first_name ?? '';
      const lastName = payload.names?.last_name ?? '';
      let error = validateInput('first_name', firstName);
      if (error) return error;
      error = validateInput('last_name', lastName);
      if (error) return error;
    } else if (key !== 'miner_key' && key !== 'address') {
      const error = validateInput(key, payload[key]);
      if (error) return error;
    }
  }
  return null;
}

const validateInput = (name: string, value: string) => {
  let regex;
  let error = '';
  switch (name) {
    case 'first_name':
    case 'last_name':
      regex = /^[a-zA-Z\ -]+$/;
      error = regex.test(value) ? '' : 'Only alphabets are allowed.';
      break;
    case 'email':
      regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      error = regex.test(value) ? '' : 'Invalid email format.';
      break;
    default:
      error = 'Invalid input';
      break;
  }
  return error;
};
