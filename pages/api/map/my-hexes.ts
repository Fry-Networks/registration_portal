import type { NextApiRequest, NextApiResponse } from 'next';
import clientPromise from '../../../lib/mongoclient';
import { enforceWalletApiSecurity } from '../../../lib/api/enforceWalletSecurity';
import { collectionFor } from '../../../lib/credentials-utils';
import { createApiError, ErrorCodes, handleApiError } from '../../../lib/api-errors';
import { ensureCredsMapIndexes, ensureDeviceMapIndexes } from '../../../lib/db/mapIndexes';
import { enforceOperationRateLimit } from '../../../lib/api/operationRateLimit';
import { getTelemetryByMinerKey } from '../../../lib/mapTelemetry';

type MapHexStatus = 'registered' | 'unregistered' | 'offline';

type MapHexSummary = {
  hexId: string;
  count: number;
  status: MapHexStatus;
  statusCounts: {
    registered: number;
    unregistered: number;
    offline: number;
  };
};

type DeviceLite = {
  miner_key?: string;
  nickname?: string;
  is_registered?: boolean;
};

const deriveDeviceStatus = (
  device: DeviceLite | undefined,
  telemetryOnline: boolean | undefined
): MapHexStatus => {
  // Respect PoC telemetry when present; otherwise fall back to registration state.
  if (telemetryOnline === false) return 'offline';
  return device?.is_registered ? 'registered' : 'unregistered';
};

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

  const security = await enforceWalletApiSecurity(req, res, {
    endpoint: '/api/map/my-hexes',
    minerKey: 'map:my-hexes'
  });
  if (!security) return;

  const walletAddress = security.session.user.address;
  const testMode = process.env.NEXT_PUBLIC_TEST_MODE === 'true';

  try {
    const rate = await enforceOperationRateLimit({
      req,
      res,
      action: 'map:my-hexes',
      minerKey: 'map:my-hexes',
      address: walletAddress
    });
    if (!rate.allowed) return;

    const client = await clientPromise;
    const deviceCollectionName = testMode ? 'test-devices' : 'devices';

    // Ensure indexes for the wallet-scoped device scan used in the explorer map.
    await ensureDeviceMapIndexes(client, deviceCollectionName);

    const devices = await client
      .db('main')
      .collection<DeviceLite>(deviceCollectionName)
      .find({ address: walletAddress })
      .project({
        miner_key: 1,
        nickname: 1,
        is_registered: 1
      })
      .toArray();

    if (!devices.length) {
      return res.status(200).json({ success: true, hexes: [] });
    }

    const devicesByMinerKey = new Map<string, DeviceLite>();
    const minerKeysByCollection = new Map<string, string[]>();

    devices.forEach((device) => {
      const minerKey = device.miner_key ? String(device.miner_key) : '';
      if (!minerKey) return;
      devicesByMinerKey.set(minerKey, device);
      const collectionName = collectionFor({ miner_key: minerKey });
      const list = minerKeysByCollection.get(collectionName) ?? [];
      list.push(minerKey);
      minerKeysByCollection.set(collectionName, list);
    });

    // Pull PoC uptime telemetry so offline devices are highlighted when available.
    const telemetryByMinerKey = await getTelemetryByMinerKey(client, Array.from(devicesByMinerKey.keys()));
    const credsDbName = process.env.MONGO_CREDS_DB ?? 'creds';
    const hexMap = new Map<string, MapHexSummary>();

    // Use an array snapshot to avoid TS downlevel-iteration requirements for Map iterators.
    const minerKeyEntries = Array.from(minerKeysByCollection.entries());
    for (let index = 0; index < minerKeyEntries.length; index += 1) {
      const [collectionName, minerKeys] = minerKeyEntries[index];
      // Ensure creds indexes before scanning for hex ids.
      await ensureCredsMapIndexes(client, collectionName);

      const rows = await client
        .db(credsDbName)
        .collection<{ miner_key?: string; position?: { hexId?: string } }>(collectionName)
        .find({
          miner_key: { $in: minerKeys },
          address: walletAddress,
          'position.hexId': { $exists: true }
        })
        .project({ miner_key: 1, 'position.hexId': 1 })
        .toArray();

      rows.forEach((row) => {
        const minerKey = row.miner_key ? String(row.miner_key) : '';
        const hexId = row.position?.hexId ? String(row.position.hexId) : '';
        if (!minerKey || !hexId) return;

        const device = devicesByMinerKey.get(minerKey);
        const status = deriveDeviceStatus(device, telemetryByMinerKey.get(minerKey)?.online);
        const existing = hexMap.get(hexId);

        if (!existing) {
          hexMap.set(hexId, {
            hexId,
            count: 1,
            status,
            statusCounts: {
              registered: status === 'registered' ? 1 : 0,
              unregistered: status === 'unregistered' ? 1 : 0,
              offline: status === 'offline' ? 1 : 0
            }
          });
          return;
        }

        existing.count += 1;
        existing.statusCounts[status] += 1;
        // Prioritize offline, then unregistered, then registered for hex coloring.
        existing.status = existing.statusCounts.offline
          ? 'offline'
          : existing.statusCounts.unregistered
            ? 'unregistered'
            : 'registered';
      });
    }

    const hexes = Array.from(hexMap.values()).sort((a, b) => b.count - a.count);
    return res.status(200).json({ success: true, hexes });
  } catch (error) {
    handleApiError(res, '/api/map/my-hexes', error, {
      response: createApiError(
        ErrorCodes.INTERNAL_ERROR,
        'Unable to load explorer map data',
        'Please try again. If the problem persists, contact support.'
      ),
      issueType: 'EXPLORER_MAP_HEXES_ERROR',
      part: 'map.my-hexes.handler',
      walletAddress
    });
  }
}
