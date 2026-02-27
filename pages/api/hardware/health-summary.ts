import type { NextApiRequest, NextApiResponse } from 'next';
import clientPromise from '../../../lib/mongoclient';
import { enforceWalletApiSecurity } from '../../../lib/api/enforceWalletSecurity';
import { createApiError, ErrorCodes, handleApiError } from '../../../lib/api-errors';
import { isDeviceHealthSupported } from '../../../lib/minerKeyCategories';
import { enforceOperationRateLimit } from '../../../lib/api/operationRateLimit';

type HealthSummary = {
  available: boolean;
  status: 'online' | 'offline' | 'unknown';
  uptimePercent24h: number | null;
  downtimeDetected: boolean;
  macStatus: boolean | null;
  polStatus: boolean | null;
  poiStatus: boolean | null;
  toolsActive: number | null;
  lastUpdated: string | null;
};

type TelemetryDoc = {
  miner_key?: string;
  uptime?: {
    status?: string;
    uptime_seconds_24h?: number;
    downtime_seconds_24h?: number;
  };
  mac?: {
    status?: boolean;
  };
  pol?: {
    status?: boolean;
  };
  rewards?: Record<string, any>;
  lastUpdated?: string;
};

const TEST_MODE = process.env.NEXT_PUBLIC_TEST_MODE === 'true';
const POC_DB_NAME = process.env.MONGO_POC_DB ?? 'PoC';
const POC_COLLECTION = process.env.MONGO_POC_COLLECTION ?? 'hardware';
const MAIN_DB_NAME = 'main';
const DEVICES_COLLECTION = TEST_MODE ? 'test-devices' : 'devices';
const ENDPOINT = '/api/hardware/health-summary';
const ensuredIndexes = new Set<string>();

const clampPercent = (value: number): number => Math.min(100, Math.max(0, value));
const clampToolsCount = (value: number): number => Math.min(3, Math.max(0, value));

const ensureTelemetryIndexes = async (client: Awaited<typeof clientPromise>) => {
  const key = `${POC_DB_NAME}.${POC_COLLECTION}`;
  if (ensuredIndexes.has(key)) return;
  // Ensure miner_key lookup stays fast for health summaries.
  await client
    .db(POC_DB_NAME)
    .collection(POC_COLLECTION)
    .createIndex({ miner_key: 1 }, { name: 'telemetry_miner_key' });
  ensuredIndexes.add(key);
};

const extractLatestToolsCount = (rewards: Record<string, any> | undefined): number | null => {
  if (!rewards || typeof rewards !== 'object') {
    return null;
  }
  const dayKeys = Object.keys(rewards).sort().reverse();
  for (const dayKey of dayKeys) {
    const dayEntry = rewards[dayKey];
    if (!dayEntry || typeof dayEntry !== 'object') continue;
    const hourKeys = Object.keys(dayEntry).sort((a, b) => Number(b) - Number(a));
    for (const hourKey of hourKeys) {
      const slots = dayEntry[hourKey]?.slots;
      if (!Array.isArray(slots)) continue;
      for (let index = slots.length - 1; index >= 0; index -= 1) {
        const slot = slots[index];
        if (!slot || typeof slot !== 'object') continue;
        const rawCount =
          typeof slot.tools_count === 'number'
            ? slot.tools_count
            : Array.isArray(slot.tools_active)
              ? slot.tools_active.length
              : null;
        if (typeof rawCount === 'number' && Number.isFinite(rawCount)) {
          // Clamp to the 0-3 range to avoid UI spikes from malformed telemetry.
          return clampToolsCount(rawCount);
        }
      }
    }
  }
  return null;
};

