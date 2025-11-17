// pages/api/credentials/hardware/mac.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../auth/[...nextauth]';
import clientPromise from '../../../../lib/mongoclient';
import { LINKED_MINER_TYPES, getMinerType, collectionFor } from '../../../../lib/credentials-utils';
import { loggers } from '../../../../lib/logger';
import {
  CommonErrors,
  createApiError,
  ErrorCodes,
  handleApiError,
} from '../../../../lib/api-errors';

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
    res.status(400).json(
      createApiError(
        ErrorCodes.INVALID_INPUT,
        'Miner key is required',
        'Please provide the miner key and try again.'
      )
    );
    return;
  }
  if (!macValue || typeof macValue !== 'string') {
    res.status(400).json(
      createApiError(
        ErrorCodes.INVALID_INPUT,
        'Missing MAC address in credentials',
        'Please include the MAC address for this device.'
      )
    );
    return;
  }

  const colName = collectionFor({ miner_key, portalType });
  const col = db.collection(colName);

  // Ownership check on THIS miner doc
  const existingMiner = await col.findOne({ miner_key });
  if (existingMiner && existingMiner.address && existingMiner.address !== session.user.address) {
    res.status(403).json(
      createApiError(
        ErrorCodes.FORBIDDEN,
        'This device belongs to a different wallet',
        'Please sign in with the wallet that owns this device or ask support to unregister it and retry.'
      )
    );
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
          res.status(409).json(
            createApiError(
              ErrorCodes.INVALID_INPUT,
              'MAC address conflicts with linked miner registration',
              'Please unlink the MAC from the linked miner first.',
              { conflictMinerKey: lm.miner_key }
            )
          );
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
    res.status(409).json(
      createApiError(
        ErrorCodes.INVALID_INPUT,
        'MAC address is already registered to another miner',
        'Please choose a different device or unlink the existing registration.',
        { conflictMinerKey: conflict.miner_key }
      )
    );
    return;
  }

  res.status(200).json({ message: 'Validation successful' });
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json(
      createApiError(
        ErrorCodes.INVALID_INPUT,
        'That request is not available.',
        'Please retry this action from the dashboard.'
      )
    );
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session || !session.user?.address) {
    loggers.apiError('/api/credentials/hardware/mac', new Error('Unauthenticated MAC validation request'), {
      hasCookie: Boolean(req.headers?.cookie),
      issueType: 'MAC_VALIDATION_UNAUTHENTICATED',
      part: 'credentials.hardware.mac.auth',
    });
    return res.status(401).json(CommonErrors.noSession());
  }
  const walletAddress = session.user.address;

  const { miner_key, credentials, portal_type } = req.body;
  if (!miner_key || !credentials) {
    return res.status(400).json(
      createApiError(
        ErrorCodes.INVALID_INPUT,
        'Missing required fields',
        'Please provide the miner key and credentials.'
      )
    );
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
  } catch (error) {
    handleApiError(res, '/api/credentials/hardware/mac', error, {
      response: createApiError(
        ErrorCodes.INTERNAL_ERROR,
        'Unable to validate MAC credentials',
        'Please try again. If the problem persists, contact support.'
      ),
      minerKey: miner_key,
      walletAddress,
      issueType: 'MAC_VALIDATION_ERROR',
      part: 'credentials.hardware.mac.handler',
      metadata: {
        miner_key,
        address: walletAddress,
        portal_type,
      },
    });
  }
}
