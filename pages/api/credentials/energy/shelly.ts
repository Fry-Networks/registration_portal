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

const normalizeServerUrl = (rawUrl: string) => {
  const trimmed = rawUrl.trim();
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
  const { res, db, session, miner_key, credentials } = params;

  const { authKey, serverURL, deviceId } = credentials ?? {};
  if (!authKey || !serverURL || deviceId === undefined || deviceId === null) {
    res.status(400).json(
      createApiError(
        ErrorCodes.INVALID_INPUT,
        'Missing Shelly credentials',
        'Please provide auth key, server URL, and device ID.'
      )
    );
    return;
  }

  const normalizedAuthKey = String(authKey).trim();
  const normalizedServerURL = normalizeServerUrl(String(serverURL));
  const normalizedDeviceId = String(deviceId).trim();

  if (!normalizedAuthKey || !normalizedServerURL || !normalizedDeviceId) {
    res.status(400).json(
      createApiError(
        ErrorCodes.INVALID_INPUT,
        'Invalid Shelly credentials',
        'Please double-check the entered values and try again.'
      )
    );
    return;
  }

  if (normalizedAuthKey.length < 10) {
    res.status(400).json(
      createApiError(
        ErrorCodes.INVALID_INPUT,
        'Shelly auth key is too short',
        'Please use the full auth key from the Shelly dashboard.'
      )
    );
    return;
  }

  const col = db.collection('energy');

  const deviceConflict = await col.findOne({
    miner_key: { $ne: miner_key },
    'credentials.deviceId': normalizedDeviceId,
    address: { $ne: session.user.address },
  });

  if (deviceConflict) {
    res.status(409).json(
      createApiError(
        ErrorCodes.INVALID_INPUT,
        'Shelly device is already linked to another user',
        'Please unlink the device from the other account or choose another device.',
        { conflictMinerKey: deviceConflict.miner_key }
      )
    );
    return;
  }

  const serverConflict = await col.findOne({
    miner_key: { $ne: miner_key },
    'credentials.authKey': normalizedAuthKey,
    'credentials.serverURL': normalizedServerURL,
    address: { $ne: session.user.address },
  });

  if (serverConflict) {
    res.status(409).json(
      createApiError(
        ErrorCodes.INVALID_INPUT,
        'Shelly server credentials are already linked to another user',
        'Please unlink the credentials from the other account before proceeding.',
        { conflictMinerKey: serverConflict.miner_key }
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
    loggers.apiError('/api/credentials/energy/shelly', new Error('Unauthenticated Shelly validation request'), {
      hasCookie: Boolean(req.headers?.cookie),
      issueType: 'SHELLY_VALIDATION_UNAUTHENTICATED',
      part: 'credentials.energy.shelly.auth',
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
    await validateShelly({
      res,
      db,
      session,
      miner_key,
      credentials,
      portalType: portal_type as string | undefined,
    });
  } catch (error) {
    handleApiError(res, '/api/credentials/energy/shelly', error, {
      response: createApiError(
        ErrorCodes.INTERNAL_ERROR,
        'Unable to validate Shelly credentials',
        'Please try again. If the problem persists, contact support.'
      ),
      minerKey: miner_key,
      walletAddress,
      issueType: 'SHELLY_VALIDATION_ERROR',
      part: 'credentials.energy.shelly.handler',
      metadata: {
        miner_key,
        address: walletAddress,
        portal_type,
      },
    });
  }
}
