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
  device_mac?: string;
  mac_match?: boolean;
  mac_last_changed?: string;
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

    // DEAD PATH -- DO NOT TRUST THIS BLOCK. Verified on ARES00 2026-09-22:
    // getCollectionNames() on database 'main' returns no collection named 'PoC'
    // (it lists hardware, poc_reward_dailies, poc_reward_daily and the fixture
    // test_poc_reward_dailies -- no 'PoC'). MongoDB does not error on a find()
    // against a missing collection, so the catch below never fires: the cursor just
    // comes back empty, pocDocs stays {}, and the three fields fed from it below
    // (device_mac, mac_last_changed, mac_match at lines ~187-201) are silently omitted
    // from every response. miner_mac is unaffected: it comes from the creds doc.
    // The comment this replaced named the source 'main.PoC.hardware'; no such
    // collection is present.
    //
    // The real device-reported MAC evidence lives in the PoC *database*:
    // client.db('PoC').collection('hardware'). See the header block in
    // lib/rewards/pocEvidence.ts for the full three-way naming gotcha.
    //
    // TO FIX (a real behaviour change -- deliberately NOT done in this comment-only
    // pass): repoint to client.db('PoC').collection('hardware'), confirm the mac.*
    // subdocument shape there actually matches the projection below before trusting
    // mac_match, and add a test that fails when the lookup yields nothing instead of
    // letting the omission pass silently.
    let pocDocs: Record<string, any> = {};
    try {
      const mainDb = client.db('main');
      const pocCollection = mainDb.collection('PoC');
      const pocCursor = await pocCollection
        .find(
          { miner_key: { $in: uniqueKeys } },
          {
            projection: {
              miner_key: 1,
              'mac.status': 1,
              'mac.last_changed_at': 1,
              'mac.evidence.miner_mac': 1,
              'mac.evidence.registered_mac': 1,
            },
          }
        )
        .toArray();
      pocDocs = Object.fromEntries(pocCursor.map((d) => [d.miner_key, d]));
    } catch (pocError) {
      loggers.dbOperation('hardware_status_poc_lookup_failed', 'PoC', {
        address: session.user.address,
        error: (pocError as Error)?.message,
      });
      // Continue without PoC data — new fields will be omitted
    }

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

      const baseResponse: HardwareStatus = {
        linked: true,
        valid: true,
        miner_mac: validation.normalized ?? effectiveMac,
      };

      // Enrich with PoC.hardware data if available
      const pocDoc = pocDocs[key];
      if (pocDoc) {
        const evidence = pocDoc?.mac?.evidence ?? {};
        const deviceMac = typeof evidence.miner_mac === 'string' ? evidence.miner_mac.trim() : undefined;
        const lastChanged = pocDoc?.mac?.last_changed_at;

        if (deviceMac) {
          baseResponse.device_mac = deviceMac;
        }
        if (lastChanged) {
          baseResponse.mac_last_changed = lastChanged;
        }
        if (deviceMac && baseResponse.miner_mac) {
          baseResponse.mac_match = deviceMac.toUpperCase() === baseResponse.miner_mac.toUpperCase();
        }
      }

      response[key] = baseResponse;
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
