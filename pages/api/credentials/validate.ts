// pages/api/credentials/validate.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import clientPromise from '../../../lib/mongoclient';
import { getMinerType, collectionFor } from './utils';

const DB_NAME = process.env.MONGO_CREDS_DB ?? 'creds';

const getDb = async () => {
  const client = await clientPromise;
  return client.db(DB_NAME);
};

// Infer api_type if omitted (from creds or existing doc in its collection, falling back to hardware)
const inferApiTypeFromCreds = async (params: {
  miner_key: string;
  credentials: Record<string, any>;
  portalType?: string;
}): Promise<string | undefined> => {
  const { miner_key, credentials, portalType } = params;

  // From credential shape
  if (credentials?.mac_address || credentials?.miner_mac) return 'mac';
  if (credentials?.token && credentials?.secret && (credentials?.deviceId || credentials?.deviceId === 0)) return 'switchbot';
  if (credentials?.authKey && credentials?.serverURL && (credentials?.deviceId || credentials?.deviceId === 0)) return 'shelly';
  if (credentials?.url || credentials?.serverUrl) return 'rtsp';

  // From stored doc (first in deterministic collection; then try hardware as a fallback)
  try {
    const db = await getDb();
    const primaryCol = collectionFor({ miner_key, portalType });
    const tryCols = primaryCol === 'hardware' ? ['hardware'] : [primaryCol, 'hardware'];

    for (const colName of tryCols) {
      const existing = await db.collection(colName).findOne({ miner_key });
      if (existing) {
        if (existing.api_type) return String(existing.api_type).toLowerCase();
        if (existing.collection) {
          const c = String(existing.collection).toLowerCase();
          if (['hardware', 'node', 'devices'].includes(c)) return 'mac';
          return c;
        }
        if (existing.portal) return String(existing.portal).toLowerCase();
      }
    }
  } catch {
    // ignore
  }
  return undefined;
};

// -------------------- validator registry --------------------

type ValidatorCtx = {
  req: NextApiRequest;
  res: NextApiResponse;
  db: any;
  session: any;
  miner_key: string;
  minerType: string;
  apiType: string;
  portalType?: string;
  credentials: Record<string, any>;
};

type Validator = (ctx: ValidatorCtx) => Promise<void>;

// Delegate validators: redirect to specific endpoints
const delegateToEndpoint = (endpoint: string): Validator => async ({ req, res }) => {
  const baseUrl =
    process.env.NEXTAUTH_URL ||
    `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}`;

  try {
    const delegateRes = await fetch(`${baseUrl}/api/credentials/${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': req.headers.cookie || '',
      },
      body: JSON.stringify(req.body),
    });

    const responseData = await delegateRes.json().catch(() => ({}));
    
    if (!delegateRes.ok) {
      return res.status(delegateRes.status).json(responseData);
    }

    res.status(200).json(responseData);
  } catch (error) {
    console.error(`Error delegating to ${endpoint}:`, error);
    res.status(500).json({ message: 'Internal server error during delegation' });
  }
};

const API_VALIDATORS: Record<string, Validator> = {
  mac: delegateToEndpoint('hardware/mac'),
  hardware: delegateToEndpoint('hardware/mac'),
  node: delegateToEndpoint('hardware/mac'),
  switchbot: delegateToEndpoint('energy/switchbot'),
  shelly: delegateToEndpoint('energy/shelly'),
  rtsp: delegateToEndpoint('camera/rtsp'),
};

// -------------------- handler --------------------

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' });

  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    console.warn('[credentials/validate] no session for request, headers:', req.headers?.cookie ? 'has-cookie' : 'no-cookie');
    return res.status(401).json({ message: 'Unauthorized' });
  }

  const { miner_key, api_type, subtype, credentials, portal_type } = req.body;
  if (!miner_key || !credentials) {
    return res.status(400).json({ message: 'Missing required fields' });
  }

  // prefer api_type (new), fall back to legacy 'subtype'
  let apiType: string | undefined = (api_type ?? subtype) as string | undefined;
  if (!apiType) {
    apiType = await inferApiTypeFromCreds({ miner_key, credentials, portalType: portal_type });
  }
  if (!apiType) {
    return res.status(400).json({ message: 'Missing required api_type and unable to infer subtype' });
  }
  apiType = String(apiType).toLowerCase();

  const minerType = getMinerType(miner_key);
  const db = await getDb();

  try {
    const validator = API_VALIDATORS[apiType];
    if (!validator) {
      // No special validation for this subtype → accept
      return res.status(200).json({ message: 'Validation successful' });
    }

    await validator({
      req,
      res,
      db,
      session,
      miner_key,
      minerType,
      apiType,
      portalType: portal_type as string | undefined,
      credentials,
    });

    // validators handle the response
  } catch (err) {
    console.error('Validation error:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
}