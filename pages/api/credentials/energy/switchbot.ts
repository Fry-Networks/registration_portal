// pages/api/credentials/energy/switchbot.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../auth/[...nextauth]';
import clientPromise from '../../../../lib/mongoclient';
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
    res.status(400).json(
      createApiError(
        ErrorCodes.INVALID_INPUT,
        'Missing SwitchBot credentials',
        'Please provide token, secret, and device ID.'
      )
    );
    return;
  }
  const normalizedDeviceId = String(deviceId).trim();
  if (!normalizedDeviceId) {
    res.status(400).json(
      createApiError(
        ErrorCodes.INVALID_INPUT,
        'Invalid SwitchBot device ID',
        'Please double-check the device ID and try again.'
      )
    );
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
    res.status(409).json(
      createApiError(
        ErrorCodes.INVALID_INPUT,
        'SwitchBot device is already linked to another user',
        'Please unlink the device from the other account or choose another device.',
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
    loggers.apiError('/api/credentials/energy/switchbot', new Error('Unauthenticated SwitchBot validation request'), {
      hasCookie: Boolean(req.headers?.cookie),
      issueType: 'SWITCHBOT_VALIDATION_UNAUTHENTICATED',
      part: 'credentials.energy.switchbot.auth',
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
  } catch (error) {
    handleApiError(res, '/api/credentials/energy/switchbot', error, {
      response: createApiError(
        ErrorCodes.INTERNAL_ERROR,
        'Unable to validate SwitchBot credentials',
        'Please try again. If the problem persists, contact support.'
      ),
      minerKey: miner_key,
      walletAddress,
      issueType: 'SWITCHBOT_VALIDATION_ERROR',
      part: 'credentials.energy.switchbot.handler',
      metadata: {
        miner_key,
        address: walletAddress,
        portal_type,
      },
    });
  }
}
