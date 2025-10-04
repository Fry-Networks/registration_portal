// pages/api/credentials/energy/shelly.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../auth/[...nextauth]';
import clientPromise from '../../../../lib/mongoclient';

const DB_NAME = process.env.MONGO_CREDS_DB ?? 'creds';

const getDb = async () => {
  const client = await clientPromise;
  return client.db(DB_NAME);
};

const normalizeServerUrl = (url: string) => {
  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return trimmed.replace(/\/$/, '');
};

// Shelly applies to energy: check ONLY the energy collection regardless of miner type
const validateShelly = async (params: {
  res: NextApiResponse;
  db: any;
  session: any;
  miner_key: string;
  credentials: Record<string, any>;
  portalType?: string;
}) => {
  const { res, db, session, miner_key, credentials, portalType } = params;
  
  const { authKey, serverURL, deviceId } = credentials ?? {};
  if (!authKey || !serverURL || deviceId === undefined || deviceId === null) {
    res.status(400).json({ message: 'Missing Shelly credentials' });
    return;
  }

  const normalizedAuthKey = String(authKey).trim();
  const normalizedServerURL = normalizeServerUrl(String(serverURL));
  const normalizedDeviceId = String(deviceId).trim();

  if (!normalizedAuthKey || !normalizedServerURL || !normalizedDeviceId) {
    res.status(400).json({ message: 'Invalid Shelly credentials' });
    return;
  }

  if (normalizedAuthKey.length < 10) {
    res.status(400).json({ message: 'Shelly auth key is too short' });
    return;
  }

  // Per your rule, Shelly devices live under energy.
  const col = db.collection('energy');

  // Check for device conflicts: same deviceId with different user
  const deviceConflict = await col.findOne({
    miner_key: { $ne: miner_key },
    'credentials.deviceId': normalizedDeviceId,
    address: { $ne: session.user.address },
  });

  if (deviceConflict) {
    res.status(409).json({
      message: 'Shelly device is already linked to another user',
      conflictMinerKey: deviceConflict.miner_key,
    });
    return;
  }

  // Check for server URL + auth key combination conflicts
  const serverConflict = await col.findOne({
    miner_key: { $ne: miner_key },
    'credentials.authKey': normalizedAuthKey,
    'credentials.serverURL': normalizedServerURL,
    address: { $ne: session.user.address },
  });

  if (serverConflict) {
    res.status(409).json({
      message: 'Shelly server credentials are already linked to another user',
      conflictMinerKey: serverConflict.miner_key,
    });
    return;
  }

  res.status(200).json({ message: 'Validation successful' });
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' });

  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    console.warn('[credentials/energy/shelly] no session for request, headers:', req.headers?.cookie ? 'has-cookie' : 'no-cookie');
    return res.status(401).json({ message: 'Unauthorized' });
  }

  const { miner_key, credentials, portal_type } = req.body;
  if (!miner_key || !credentials) {
    return res.status(400).json({ message: 'Missing required fields' });
  }

  const db = await getDb();

  try {
    await validateShelly({
      res,
      db,
      session,
      miner_key,
      credentials,
      portalType: portal_type as string | undefined,
    });
  } catch (err) {
    console.error('Shelly validation error:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
}