import type { NextApiRequest, NextApiResponse } from 'next';
import clientPromise from '../../../lib/mongoclient';
import { enforceWalletApiSecurity } from '../../../lib/api/enforceWalletSecurity';
import { createApiError, ErrorCodes, handleApiError } from '../../../lib/api-errors';
import { isDeviceHealthSupported } from '../../../lib/minerKeyCategories';
import { enforceOperationRateLimit } from '../../../lib/api/operationRateLimit';

type ToolHistoryEntry = {
  day: string;
  avgToolsCount: number | null;
  countedSlots: number;
};

type MultiplierHistoryEntry = {
  day: string;
  avg: number | null;
  counted_slots: number | null;
};

type TelemetryDoc = {
  miner_key?: string;
  miner_type?: string;
  lastUpdated?: string;
  tz?: string;
  boot_time?: string;
  uptime?: {
    status?: string;
    current_run_started_at?: string;
    last_online_at?: string;
    last_offline_at?: string;
    uptime_seconds_24h?: number;
    downtime_seconds_24h?: number;
  };
  software?: {
    os?: string;
    software_version_installed?: string;
    software_version_needed?: string;
    software_uptodate?: boolean;
    poc_version_installed?: string;
    poc_version_needed?: string;
    poc_uptodate?: boolean;
    is_uptodate?: boolean;
  };
  rewards?: Record<string, any>;
  rewards_multiplier_day?: number;
  rewards_multiplier_day_counted_slots?: number;
  rewards_multiplier_history?: Array<{ day?: string; avg?: number; counted_slots?: number }>;
};

const TEST_MODE = process.env.NEXT_PUBLIC_TEST_MODE === 'true';
const POC_DB_NAME = process.env.MONGO_POC_DB ?? 'PoC';
const POC_COLLECTION = process.env.MONGO_POC_COLLECTION ?? 'hardware';
const MAIN_DB_NAME = 'main';
const DEVICES_COLLECTION = TEST_MODE ? 'test-devices' : 'devices';
const ENDPOINT = '/api/hardware/health-history';
const ensuredIndexes = new Set<string>();
const MAX_DAYS = 7;

const clampToolsCount = (value: number): number => Math.min(3, Math.max(0, value));

const ensureTelemetryIndexes = async (client: Awaited<typeof clientPromise>) => {
  const key = `${POC_DB_NAME}.${POC_COLLECTION}`;
  if (ensuredIndexes.has(key)) return;
  // Ensure miner_key lookup stays fast for history requests.
  await client
    .db(POC_DB_NAME)
    .collection(POC_COLLECTION)
    .createIndex({ miner_key: 1 }, { name: 'telemetry_miner_key' });
  ensuredIndexes.add(key);
};

const buildToolsHistory = (rewards: Record<string, any> | undefined, days: number): ToolHistoryEntry[] => {
  if (!rewards || typeof rewards !== 'object') {
    return [];
  }

  const dayKeys = Object.keys(rewards).sort();
  const selectedDays = dayKeys.slice(Math.max(0, dayKeys.length - days));

  return selectedDays.map((day) => {
    const dayEntry = rewards[day];
    let totalTools = 0;
    let countedSlots = 0;

    if (dayEntry && typeof dayEntry === 'object') {
      const hourKeys = Object.keys(dayEntry).sort((a, b) => Number(a) - Number(b));
      for (const hourKey of hourKeys) {
        const slots = dayEntry[hourKey]?.slots;
        if (!Array.isArray(slots)) continue;
        for (const slot of slots) {
          if (!slot || typeof slot !== 'object') continue;
          const gates = slot.gates ?? {};
          // Count only slots eligible for BM rewards (data + online + MAC/POL). POI is AEM-only.
          const isEligible = Boolean(gates.data && gates.online && gates.mac_match && gates.pol);
          if (!isEligible) continue;
          const rawCount =
            typeof slot.tools_count === 'number'
              ? slot.tools_count
              : Array.isArray(slot.tools_active)
                ? slot.tools_active.length
                : 0;
          if (!Number.isFinite(rawCount)) continue;
          totalTools += clampToolsCount(rawCount);
          countedSlots += 1;
        }
      }
    }

    const avgToolsCount = countedSlots > 0 ? totalTools / countedSlots : null;

    return {
      day,
      avgToolsCount,
      countedSlots
    };
  });
};

