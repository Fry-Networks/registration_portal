import { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import clientPromise from '../../../lib/mongoclient';
import { collectionFor, NAMED_COLLECTIONS } from './utils';
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

  const { miner_key, portal } = req.body ?? {};
  if (!miner_key) {
    return res.status(400).json(
      createApiError(
        ErrorCodes.INVALID_INPUT,
        'Miner key is required to unlink credentials',
        'Select a device and try again.'
      )
    );
  }

  const client = await clientPromise;
  const db = client.db('creds');

  const portalKey = typeof portal === 'string' ? portal.toLowerCase() : null;
  const defaultCollections = Array.from(new Set([...Array.from(NAMED_COLLECTIONS), 'hardware', 'other']));
  const candidateCollections = portalKey
    ? Array.from(new Set([collectionFor({ miner_key, portalType: portalKey }), 'other']))
    : defaultCollections;

  try {
    for (const name of candidateCollections) {
      const result = await db.collection(name).deleteOne({
        miner_key,
        address: session.user.address,
      });

      if (result.deletedCount && result.deletedCount > 0) {
        return res.status(200).json({ message: 'Credentials unlinked', collection: name });
      }
    }

    return res.status(404).json(
      createApiError(
        'CREDENTIALS_NOT_FOUND',
        'No credentials found to unlink',
        'Please verify the selected portal and miner and try again.'
      )
    );
  } catch (error) {
    handleApiError(res, '/api/credentials/unlink', error, {
      response: createApiError(
        ErrorCodes.INTERNAL_ERROR,
        'Unable to unlink credentials',
        'Please try again. If the problem persists, contact support.'
      ),
      minerKey: miner_key,
      walletAddress,
      issueType: 'CREDENTIALS_UNLINK_ERROR',
      part: 'credentials.unlink.handler',
      metadata: {
        miner_key,
        address: walletAddress,
        portal: portal ?? null,
        collections: candidateCollections,
      },
    });
  }
}
