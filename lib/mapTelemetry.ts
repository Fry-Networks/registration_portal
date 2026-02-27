import type { MongoClient } from 'mongodb';
import { ensureTelemetryMapIndexes } from './db/mapIndexes';

type TelemetryDoc = {
  miner_key?: string;
  uptime?: {
    status?: string;
  };
  lastUpdated?: string;
};

export type TelemetryStatus = {
  online: boolean;
  lastUpdated?: string;
};

const POC_DB_NAME = 'PoC';
const POC_COLLECTION = 'hardware';

export const getTelemetryByMinerKey = async (
  client: MongoClient,
  minerKeys: string[]
): Promise<Map<string, TelemetryStatus>> => {
  // Resolve PoC telemetry in bulk so explorer status can flag offline devices without leaking details.
  if (minerKeys.length === 0) return new Map();

  await ensureTelemetryMapIndexes(client);

  const rows = await client
    .db(POC_DB_NAME)
    .collection<TelemetryDoc>(POC_COLLECTION)
    .find({ miner_key: { $in: minerKeys } })
    .project({ miner_key: 1, 'uptime.status': 1, lastUpdated: 1 })
    .toArray();

  const telemetryByMinerKey = new Map<string, TelemetryStatus>();
  rows.forEach((row) => {
    const minerKey = row.miner_key ? String(row.miner_key) : '';
    if (!minerKey) return;
    const status = row.uptime?.status ? String(row.uptime.status).toLowerCase() : '';
    telemetryByMinerKey.set(minerKey, {
      online: status === 'online',
      lastUpdated: row.lastUpdated
    });
  });

  return telemetryByMinerKey;
};
