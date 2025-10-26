import { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import clientPromise from '../../../lib/mongoclient';
import { NAMED_COLLECTIONS } from './utils';
import {
  CommonErrors,
  createApiError,
  ErrorCodes,
  handleApiError,
} from '../../../lib/api-errors';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
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
  const walletAddress = session.user.address;

  const { miner_key } = req.body ?? {};
  if (!miner_key) {
    return res.status(400).json(
      createApiError(
        ErrorCodes.INVALID_INPUT,
        'Miner key is required to load credentials',
        'Please provide the device miner key and try again.'
      )
    );
  }

  try {
    const client = await clientPromise;
    const db = client.db('creds');

    const collections = [...Array.from(NAMED_COLLECTIONS), 'hardware', 'other'];
    for (const name of collections) {
      const doc = await db.collection(name).findOne({
        miner_key,
        address: walletAddress,
      });

      if (doc) {
        return res.status(200).json({
          miner_key,
          portal: doc.portal ?? null,
          collection: name,
          api_type: doc.api_type ?? null,
          credentials: doc.credentials ?? {},
          updatedAt: doc.credentials_saved_at ?? null,
        });
      }
    }

    return res.status(404).json(
      createApiError(
        'CREDENTIALS_NOT_FOUND',
        'No credentials found for this device',
        'Please add credentials and try again.'
      )
    );
  } catch (error) {
    handleApiError(res, '/api/credentials/get', error, {
      response: createApiError(
        ErrorCodes.INTERNAL_ERROR,
        'Unable to load credentials',
        'Please try again. If the problem persists, contact support.'
      ),
      minerKey: miner_key,
      walletAddress,
      issueType: 'CREDENTIALS_GET_ERROR',
      part: 'credentials.get.handler',
      metadata: {
        miner_key,
        address: walletAddress,
      },
    });
  }
}
