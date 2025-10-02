// pages/api/credentials/validate.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import clientPromise from '../../../lib/mongoclient';

const HARDWARE_DB_NAME = process.env.MONGO_CREDS_DB ?? 'creds';
const PORTAL_CREDS_COLLECTION = process.env.MONGO_PORTAL_CREDS_COLLECTION ?? 'portal_creds';
const LINKED_MINER_TYPES: Record<string, string[]> = {
  ISM: ['OSM'],
  OSM: ['ISM'],
  IDM: ['ODM'],
  ODM: ['IDM'],
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    console.warn('[credentials/validate] no session for request, headers:', req.headers?.cookie ? 'has-cookie' : 'no-cookie');
    return res.status(401).json({ message: 'Unauthorized' });
  }

  // prefer api_type (new), fall back to legacy 'subtype'
  const { miner_key, api_type, subtype, credentials, portal_type } = req.body;
  let apiType = (api_type ?? subtype) as string | undefined;
  const portalType = portal_type as string | undefined;

  if (!miner_key || !credentials) {
    return res.status(400).json({ message: 'Missing required fields' });
  }

  // If apiType is not provided, try to infer it from provided credential keys
  // (e.g., mac_address -> mac) or from an existing portal_creds entry for the miner_key.
  if (!apiType) {
    const creds = credentials as Record<string, any>;
    if (creds?.mac_address || creds?.miner_mac) {
      apiType = 'mac';
    } else if (creds?.token && creds?.secret && (creds?.deviceId || creds?.deviceId === 0)) {
      apiType = 'switchbot';
    } else if (creds?.url || creds?.serverUrl) {
      apiType = 'rtsp';
    } else {
      // last resort: look up stored portal creds to see if an api_type or collection exists
      try {
        const dbClient = await clientPromise;
        const db = dbClient.db(HARDWARE_DB_NAME);
        const portalCol = db.collection(PORTAL_CREDS_COLLECTION);
        const existing = await portalCol.findOne({ miner_key });
        if (existing) {
          if (existing.api_type) apiType = String(existing.api_type).toLowerCase();
          else if (existing.collection) {
            // collection 'hardware' implies mac/node style entries
            const c = String(existing.collection).toLowerCase();
            if (c === 'hardware' || c === 'node' || c === 'devices') apiType = 'mac';
            else apiType = c;
          } else if (existing.portal) {
            apiType = String(existing.portal).toLowerCase();
          }
        }
      } catch (err) {
        console.error('[credentials/validate] failed to infer api_type from DB', err);
      }
    }
  }

  if (!apiType) {
    return res.status(400).json({ message: 'Missing required api_type and unable to infer subtype' });
  }

  try {
    // mac address validation + conflict checks
    if (apiType === 'mac' || apiType === 'hardware' || apiType === 'node') {
      const { miner_key } = req.body ?? {};
      const macRaw = (credentials as any)?.mac_address ?? (credentials as any)?.miner_mac ?? '';

      //console.log('[credentials/validate] mac validation requested', { miner_key, mac: macRaw });

      if (!miner_key || typeof miner_key !== 'string') {
        return res.status(400).json({ message: 'Missing miner_key' });
      }

      if (!macRaw || typeof macRaw !== 'string') {
        //console.log('[credentials/validate] mac validation failed: missing mac_address');
        return res.status(400).json({ message: 'Missing mac_address in credentials' });
      }

  // Use the MAC exactly as provided by the frontend (no trimming/normalizing)
  const macValue = macRaw as string;
  const [minerType = ''] = String(miner_key).split('-');

  // DB checks (read-only)
  const client = await clientPromise;
  const db = client.db(HARDWARE_DB_NAME);

      // Decide which collections to query. If portalType is specified, prefer that collection
      // (e.g., 'energy' for energy portal). If portalType === 'hardware' use legacy hardware collection.
      // If no portalType is provided, fall back to checking the configured portal creds collection and legacy hardware.
      const collectionsToCheck: string[] = portalType
        ? [portalType === 'hardware' ? 'hardware' : String(portalType).toLowerCase()]
        : [PORTAL_CREDS_COLLECTION, 'hardware'];

      const findOneAcross = async (query: any) => {
        for (const colName of collectionsToCheck) {
          try {
            const col = db.collection(colName);
            const doc = await col.findOne(query);
            if (doc) return doc;
          } catch (err) {
            // ignore collection access errors and continue
          }
        }
        return null;
      };

      const findManyAcross = async (query: any) => {
        const results: any[] = [];
        for (const colName of collectionsToCheck) {
          try {
            const col = db.collection(colName);
            const docs = await col.find(query).toArray();
            results.push(...docs);
          } catch (err) {
            // ignore and continue
          }
        }
        return results;
      };

      // Ownership check: if there's an existing entry for this miner owned by another address, forbid
      const existingMiner = await findOneAcross({ miner_key });
      if (existingMiner && existingMiner.address && existingMiner.address !== session.user.address) {
        return res.status(403).json({ message: 'Forbidden' });
      }

  const linkedTypes = LINKED_MINER_TYPES[minerType] ?? [];
      if (linkedTypes.length > 0) {
        const minerKeySuffix = String(miner_key).slice(minerType.length);
        const linkedMinerKeys = linkedTypes
          .map((linkedType) => `${linkedType}${minerKeySuffix}`)
          .filter((k) => k !== miner_key);

        if (linkedMinerKeys.length > 0) {
          const linkedMiners = await findManyAcross({ miner_key: { $in: linkedMinerKeys } });
          for (const linkedMiner of linkedMiners) {
            const linkedMacTop = typeof linkedMiner.miner_mac === 'string' ? linkedMiner.miner_mac : '';
            const linkedMacCred = linkedMiner.credentials && typeof linkedMiner.credentials.mac_address === 'string' ? linkedMiner.credentials.mac_address : '';
            const linkedMac = linkedMacTop || linkedMacCred || '';
            if (linkedMac && linkedMac !== macValue) {
              return res.status(409).json({ message: 'MAC address conflicts with linked miner registration.', conflictMinerKey: linkedMiner.miner_key });
            }
          }
        }
      }

      // Exact match against stored miner_mac OR credentials.mac_address (some entries store MAC in credentials)
      const macQuery: any = {
        miner_type: minerType,
        miner_key: { $ne: miner_key },
        $or: [
          { miner_mac: macValue },
          { 'credentials.mac_address': macValue }
        ]
      };

      // If portalType is provided and it's not the legacy hardware collection, and apiType is present,
      // restrict by api_type so energy+switchbot will only look within the energy collection and filter by switchbot.
      if (portalType && portalType !== 'hardware' && apiType) {
        macQuery.api_type = apiType;
      }

      const conflictingMac = await findOneAcross(macQuery);

      if (conflictingMac) {
        return res.status(409).json({ message: 'MAC address is already registered to another miner', conflictMinerKey: conflictingMac.miner_key });
      }

      //console.log('[credentials/validate] mac validation OK', { miner_key, mac: macValue });
      return res.status(200).json({ message: 'Validation successful' });
    }

    if (apiType === 'switchbot') {
      const { token, secret, deviceId } = credentials;
      if (!token || !secret || !deviceId) {
        //console.log('[credentials/validate] switchbot validation failed: missing fields', { deviceIdPresent: !!deviceId, tokenLen: token ? token.length : 0 });
        return res.status(400).json({ message: 'Missing SwitchBot credentials' });
      }

      //console.log('[credentials/validate] switchbot validation requested', { deviceId });

      // Validate SwitchBot credentials via internal endpoint
      const baseUrl =
        process.env.NEXTAUTH_URL ||
        `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}`;
      const switchbotRes = await fetch(`${baseUrl}/api/energy/switchbot-devices`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, secret }),
      });

      if (!switchbotRes.ok) {
        const err = await switchbotRes.json().catch(() => ({}));
        return res.status(400).json({
          message: 'SwitchBot validation failed',
          details: err,
        });
      }
    }

  if (apiType === 'rtsp') {
      const { url, username, password } = credentials;
      if (!url) {
        //console.log('[credentials/validate] rtsp validation failed: missing url');
        return res.status(400).json({ message: 'Missing RTSP URL' });
      }

      //console.log('[credentials/validate] rtsp validation requested', { urlPresent: !!url, usernamePresent: !!username });

      const baseUrl =
        process.env.NEXTAUTH_URL ||
        `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}`;
      const rtspRes = await fetch(`${baseUrl}/api/rtsp/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, username, password }),
      });

      if (!rtspRes.ok) {
        const err = await rtspRes.json().catch(() => ({}));
        return res.status(400).json({
          message: 'RTSP validation failed',
          details: err,
        });
      }
    }

    // Other subtype validations can go here…

    return res.status(200).json({ message: 'Validation successful' });
  } catch (err) {
    console.error('Validation error:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
}