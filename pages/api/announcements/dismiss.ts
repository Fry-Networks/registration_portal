import type { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';

import clientPromise from '../../../lib/mongoclient';
import { authOptions } from '../auth/[...nextauth]';

const COLLECTION_USERS = 'registration-users';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<{ ok: true } | { message: string }>
) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ message: 'Method Not Allowed' });
    return;
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.address) {
    res.status(401).json({ message: 'Unauthorized' });
    return;
  }

  const { announcementId } = req.body ?? {};
  if (!announcementId || typeof announcementId !== 'string') {
    res.status(400).json({ message: 'announcementId must be provided' });
    return;
  }

  try {
    const client = await clientPromise;
    const db = client.db('main');
    const usersCollection = db.collection(COLLECTION_USERS);

    const now = new Date();

    const updateExisting = await usersCollection.updateOne(
      { address: session.user.address, 'announcement_dismissals.id': announcementId },
      {
        $set: {
          'announcement_dismissals.$.dismissedAt': now
        }
      }
    );

    if (updateExisting.matchedCount === 0) {
      const pushResult = await usersCollection.updateOne(
        { address: session.user.address },
        {
          $push: {
            announcement_dismissals: {
              id: announcementId,
              dismissedAt: now
            }
          }
        }
      );

      if (pushResult.matchedCount === 0) {
        res.status(404).json({ message: 'User profile not found' });
        return;
      }
    }

    res.status(200).json({ ok: true });
  } catch (error) {
    console.error('[announcements/dismiss] error', error);
    res.status(500).json({ message: 'Failed to update announcement dismissal' });
  }
}
