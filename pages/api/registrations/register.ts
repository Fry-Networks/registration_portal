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

const ENDPOINT = '/api/registrations/register';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json(
      createApiError(
        ErrorCodes.INVALID_INPUT,
        'Unsupported request method',
        'Please submit registration confirmations using POST.'
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

  const { miner_key, address } = (req.body ?? {}) as {
    miner_key?: string;
    address?: string;
  };

  if (!miner_key || !address) {
    res.status(400).json(
      createApiError(
        ErrorCodes.INVALID_INPUT,
        'Missing registration fields',
        'Please include the miner key and wallet address.'
      )
    );
    return;
  }

  if (sessionAddress !== address) {
    loggers.apiError(ENDPOINT, new Error('Wallet mismatch during registration finalization'), {
      miner_key,
      address,
      sessionAddress,
      issueType: 'REGISTRATION_WALLET_MISMATCH',
      part: 'registrations.register.auth',
    });
    res.status(401).json(CommonErrors.walletMismatch());
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

    if (exists.address && exists.address !== address) {
      res.status(409).json(CommonErrors.deviceOwnerMismatch());
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
          address: address
        }
      }
    );

    if (updateResult.matchedCount === 0) {
      res.status(404).json(CommonErrors.deviceNotFound());
      return;
    }

    loggers.dbOperation('registration_confirmed', collection.collectionName, {
      miner_key,
      address,
      testMode,
    });

    res.status(200).json({ message: 'ok' });
  } catch (error) {
    handleApiError(res, ENDPOINT, error, {
      response: createApiError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to complete registration',
        'Please try again or contact support.'
      ),
      minerKey: miner_key,
      walletAddress: sessionAddress,
      issueType: 'DEVICE_REGISTRATION_ERROR',
      part: 'registrations.register.handler',
      metadata: {
        miner_key,
        address,
        testMode,
      },
    });
  }
}
