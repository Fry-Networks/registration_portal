import { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import clientPromise from '../../../lib/mongoclient';
import { collectionFor, portalKeyFromMiner, getMinerType } from '../credentials/utils';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' });

  // Use server-side session retrieval in API routes
  const session = await getServerSession(req, res, authOptions);
  if (!session || !session.user?.address) return res.status(401).json({ message: 'Unauthorized' });

  const { miner_key, credentials, api_type, portal } = req.body ?? {};
  if (!miner_key || !credentials) return res.status(400).json({ message: 'Missing required fields' });

  // Use standardized collection determination from utils.ts
  const collectionName = collectionFor({ miner_key, portalType: portal });

  try {
    const client = await clientPromise;
    const db = client.db('creds');

    const filter = { miner_key, address: session.user.address };
    // Use portal key for named collections, miner type for hardware devices
    const portalKey = portalKeyFromMiner(miner_key);
    const miner_type = (collectionName === 'hardware') ? getMinerType(miner_key) : portalKey;
    const updateSet: any = {
      miner_key,
      address: session.user.address,
      credentials,
      credentials_saved_at: new Date(),
      miner_type,
    };

    // Only include api_type for non-MAC-only types. For hardware/node/aem we intentionally omit api_type
    // since the only credential is mac_address and we only want miner_type stored.
    if (api_type && !['hardware', 'node', 'aem'].includes(String(api_type).toLowerCase())) {
      updateSet.api_type = String(api_type).toLowerCase();
    }

    const update = { $set: updateSet };

    await db.collection(collectionName).updateOne(filter, update, { upsert: true });

    return res.status(200).json({ message: 'Credentials persisted to creds DB', collection: collectionName });
  } catch (err: any) {
    console.error(err);
    return res.status(500).json({ message: 'Failed to save credentials' });
  }
}

