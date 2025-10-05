import { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import clientPromise from '../../../lib/mongoclient';
import { NAMED_COLLECTIONS } from './utils';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session || !session.user?.address) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  const { miner_key } = req.body ?? {};
  if (!miner_key) {
    return res.status(400).json({ message: 'Missing miner_key' });
  }

  try {
    const client = await clientPromise;
    const db = client.db('creds');

    const collections = [...Array.from(NAMED_COLLECTIONS), 'hardware', 'other'];
    for (const name of collections) {
      const doc = await db.collection(name).findOne({
        miner_key,
        address: session.user.address,
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

    return res.status(404).json({ message: 'No credentials found' });
  } catch (err) {
    console.error('Failed to load credentials', err);
    return res.status(500).json({ message: 'Failed to load credentials' });
  }
}
