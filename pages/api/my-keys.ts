import type { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from './auth/[...nextauth]';
import clientPromise from '../../lib/mongoclient';
import { ObjectId } from 'mongodb';

interface IoTCredentials {
  [collection: string]: {
    miner_type?: string | null;
    api_type?: string | null;
    credentials: Record<string, unknown>;
    credentials_saved_at?: string | null;
    position?: unknown;
    position_saved_at?: string | null;
  };
}

interface DeviceEntry {
  miner_key: string;
  name?: string;
  nickname?: string;
  is_registered?: boolean;
  iotCredentials?: IoTCredentials;
}

interface MyKeysResponse {
  success: boolean;
  devices: DeviceEntry[];
  byodLicenses: string[];
}

const CRED_COLLECTIONS = [
  'hardware',
  'camera',
  'energy',
  'weather',
  'water',
  'air',
  'radiation',
];

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<MyKeysResponse | { success: false; message: string }>
) {
  const session = await getServerSession(req, res, authOptions);
  if (!session || !session.user?.address) {
    res.status(401).json({ success: false, message: 'Unauthorized' });
    return;
  }

  const testMode = process.env.NEXT_PUBLIC_TEST_MODE === 'true';
  const mainDbName = testMode ? 'test-main' : 'main';
  const credsDbName = 'creds';

  try {
    const client = await clientPromise;
    const mainDb = client.db(mainDbName);
    const credsDb = client.db(credsDbName);

    const query = { address: session.user.address };

    // 2. Find all devices for this wallet address
    const deviceDocsRaw = await mainDb
      .collection('devices')
      .find(query)
      .project({ miner_key: 1, name: 1, nickname: 1, user_id: 1, is_registered: 1 })
      .toArray();

    // Deduplicate by _id
    const seenIds = new Set<string>();
    const deviceDocs: any[] = [];
    for (const d of deviceDocsRaw) {
      const id = String(d._id);
      if (seenIds.has(id)) continue;
      seenIds.add(id);
      deviceDocs.push(d);
    }

    // 2. Collect unique user_ids for BYOD license lookup
    const userIds = new Set<string>();
    for (const d of deviceDocs) {
      if (d.user_id) {
        userIds.add(String(d.user_id));
      }
    }

    // 3. Fetch BYOD licenses from users collection
    const byodLicenses: string[] = [];
    if (userIds.size > 0) {
      const objectIds = Array.from(userIds).map((id) => new ObjectId(id));
      const userDocs = await mainDb
        .collection('registration-users')
        .find({ _id: { $in: objectIds } })
        .project({ byod: 1 })
        .toArray();

      for (const u of userDocs) {
        const licenses = u.byod?.licenses;
        if (Array.isArray(licenses)) {
          for (const lic of licenses) {
            if (typeof lic === 'string' && !byodLicenses.includes(lic)) {
              byodLicenses.push(lic);
            }
          }
        }
      }
    }

    // 4. Fetch IoT credentials for each device
    const devices: DeviceEntry[] = [];
    for (const d of deviceDocs) {
      const deviceEntry: DeviceEntry = {
        miner_key: String(d.miner_key ?? ''),
        name: d.name ? String(d.name) : undefined,
        nickname: d.nickname ? String(d.nickname) : undefined,
        is_registered: d.is_registered ?? false,
      };

      const minerKey = deviceEntry.miner_key;
      if (!minerKey) {
        devices.push(deviceEntry);
        continue;
      }

      const iotCredentials: IoTCredentials = {};
      for (const collectionName of CRED_COLLECTIONS) {
        try {
          const credDoc = await credsDb
            .collection(collectionName)
            .findOne({ miner_key: minerKey });

          if (credDoc) {
            iotCredentials[collectionName] = {
              miner_type: credDoc.miner_type ?? null,
              api_type: credDoc.api_type ?? null,
              credentials: credDoc.credentials ?? {},
              credentials_saved_at: credDoc.credentials_saved_at ?? null,
              position: credDoc.position ?? null,
              position_saved_at: credDoc.position_saved_at ?? null,
            };
          }
        } catch {
          // ignore per-collection errors
        }
      }

      if (Object.keys(iotCredentials).length > 0) {
        deviceEntry.iotCredentials = iotCredentials;
      }

      devices.push(deviceEntry);
    }

    res.status(200).json({ success: true, devices, byodLicenses });
  } catch (err: any) {
    console.error('[my-keys] error:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
}