const extractLatestPoiStatus = (rewards: Record<string, any> | undefined): boolean | null => {
  if (!rewards || typeof rewards !== 'object') {
    return null;
  }
  // AEM POI is stored on slot gates; walk backwards for the latest boolean.
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

  const { miner_key: minerKey, days } = req.body ?? {};
  if (!minerKey || typeof minerKey !== 'string') {
    res.status(400).json(
      createApiError(
        ErrorCodes.INVALID_INPUT,
        'Missing miner key for device health history.',
        'Please choose a device and try again.'
      )
    );
    return;
  }

  const security = await enforceWalletApiSecurity(req, res, {
    endpoint: ENDPOINT,
    minerKey
  });
  if (!security) {
    return;
  }

  const walletAddress = security.session.user.address;
  const dayWindow = Math.max(1, Math.min(MAX_DAYS, Number(days) || MAX_DAYS));

  if (!isDeviceHealthSupported(minerKey)) {
    res.status(200).json({ success: true, available: false });
    return;
  }

  try {
    const client = await clientPromise;

    const rate = await enforceOperationRateLimit({
      req,
      res,
      action: 'device-health-history',
      minerKey,
      address: walletAddress
    });
    if (!rate.allowed) {
      return;
    }

    const device = await client
      .db(MAIN_DB_NAME)
      .collection<{ miner_key?: string }>(DEVICES_COLLECTION)
      .findOne({ address: walletAddress, miner_key: minerKey }, { projection: { miner_key: 1 } });

    if (!device) {
      res.status(403).json(
        createApiError(
          ErrorCodes.UNAUTHORIZED,
          'You do not have access to this device.',
          'Please choose a device from your wallet.'
        )
      );
      return;
    }

    await ensureTelemetryIndexes(client);

    const telemetry = await client
      .db(POC_DB_NAME)
      .collection<TelemetryDoc>(POC_COLLECTION)
      .findOne(
        { miner_key: minerKey },
        {
          projection: {
            miner_key: 1,
            miner_type: 1,
            lastUpdated: 1,
            tz: 1,
            boot_time: 1,
            uptime: 1,
            software: 1,
            rewards: 1,
            rewards_multiplier_day: 1,
            rewards_multiplier_day_counted_slots: 1,
            rewards_multiplier_history: 1
          }
        }
      );

    if (!telemetry) {
      res.status(200).json({ success: true, available: false });
      return;
    }

    const prefix = minerKey.split('-')[0]?.trim().toUpperCase() ?? '';
    const toolsHistory =
      prefix === 'BM' ? buildToolsHistory(telemetry.rewards, dayWindow) : [];
    const poiStatus = prefix === 'AEM' ? extractLatestPoiStatus(telemetry.rewards) : null;

    const multiplierHistory: MultiplierHistoryEntry[] = Array.isArray(telemetry.rewards_multiplier_history)
      ? telemetry.rewards_multiplier_history
          .filter((entry) => typeof entry?.day === 'string')
          .map((entry) => ({
            day: String(entry.day),
            avg: typeof entry.avg === 'number' ? entry.avg : null,
            counted_slots:
              typeof entry.counted_slots === 'number' ? entry.counted_slots : null
          }))
      : [];

    res.status(200).json({
      success: true,
      available: true,
      miner_key: minerKey,
      miner_type: telemetry.miner_type ?? null,
      lastUpdated: telemetry.lastUpdated ?? null,
      boot_time: telemetry.boot_time ?? null,
      current_run_started_at: telemetry.uptime?.current_run_started_at ?? null,
      software: telemetry.software ?? null,
      rewards_multiplier_day:
        typeof telemetry.rewards_multiplier_day === 'number' ? telemetry.rewards_multiplier_day : null,
      rewards_multiplier_day_counted_slots:
        typeof telemetry.rewards_multiplier_day_counted_slots === 'number'
          ? telemetry.rewards_multiplier_day_counted_slots
          : null,
      rewards_multiplier_history: multiplierHistory,
      poi_status: poiStatus,
      tools_history: toolsHistory
    });
  } catch (error) {
    handleApiError(res, ENDPOINT, error, {
      response: createApiError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to load device health history',
        'Please try again. If the problem persists, contact support.'
      ),
      walletAddress,
      issueType: 'DEVICE_HEALTH_HISTORY_ERROR',
      part: 'hardware.health-history.handler',
      metadata: {
        miner_key: minerKey,
        pocCollection: POC_COLLECTION
      }
    });
  }
}
