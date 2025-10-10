// pages/api/credentials/validate.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import clientPromise from '../../../lib/mongoclient';
import { getMinerType, collectionFor } from './utils';
import { deviceValidatorRegistry } from '../../../lib/validators';

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

// Fallback delegation for device types not yet migrated to the new validator system
const delegateToEndpoint = async (endpoint: string, req: NextApiRequest, res: NextApiResponse) => {
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

// Legacy endpoints that haven't been migrated to the new validator system yet
const LEGACY_DELEGATED_VALIDATORS: Record<string, string> = {
  rtsp: 'camera/rtsp',
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

  // If this is a aem/hardware/node check, delegate to the dedicated endpoint
  const lowerApiCheck = String(apiType).toLowerCase();
  if (lowerApiCheck === 'aem' || lowerApiCheck === 'hardware' || lowerApiCheck === 'node') {
    return await delegateToEndpoint('hardware/mac', req, res);
  }

  try {
    // ------------------
    // Uniqueness checks
    // ------------------
    // Ensure the submitted credential keys (rtsp_url, mac_address, miner_mac, imei, deviceId)
    // are not already present in the target creds collection under a different miner_key.
    try {
      const colName = collectionFor({ miner_key, portalType: portal_type });
      const checks: Array<{ field: string; value?: any }> = [];

      // Exceptions: switchbot and shelly only check deviceId
      const lowerApi = String(apiType).toLowerCase();
      if (lowerApi === 'switchbot' || lowerApi === 'shelly') {
        if (credentials?.deviceId) checks.push({ field: 'deviceId', value: credentials.deviceId });
      } else {
        // Skip MAC uniqueness here; MAC validation/ownership is handled by the
        // dedicated `pages/api/credentials/hardware/mac.ts` endpoint which
        // enforces ownership and linked-miner rules. Keep other uniqueness checks.
        if (credentials?.rtsp_url) checks.push({ field: 'rtsp_url', value: credentials.rtsp_url });
        if (credentials?.imei) checks.push({ field: 'imei', value: credentials.imei });
        if (credentials?.deviceId) checks.push({ field: 'deviceId', value: credentials.deviceId });
      }

      if (checks.length > 0) {
        for (const c of checks) {
          if (c.value === undefined || c.value === null || String(c.value).trim() === '') continue;
          try {
            const existing = await db.collection(colName).findOne({ [c.field]: c.value });
            if (existing) {
              const existingKey = existing.miner_key ?? null;
              if (String(existingKey) !== String(miner_key)) {
                return res.status(400).json({ message: 'Credential already registered', details: `${c.field} already exists in ${colName}` });
              }
            }
          } catch (e) {
            // ignore individual check errors but log
            console.warn('Uniqueness check failed for', c.field, 'in', colName, String((e as any)?.message || e));
          }
        }
      }
    } catch (e) {
      console.warn('Failed to run uniqueness checks for credentials validation', String((e as any)?.message || e));
      // continue to validation even if uniqueness checks fail
    }

    // Per workflow: for SwitchBot and Shelly we only need to run uniqueness checks
    // (done above) and do not perform extra calls to the provider API during
    // validation. Return success here to avoid touching external services.
    const lowerApiCheck = String(apiType).toLowerCase();
    if (lowerApiCheck === 'switchbot' || lowerApiCheck === 'shelly') {
      return res.status(200).json({
        message: 'Credentials validated successfully',
        success: true
      });
    }

    // Check if we have a modern validator for this device type
    const validator = deviceValidatorRegistry.getValidator(apiType);

    if (validator) {
      // Use the new validator system
      const validationContext = {
        session,
        minerKey: miner_key,
        currentDeviceId: credentials.deviceId
      };

      const result = await validator.validateCredentials(credentials, validationContext);

      if (!result.success) {
        return res.status(400).json({ 
          message: result.error || 'Validation failed',
          success: false
        });
      }

      return res.status(200).json({
        message: 'Credentials validated successfully',
        success: true,
        devices: result.devices,
        additionalData: result.additionalData
      });
    }

    // Check if this device type needs legacy delegation
    const legacyEndpoint = LEGACY_DELEGATED_VALIDATORS[apiType];
    if (legacyEndpoint) {
      return await delegateToEndpoint(legacyEndpoint, req, res);
    }

    // No special validation for this subtype → accept
    return res.status(200).json({ message: 'Validation successful' });

  } catch (err) {
    console.error('Validation error:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
}