// pages/api/credentials/hardware/mac.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../auth/[...nextauth]';
import clientPromise from '../../../../lib/mongoclient';
import { LINKED_MINER_TYPES, getMinerType, collectionFor } from '../utils';

const DB_NAME = process.env.MONGO_CREDS_DB ?? 'creds';

const getDb = async () => {
  const client = await clientPromise;
  return client.db(DB_NAME);
};

// MAC validator (mac/hardware/node)
const validateMac = async (params: {
  res: NextApiResponse;
  db: any;
  session: any;
  miner_key: string;
  minerType: string;
  portalType?: string;
  credentials: Record<string, any>;
}) => {
  const { res, db, session, miner_key, minerType, portalType, credentials } = params;
  
  const macValue: string | undefined =
    (credentials as any)?.mac_address ?? (credentials as any)?.miner_mac;

  if (!miner_key || typeof miner_key !== 'string') {
    res.status(400).json({ message: 'Missing miner_key' });
    return;
  }
  if (!macValue || typeof macValue !== 'string') {
    res.status(400).json({ message: 'Missing mac_address in credentials' });
    return;
  }

  const colName = collectionFor({ miner_key, portalType });
  const col = db.collection(colName);

  // Ownership check on THIS miner doc
  const existingMiner = await col.findOne({ miner_key });
  if (existingMiner && existingMiner.address && existingMiner.address !== session.user.address) {
    res.status(403).json({ message: 'Forbidden' });
    return;
  }

  // Linked miner MAC conflict check in the SAME collection (all "others" live in hardware)
  const linkedTypes = LINKED_MINER_TYPES[minerType] ?? [];
  if (linkedTypes.length > 0) {
    const suffix = String(miner_key).slice(minerType.length);
    const linkedMinerKeys = linkedTypes.map(t => `${t}${suffix}`).filter(k => k !== miner_key);
    if (linkedMinerKeys.length) {
      const linkedMiners = await col.find({ miner_key: { $in: linkedMinerKeys } }).toArray();
      for (const lm of linkedMiners) {
        const linkedMacTop = typeof lm.miner_mac === 'string' ? lm.miner_mac : '';
        const linkedMacCred = lm.credentials && typeof lm.credentials.mac_address === 'string' ? lm.credentials.mac_address : '';
        const linkedMac = linkedMacTop || linkedMacCred || '';
        if (linkedMac && linkedMac !== macValue) {
          res.status(409).json({ message: 'MAC address conflicts with linked miner registration.', conflictMinerKey: lm.miner_key });
          return;
        }
      }
    }
  }

  // Cross-miner exact MAC conflict (same collection only)
  const conflict = await col.findOne({
    miner_type: minerType,
    miner_key: { $ne: miner_key },
    $or: [{ miner_mac: macValue }, { 'credentials.mac_address': macValue }],
  });

  if (conflict) {
    res.status(409).json({ message: 'MAC address is already registered to another miner', conflictMinerKey: conflict.miner_key });
    return;
  }

  res.status(200).json({ message: 'Validation successful' });
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' });

  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    console.warn('[credentials/hardware/mac] no session for request, headers:', req.headers?.cookie ? 'has-cookie' : 'no-cookie');
    return res.status(401).json({ message: 'Unauthorized' });
  }

  const { miner_key, credentials, portal_type } = req.body;
  if (!miner_key || !credentials) {
    return res.status(400).json({ message: 'Missing required fields' });
  }

  const minerType = getMinerType(miner_key);
  const db = await getDb();

  try {
    await validateMac({
      res,
      db,
      session,
      miner_key,
      minerType,
      portalType: portal_type as string | undefined,
      credentials,
    });
  } catch (err) {
    console.error('MAC validation error:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
}