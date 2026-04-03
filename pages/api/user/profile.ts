import type { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import clientPromise from '../../../lib/mongoclient';
import { CommonErrors } from '../../../lib/api-errors';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session || !session.user?.address) {
    return res.status(401).json(CommonErrors.noSession());
  }

  try {
    const client = await clientPromise;
    const db = client.db('main');
    
    const user = await db.collection('registration-users').findOne(
      { address: session.user.address },
      { projection: { discordId: 1, discordUsername: 1, discordLinkedAt: 1 } }
    );

    return res.status(200).json({
      discordId: user?.discordId || null,
      discordUsername: user?.discordUsername || null,
      discordLinkedAt: user?.discordLinkedAt || null
    });
  } catch (error) {
    console.error('[user/profile] Error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch profile' });
  }
}