const extractLatestPoiStatus = (rewards: Record<string, any> | undefined): boolean | null => {
  if (!rewards || typeof rewards !== 'object') {
    return null;
  }
  // AEM POI lives on slot gates, so scan from the most recent slot.
  const dayKeys = Object.keys(rewards).sort().reverse();
  for (const dayKey of dayKeys) {
    const dayEntry = rewards[dayKey];
    if (!dayEntry || typeof dayEntry !== 'object') continue;
    const hourKeys = Object.keys(dayEntry).sort((a, b) => Number(b) - Number(a));
    for (const hourKey of hourKeys) {
      const slots = dayEntry[hourKey]?.slots;
      if (!Array.isArray(slots)) continue;
      for (let index = slots.length - 1; index >= 0; index -= 1) {
        const slot = slots[index];
        if (!slot || typeof slot !== 'object') continue;
        if (typeof slot.gates?.poi === 'boolean') {
          return slot.gates.poi;
        }
      }
    }
  }
  return null;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
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

  const security = await enforceWalletApiSecurity(req, res, {
    endpoint: ENDPOINT,
    minerKey: 'device-health-summary'
  });
  if (!security) {
    return;
  }

  const { miner_keys: minerKeys } = req.body ?? {};
  if (!Array.isArray(minerKeys) || minerKeys.some((key) => typeof key !== 'string')) {
    res.status(400).json(
      createApiError(
        ErrorCodes.INVALID_INPUT,
        'miner_keys must be an array of strings',
        'Provide the device miner keys you want to inspect.'
      )
    );
    return;
  }

  const uniqueKeys = Array.from(new Set(minerKeys.filter(Boolean)));
  if (uniqueKeys.length === 0) {
    res.status(200).json({ success: true, summaries: {} });
    return;
  }

  const walletAddress = security.session.user.address;

  try {
    const rate = await enforceOperationRateLimit({
      req,
      res,
      action: 'device-health-summary',
      minerKey: 'device-health-summary',
      address: walletAddress
    });
    if (!rate.allowed) {
      return;
    }

    const client = await clientPromise;
    const devices = await client
      .db(MAIN_DB_NAME)
      .collection<{ miner_key?: string }>(DEVICES_COLLECTION)
      .find({ address: walletAddress, miner_key: { $in: uniqueKeys } })
      .project({ miner_key: 1 })
      .toArray();

    const ownedKeys = devices
      .map((device) => (device.miner_key ? String(device.miner_key) : ''))
      .filter(Boolean);
    const healthKeys = ownedKeys.filter((minerKey) => isDeviceHealthSupported(minerKey));

    if (healthKeys.length === 0) {
      res.status(200).json({ success: true, summaries: {} });
      return;
    }

    await ensureTelemetryIndexes(client);

    const telemetryDocs = await client
      .db(POC_DB_NAME)
      .collection<TelemetryDoc>(POC_COLLECTION)
      .find({ miner_key: { $in: healthKeys } })
      .project({
        miner_key: 1,
        uptime: 1,
        mac: 1,
        pol: 1,
        rewards: 1,
        lastUpdated: 1
      })
      .toArray();

    const telemetryByKey = new Map<string, TelemetryDoc>();
    telemetryDocs.forEach((doc) => {
      const minerKey = doc.miner_key ? String(doc.miner_key) : '';
      if (minerKey) {
        telemetryByKey.set(minerKey, doc);
      }
    });

    const summaries: Record<string, HealthSummary> = {};

    for (const minerKey of healthKeys) {
      const doc = telemetryByKey.get(minerKey);
      if (!doc) {
        summaries[minerKey] = {
          available: false,
          status: 'unknown',
          uptimePercent24h: null,
          downtimeDetected: false,
          macStatus: null,
          polStatus: null,
          poiStatus: null,
          toolsActive: null,
          lastUpdated: null
        };
        continue;
      }

      const uptimeSeconds = Number(doc.uptime?.uptime_seconds_24h ?? 0);
      const downtimeSeconds = Number(doc.uptime?.downtime_seconds_24h ?? 0);
      const totalWindowSeconds = uptimeSeconds + downtimeSeconds;
      const uptimePercentRaw =
        totalWindowSeconds > 0 ? (uptimeSeconds / totalWindowSeconds) * 100 : null;
      const uptimePercent24h =
        typeof uptimePercentRaw === 'number' ? clampPercent(uptimePercentRaw) : null;
      const statusRaw = doc.uptime?.status ? String(doc.uptime.status).toLowerCase() : '';
      const status =
        statusRaw === 'online' ? 'online' : statusRaw === 'offline' ? 'offline' : 'unknown';
      const macStatus = typeof doc.mac?.status === 'boolean' ? doc.mac.status : null;
      const polStatus = typeof doc.pol?.status === 'boolean' ? doc.pol.status : null;
      const prefix = minerKey.split('-')[0]?.trim().toUpperCase() ?? '';
      const toolsActive = prefix === 'BM' ? extractLatestToolsCount(doc.rewards) : null;
      const poiStatus = prefix === 'AEM' ? extractLatestPoiStatus(doc.rewards) : null;

      summaries[minerKey] = {
        available: true,
        status,
        uptimePercent24h,
        downtimeDetected: downtimeSeconds > 0,
        macStatus,
        polStatus,
        poiStatus,
        toolsActive,
        lastUpdated: doc.lastUpdated ?? null
      };
    }

    res.status(200).json({ success: true, summaries });
  } catch (error) {
    handleApiError(res, ENDPOINT, error, {
      response: createApiError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to load device health data',
        'Please try again. If the problem persists, contact support.'
      ),
      walletAddress,
      issueType: 'DEVICE_HEALTH_SUMMARY_ERROR',
      part: 'hardware.health-summary.handler',
      metadata: {
        miner_keys: uniqueKeys,
        pocCollection: POC_COLLECTION
      }
    });
  }
}
