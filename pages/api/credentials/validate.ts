// pages/api/credentials/validate.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import clientPromise from '../../../lib/mongoclient';

const DB_NAME = process.env.MONGO_CREDS_DB ?? 'creds';

// Coupled miner types
const LINKED_MINER_TYPES: Record<string, string[]> = {
  ISM: ['OSM'],
  OSM: ['ISM'],
  IDM: ['ODM'],
  ODM: ['IDM'],
};

// Map miner type → portal *key* (not collection). Collection is derived below.
const MINER_PORTAL_KEY: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  // air
  ['OHAQM', 'IHAQM', 'ILAQM'].forEach(t => (map[t] = 'air'));
  // camera
  ['AOWSCM', 'AOWCM', 'AIWCM', 'AOSCM', 'AISCM', 'AOTCM', 'AITCM', 'AIWSCM'].forEach(t => (map[t] = 'camera'));
  // weather
  ['HWM', 'LWM'].forEach(t => (map[t] = 'weather'));
  // water
  ['OLWQM', 'OHWQM'].forEach(t => (map[t] = 'water'));
  // energy, radiation, aem (aem → hardware)
  map['EM'] = 'energy';
  map['IRM'] = 'radiation';
  map['AEM'] = 'aem'; // not a named collection → hardware
  // misc passthroughs (will land in hardware)
  ['IDM', 'ODM', 'ISM', 'OSM', 'BM', 'CN', 'RDN', 'SDN', 'SVN'].forEach(t => (map[t] = t.toLowerCase()));
  return map;
})();

const NAMED_COLLECTIONS = new Set(['air', 'camera', 'energy', 'weather', 'water', 'radiation']);

const getMinerType = (miner_key?: string) => (miner_key ? String(miner_key).split('-')[0] : '');
const portalKeyFromMiner = (mk?: string) => MINER_PORTAL_KEY[getMinerType(mk)] ?? '';

/** Deterministic collection:
 *  - if portal_type ∈ {air, camera, energy, weather, water, radiation} → that collection
 *  - else infer portal key from miner_key; if in set → that collection
 *  - else → 'hardware'
 */
const collectionFor = (opts: { miner_key?: string; portalType?: string }) => {
  const { miner_key, portalType } = opts;
  const fromPortal = portalType ? String(portalType).toLowerCase() : '';
  if (NAMED_COLLECTIONS.has(fromPortal)) return fromPortal;
  const inferred = portalKeyFromMiner(miner_key);
  if (NAMED_COLLECTIONS.has(inferred)) return inferred;
  return 'hardware';
};

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

// MAC validator (mac/hardware/node)
const validateMac: Validator = async ({ res, db, session, miner_key, minerType, portalType, credentials }) => {
  const macValue: string | undefined =
    (credentials as any)?.mac_address ?? (credentials as any)?.miner_mac;

  if (!miner_key || typeof miner_key !== 'string') {
    res.status(400).json({ message: 'Missing miner_key' });
    return;
  }
  if (!macValue || typeof macValue !== 'string') {
    res.status(400).json({ message: 'Missing mac_address in credentials' });
    return;
  }

  const colName = collectionFor({ miner_key, portalType });
  const col = db.collection(colName);

  // Ownership check on THIS miner doc
  const existingMiner = await col.findOne({ miner_key });
  if (existingMiner && existingMiner.address && existingMiner.address !== session.user.address) {
    res.status(403).json({ message: 'Forbidden' });
    return;
  }

  // Linked miner MAC conflict check in the SAME collection (all “others” live in hardware)
  const linkedTypes = LINKED_MINER_TYPES[minerType] ?? [];
  if (linkedTypes.length > 0) {
    const suffix = String(miner_key).slice(minerType.length);
    const linkedMinerKeys = linkedTypes.map(t => `${t}${suffix}`).filter(k => k !== miner_key);
    if (linkedMinerKeys.length) {
      const linkedMiners = await col.find({ miner_key: { $in: linkedMinerKeys } }).toArray();
      for (const lm of linkedMiners) {
        const linkedMacTop = typeof lm.miner_mac === 'string' ? lm.miner_mac : '';
        const linkedMacCred = lm.credentials && typeof lm.credentials.mac_address === 'string' ? lm.credentials.mac_address : '';
        const linkedMac = linkedMacTop || linkedMacCred || '';
        if (linkedMac && linkedMac !== macValue) {
          res.status(409).json({ message: 'MAC address conflicts with linked miner registration.', conflictMinerKey: lm.miner_key });
          return;
        }
      }
    }
  }

  // Cross-miner exact MAC conflict (same collection only)
  const conflict = await col.findOne({
    miner_type: minerType,
    miner_key: { $ne: miner_key },
    $or: [{ miner_mac: macValue }, { 'credentials.mac_address': macValue }],
  });

  if (conflict) {
    res.status(409).json({ message: 'MAC address is already registered to another miner', conflictMinerKey: conflict.miner_key });
    return;
  }

  res.status(200).json({ message: 'Validation successful' });
};

// SwitchBot applies to energy: check ONLY the energy collection regardless of miner type
const validateSwitchbot: Validator = async ({ res, db, session, miner_key, credentials, portalType }) => {
  const { token, secret, deviceId } = credentials ?? {};
  if (!token || !secret || deviceId === undefined || deviceId === null) {
    res.status(400).json({ message: 'Missing SwitchBot credentials' });
    return;
  }
  const normalizedDeviceId = String(deviceId).trim();
  if (!normalizedDeviceId) {
    res.status(400).json({ message: 'Invalid SwitchBot deviceId' });
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
    res.status(409).json({
      message: 'SwitchBot device is already linked to another user',
      conflictMinerKey: conflict.miner_key,
    });
    return;
  }

  res.status(200).json({ message: 'Validation successful' });
};

const validateRtsp: Validator = async ({ req, res, credentials }) => {
  const { url, username, password } = credentials ?? {};
  if (!url) {
    res.status(400).json({ message: 'Missing RTSP URL' });
    return;
  }

  const baseUrl =
    process.env.NEXTAUTH_URL ||
    `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}`;

  const rtspRes = await fetch(`${baseUrl}/api/rtsp/check`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, username, password }),
  });

  if (!rtspRes.ok) {
    const details = await rtspRes.json().catch(() => ({}));
    res.status(400).json({ message: 'RTSP validation failed', details });
    return;
  }

  res.status(200).json({ message: 'Validation successful' });
};

const API_VALIDATORS: Record<string, Validator> = {
  mac: validateMac,
  hardware: validateMac,
  node: validateMac,
  switchbot: validateSwitchbot,
  rtsp: validateRtsp,
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