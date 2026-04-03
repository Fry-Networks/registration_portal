import type { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import clientPromise from '../../../lib/mongoclient';
import { CommonErrors, ErrorCodes, createApiError } from '../../../lib/api-errors';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json(
      createApiError(ErrorCodes.INVALID_INPUT, 'Method not allowed', 'Use POST')
    );
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session || !session.user?.address) {
    return res.status(401).json(CommonErrors.noSession());
  }

  const walletAddress = session.user.address;

  try {
    const client = await clientPromise;
    const db = client.db('main');

    // Unset Discord fields
    await db.collection('registration-users').updateOne(
      { address: walletAddress },
      {
        $unset: {
          discordId: '',
          discordUsername: '',
          discordLinkedAt: ''
        }
      }
    );

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('[discord/unlink] Error:', error);
    return res.status(500).json(
      createApiError(ErrorCodes.INTERNAL_ERROR, 'Failed to unlink Discord', 'Please try again')
    );
  }
}
