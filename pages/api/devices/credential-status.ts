import type { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import clientPromise from '../../../lib/mongoclient';
import { portalKeyFromMiner, NAMED_COLLECTIONS } from '../../../lib/credentials-utils';

const SKIP_PORTALS = new Set(['water']);
const CREDS_DB = process.env.MONGO_CREDS_DB ?? 'creds';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session || !session.user?.address) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  try {
    const client = await clientPromise;
    const mainDb = client.db('main');
    const credsDb = client.db(CREDS_DB);
    const testMode = process.env.NEXT_PUBLIC_TEST_MODE === 'true';

    const devices = await mainDb
      .collection(testMode ? 'test-devices' : 'devices')
      .find({ address: session.user.address })
      .project({ miner_key: 1, registered_portal_model: 1, nickname: 1 })
      .toArray();

    const results: Array<{
      miner_key: string;
      portal: string;
      nickname: string | null;
      needs_credentials: boolean;
    }> = [];

    for (const device of devices) {
      const mk = device.miner_key;
      if (!mk) continue;

      const portal = portalKeyFromMiner(mk) || device.registered_portal_model || '';
      if (!portal || !NAMED_COLLECTIONS.has(portal) || SKIP_PORTALS.has(portal)) continue;

      const credDoc = await credsDb.collection(portal).findOne(
        { miner_key: mk },
        { projection: { credentials: 1, api_type: 1 } }
      );

      let needsCreds = false;
      if (!credDoc) {
        needsCreds = true;
      } else if (!credDoc.credentials || typeof credDoc.credentials !== 'object') {
        needsCreds = true;
      } else {
        const credKeys = Object.keys(credDoc.credentials);
        const hasValues = credKeys.some((k: string) => {
          const v = credDoc.credentials[k];
          return v !== '' && v !== null && v !== undefined;
        });
        if (!hasValues) needsCreds = true;
      }

      if (needsCreds) {
        results.push({
          miner_key: mk,
          portal,
          nickname: device.nickname ?? null,
          needs_credentials: true,
        });
      }
    }

    return res.status(200).json({ success: true, devices: results });
  } catch (error) {
    console.error('credential-status error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}
