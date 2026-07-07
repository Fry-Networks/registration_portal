import type { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import clientPromise from '../../../lib/mongoclient';
import { getMinerType, collectionFor } from '../../../lib/credentials-utils';
import { deviceValidatorRegistry } from '../../../lib/validators';
import { loggers } from '../../../lib/logger';
import {
  CommonErrors,
  createApiError,
  ErrorCodes,
  handleApiError,
} from '../../../lib/api-errors';

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
  } catch (error) {
    loggers.apiError('/api/credentials/validate#inferApiType', error, {
      miner_key,
      issueType: 'CREDENTIALS_INFER_API_TYPE_ERROR',
      part: 'credentials.validate.infer',
    });
  }
  return undefined;
};

type DelegateContext = {
  minerKey: string;
  walletAddress: string;
};
// -------------------- validator registry --------------------

// Fallback delegation for device types not yet migrated to the new validator system
const delegateToEndpoint = async (
  endpoint: string,
  req: NextApiRequest,
  res: NextApiResponse,
  context: DelegateContext
) => {
  const { minerKey, walletAddress } = context;
  const baseUrl =
    process.env.NEXTAUTH_URL ||
    `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}`;

  try {
    const delegateRes = await fetch(`${baseUrl}/api/credentials/${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: req.headers.cookie || '',
      },
      body: JSON.stringify(req.body),
    });

    const responseData = await delegateRes.json().catch(() => ({}));

    if (!delegateRes.ok) {
      res.status(delegateRes.status).json(responseData);
      return;
    }

    res.status(200).json(responseData);
  } catch (error) {
    handleApiError(res, `/api/credentials/${endpoint}`, error, {
      response: createApiError(
        ErrorCodes.INTERNAL_ERROR,
        'Credential validation failed during delegation',
        'Please try again. If the problem persists, contact support.'
      ),
      minerKey,
      walletAddress,
      issueType: 'CREDENTIALS_VALIDATE_DELEGATE_ERROR',
      part: `credentials.validate.delegate.${endpoint}`,
      metadata: {
        miner_key: minerKey,
        address: walletAddress,
        endpoint,
      },
    });
  }
};

// Legacy endpoints that haven't been migrated to the new validator system yet
const LEGACY_DELEGATED_VALIDATORS: Record<string, string> = {
  rtsp: 'camera/rtsp',
};

// -------------------- handler --------------------

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
    return res.status(401).json(CommonErrors.noSession());
  }
  const walletAddress = session.user.address;

  const { miner_key, api_type, subtype, credentials, portal_type } = req.body;
  if (!miner_key || !credentials) {
    return res.status(400).json(
      createApiError(
        ErrorCodes.INVALID_INPUT,
        'Missing required fields',
        'Please provide the miner key and credentials.'
      )
    );
  }

  // prefer api_type (new), fall back to legacy 'subtype'
  let apiType: string | undefined = (api_type ?? subtype) as string | undefined;
  if (!apiType) {
    apiType = await inferApiTypeFromCreds({ miner_key, credentials, portalType: portal_type });
  }
  if (!apiType) {
    return res.status(400).json(
      createApiError(
        ErrorCodes.INVALID_INPUT,
        'Unable to determine credential type',
        'Please specify the credential subtype and try again.'
      )
    );
  }
  apiType = String(apiType).toLowerCase();

  const minerType = getMinerType(miner_key);
  const db = await getDb();

  // If this is a aem/hardware/node check, delegate to the dedicated endpoint
  const normalizedApiType = String(apiType).toLowerCase();
  if (['aem', 'fem', 'hardware', 'node'].includes(normalizedApiType)) {
    return delegateToEndpoint('hardware/mac', req, res, {
      minerKey: miner_key,
      walletAddress,
    });
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
      if (normalizedApiType === 'switchbot' || normalizedApiType === 'shelly') {
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
                return res.status(400).json(
                  createApiError(
                    ErrorCodes.INVALID_INPUT,
                    'Credential already registered',
                    'Please unlink the credential from the other device first.',
                    { field: c.field, collection: colName }
                  )
                );
              }
            }
          } catch (error) {
            loggers.apiError('/api/credentials/validate', error, {
              field: c.field,
              collection: colName,
              miner_key,
              issueType: 'CREDENTIALS_VALIDATE_UNIQUENESS_ERROR',
              part: 'credentials.validate.uniqueness',
            });
          }
        }
      }
    } catch (error) {
      loggers.apiError('/api/credentials/validate', error, {
        miner_key,
        issueType: 'CREDENTIALS_VALIDATE_UNIQUENESS_FAILURE',
        part: 'credentials.validate.uniquenessWrapper',
      });
      // continue to validation even if uniqueness checks fail
    }

    // Per workflow: for SwitchBot and Shelly we only need to run uniqueness checks
    // (done above) and do not perform extra calls to the provider API during
    // validation. Return success here to avoid touching external services.
    if (normalizedApiType === 'switchbot' || normalizedApiType === 'shelly') {
      return res.status(200).json({
        message: 'Credentials validated successfully',
        success: true,
      });
    }

    // Check if we have a modern validator for this device type
    const validator = deviceValidatorRegistry.getValidator(normalizedApiType);

  if (validator) {
      // Use the new validator system
      const validationContext = {
        session,
        minerKey: miner_key,
        currentDeviceId: credentials.deviceId,
      };

      const result = await validator.validateCredentials(credentials, validationContext);

      if (!result.success) {
        return res.status(400).json(
          createApiError(
            ErrorCodes.INVALID_INPUT,
            result.error || 'Validation failed',
            'Please review the entered credentials and try again.'
          )
        );
      }

      return res.status(200).json({
        message: 'Credentials validated successfully',
        success: true,
        ...(result.additionalData ?? {}),
      });
    }

    // Legacy fallback: delegate to specific validator endpoints if registered
    if (LEGACY_DELEGATED_VALIDATORS[normalizedApiType]) {
      return delegateToEndpoint(LEGACY_DELEGATED_VALIDATORS[normalizedApiType], req, res, {
        minerKey: miner_key,
        walletAddress,
      });
    }

    // If no validator is found, return success with warning (legacy behavior)
    loggers.apiError('/api/credentials/validate', new Error('No validator found for api_type'), {
      miner_key,
      api_type: normalizedApiType,
      minerType,
      issueType: 'CREDENTIALS_VALIDATE_NO_VALIDATOR',
      part: 'credentials.validate.noValidator',
    });

    res.status(200).json({
      message: 'Credentials validated successfully',
      warning: 'No validator was available. Please ensure details are correct.',
      success: true,
    });
  } catch (error) {
  handleApiError(res, '/api/credentials/validate', error, {
      response: createApiError(
        ErrorCodes.INTERNAL_ERROR,
        'Unable to validate credentials',
        'Please try again. If the problem persists, contact support.'
      ),
      minerKey: miner_key,
      walletAddress,
      issueType: 'CREDENTIALS_VALIDATE_ERROR',
      part: 'credentials.validate.handler',
      metadata: {
        miner_key,
        address: walletAddress,
        api_type: normalizedApiType,
        minerType,
      },
    });
  }
}

