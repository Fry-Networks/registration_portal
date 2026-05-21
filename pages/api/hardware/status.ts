import type { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import clientPromise from '../../../lib/mongoclient';
import { authOptions } from '../auth/[...nextauth]';
import { validateMacAddress } from '../../../lib/validators/macAddressValidator';
import { loggers } from '../../../lib/logger';
import {
  CommonErrors,
  createApiError,
  ErrorCodes,
  handleApiError,
} from '../../../lib/api-errors';

type HardwareStatus = {
  linked: boolean;
  valid: boolean;
  miner_mac?: string;
  reason?: 'missing_mac' | 'invalid_mac';
  detail?: string;
};

export type HardwareStatusResponse = {
  [minerKey: string]: HardwareStatus;
};

const HARDWARE_DB_NAME = process.env.MONGO_CREDS_DB ?? 'creds';
const HARDWARE_COLLECTION = process.env.MONGO_CREDS_COLLECTION ?? 'hardware';

const ENDPOINT = '/api/hardware/status';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json(
      createApiError(
        ErrorCodes.INVALID_INPUT,
        'That request is not available.',
        'Please retry this action from the dashboard.'
      )
    );
    return;
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session || !session.user?.address) {
    res.status(401).json(CommonErrors.noSession());
    return;
  }

  const { miner_keys: minerKeys } = req.body ?? {};
  if (!Array.isArray(minerKeys) || minerKeys.some((key) => typeof key !== 'string')) {
    res.status(400).json(
      createApiError(
        ErrorCodes.INVALID_INPUT,
        'miner_keys must be an array of strings',
        'Please provide the list of device miner keys you want to inspect.'
      )
    );
    return;
  }

  const uniqueKeys = Array.from(new Set(minerKeys.filter(Boolean)));
  if (uniqueKeys.length === 0) {
    res.status(200).json({});
    return;
  }

  try {
    const client = await clientPromise;
    const db = client.db(HARDWARE_DB_NAME);
    const collection = db.collection(HARDWARE_COLLECTION);

    const credentialDocs = await collection
      .find({ miner_key: { $in: uniqueKeys } })
      .toArray();

    const response: HardwareStatusResponse = {};

    for (const key of uniqueKeys) {
      const doc =
        credentialDocs.find(
          (item) => item.miner_key === key && item.address === session.user.address
        ) ?? credentialDocs.find((item) => item.miner_key === key);

      if (doc?.address && doc.address !== session.user.address) {
        response[key] = {
          linked: false,
          valid: false,
          reason: 'missing_mac',
        };
        continue;
      }

      if (!doc) {
        response[key] = {
          linked: false,
          valid: false,
          reason: 'missing_mac',
        };
        continue;
      }

      const credentials = (doc as Record<string, any>)?.credentials ?? {};
      const rawMac: unknown = credentials?.mac_address ?? credentials?.macAddress ?? credentials?.mac;
      const macValue = typeof rawMac === 'string' ? rawMac : undefined;
      const fallbackMac: unknown = (doc as Record<string, any>)?.miner_mac;
      const effectiveMac = macValue || (typeof fallbackMac === 'string' ? fallbackMac.trim() : undefined);
      if (!effectiveMac) {
        response[key] = {
          linked: true,
          valid: false,
          reason: 'missing_mac',
        };
        continue;
      }

      const validation = validateMacAddress(effectiveMac);
      if (!validation.valid) {
        response[key] = {
          linked: true,
          valid: false,
          miner_mac: effectiveMac,
          reason: 'invalid_mac',
          detail: validation.reason,
        };
        continue;
      }

      response[key] = {
        linked: true,
        valid: true,
        miner_mac: validation.normalized ?? effectiveMac,
      };
    }

    loggers.dbOperation('hardware_status_lookup', collection.collectionName, {
      address: session.user.address,
      requestedMinerKeys: uniqueKeys.length,
      matchedCredentials: credentialDocs.length,
    });

    res.status(200).json(response);
  } catch (error) {
    handleApiError(res, ENDPOINT, error, {
      response: createApiError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to load hardware credential status',
        'Please try again. If the problem persists, contact support.'
      ),
      walletAddress: session.user.address,
      issueType: 'HARDWARE_STATUS_ERROR',
      part: 'hardware.status.handler',
      metadata: {
        miner_keys: minerKeys,
        hardwareCollection: HARDWARE_COLLECTION,
      },
    });
  }
}
