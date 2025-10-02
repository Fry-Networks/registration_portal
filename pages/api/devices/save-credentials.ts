import { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import clientPromise from '../../../lib/mongoclient';

export const ALLOWED_PORTALS = ['air','camera','weather','radiation','water','hardware','nodes','ai-edge','energy'];

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' });

  // Use server-side session retrieval in API routes
  const session = await getServerSession(req, res, authOptions);
  if (!session || !session.user?.address) return res.status(401).json({ message: 'Unauthorized' });

  const { miner_key, credentials, api_type, portal } = req.body ?? {};
  if (!miner_key || !credentials) return res.status(400).json({ message: 'Missing required fields' });

  const portalKey = String(portal ?? '').toLowerCase();
  const collectionName = ALLOWED_PORTALS.includes(portalKey) ? portalKey : 'other';

  // Helper to derive a portal/miner categorical key from the miner_key prefix
  const portalKeyFromMiner = (mk?: string) => {
    if (!mk) return '';
    const minerType = String(mk).split('-')[0];

    if (['OHAQM', 'IHAQM', 'ILAQM'].includes(minerType)) return 'air';
    if (['AOWSCM', 'AOWCM', 'AIWCM', 'AOSCM', 'AISCM', 'AOTCM', 'AITCM', 'AIWSCM'].includes(minerType)) return 'camera';
    if (['HWM', 'LWM'].includes(minerType)) return 'weather';
    if (['OLWQM', 'OHWQM'].includes(minerType)) return 'water';
    if (minerType === 'EM') return 'energy';
    if (minerType === 'IRM') return 'radiation';

    // For these short miner codes return the miner type itself (e.g. "IDM", "CN")
    if (['IDM', 'ODM', 'ISM', 'OSM', 'BM'].includes(minerType)) return minerType;
    if (['CN', 'RDN', 'SDN', 'SVN'].includes(minerType)) return minerType;
    if (minerType === 'AEM') return minerType;

    return '';
  };

  try {
    const client = await clientPromise;
    const db = client.db('creds');

    const filter = { miner_key, address: session.user.address };
    const miner_type = portalKeyFromMiner(miner_key);
    const updateSet: any = {
      miner_key,
      address: session.user.address,
      credentials,
      credentials_saved_at: new Date(),
      miner_type,
    };

    // Only include api_type for non-MAC-only types. For hardware/node we intentionally omit api_type
    // since the only credential is mac_address and we only want miner_type stored.
    if (api_type && !['hardware', 'node'].includes(String(api_type).toLowerCase())) {
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

