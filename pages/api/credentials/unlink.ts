import { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import clientPromise from '../../../lib/mongoclient';
import { ALLOWED_PORTALS } from '../devices/save-credentials';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session || !session.user?.address) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  const { miner_key, portal } = req.body ?? {};
  if (!miner_key) {
    return res.status(400).json({ message: 'Missing miner_key' });
  }

  const client = await clientPromise;
  const db = client.db('creds');

  const portalKey = typeof portal === 'string' ? portal.toLowerCase() : null;
  const candidateCollections = portalKey
    ? [ALLOWED_PORTALS.includes(portalKey) ? portalKey : 'other']
    : [...ALLOWED_PORTALS, 'other'];

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

    return res.status(404).json({ message: 'No credentials found to unlink' });
  } catch (err) {
    console.error('Failed to unlink credentials', err);
    return res.status(500).json({ message: 'Failed to unlink credentials' });
  }
}
