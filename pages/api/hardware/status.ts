import type { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import clientPromise from '../../../lib/mongoclient';
import { authOptions } from '../auth/[...nextauth]';
import { validateMacAddress } from '../../../lib/validators/macAddressValidator';

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

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ message: 'Method Not Allowed' });
    return;
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session || !session.user?.address) {
    res.status(401).json({ message: 'Unauthorized' });
    return;
  }

  const { miner_keys: minerKeys } = req.body ?? {};
  if (!Array.isArray(minerKeys) || minerKeys.some((key) => typeof key !== 'string')) {
    res.status(400).json({ message: 'miner_keys must be an array of strings' });
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

      if (!macValue) {
        response[key] = {
          linked: true,
          valid: false,
          reason: 'missing_mac',
        };
        continue;
      }

      const validation = validateMacAddress(macValue);
      if (!validation.valid) {
        response[key] = {
          linked: true,
          valid: false,
          miner_mac: macValue,
          reason: 'invalid_mac',
          detail: validation.reason,
        };
        continue;
      }

      response[key] = {
        linked: true,
        valid: true,
        miner_mac: validation.normalized ?? macValue,
      };
    }

    res.status(200).json(response);
  } catch (error) {
    console.error('[hardware/status] error', error);
    res.status(500).json({ message: 'Failed to load hardware status' });
  }
}
