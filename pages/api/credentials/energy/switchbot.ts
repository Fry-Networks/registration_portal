// pages/api/credentials/energy/switchbot.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../auth/[...nextauth]';
import clientPromise from '../../../../lib/mongoclient';

const DB_NAME = process.env.MONGO_CREDS_DB ?? 'creds';

const getDb = async () => {
  const client = await clientPromise;
  return client.db(DB_NAME);
};

// SwitchBot applies to energy: check ONLY the energy collection regardless of miner type
const validateSwitchbot = async (params: {
  res: NextApiResponse;
  db: any;
  session: any;
  miner_key: string;
  credentials: Record<string, any>;
  portalType?: string;
}) => {
  const { res, db, session, miner_key, credentials, portalType } = params;
  
  const { token, secret, deviceId } = credentials ?? {};
  if (!token || !secret || deviceId === undefined || deviceId === null) {
    res.status(400).json({ message: 'Missing SwitchBot credentials' });
    return;
  }
  const normalizedDeviceId = String(deviceId).trim();
  if (!normalizedDeviceId) {
    res.status(400).json({ message: 'Invalid SwitchBot deviceId' });
    return;
  }

  // Per your rule, SwitchBot devices live under energy.
  const col = db.collection('energy');

  // If the request is clearly NOT energy (e.g., portal_type given and not energy), we still enforce uniqueness in energy.
  const conflict = await col.findOne({
    miner_key: { $ne: miner_key },
    'credentials.deviceId': normalizedDeviceId,
    address: { $ne: session.user.address },
  });

  if (conflict) {
    res.status(409).json({
      message: 'SwitchBot device is already linked to another user',
      conflictMinerKey: conflict.miner_key,
    });
    return;
  }

  res.status(200).json({ message: 'Validation successful' });
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' });

  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    console.warn('[credentials/energy/switchbot] no session for request, headers:', req.headers?.cookie ? 'has-cookie' : 'no-cookie');
    return res.status(401).json({ message: 'Unauthorized' });
  }

  const { miner_key, credentials, portal_type } = req.body;
  if (!miner_key || !credentials) {
    return res.status(400).json({ message: 'Missing required fields' });
  }

  const db = await getDb();

  try {
    await validateSwitchbot({
      res,
      db,
      session,
      miner_key,
      credentials,
      portalType: portal_type as string | undefined,
    });
  } catch (err) {
    console.error('SwitchBot validation error:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
}