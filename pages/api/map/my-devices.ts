import type { NextApiRequest, NextApiResponse } from 'next';
import clientPromise from '../../../lib/mongoclient';
import { enforceWalletApiSecurity } from '../../../lib/api/enforceWalletSecurity';
import { collectionFor } from '../../../lib/credentials-utils';
import { createApiError, ErrorCodes, handleApiError } from '../../../lib/api-errors';
import { ensureCredsMapIndexes, ensureDeviceMapIndexes } from '../../../lib/db/mapIndexes';
import { enforceOperationRateLimit } from '../../../lib/api/operationRateLimit';
import { getTelemetryByMinerKey } from '../../../lib/mapTelemetry';

type MapHexStatus = 'registered' | 'unregistered' | 'offline';

type WalletDeviceSummary = {
  miner_key: string;
  nickname: string | null;
  is_registered: boolean;
  status: MapHexStatus;
  hexId: string | null;
  hasLocation: boolean;
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
    endpoint: '/api/map/my-devices',
    minerKey: 'map:my-devices'
  });
  if (!security) return;

  const walletAddress = security.session.user.address;
  const testMode = process.env.NEXT_PUBLIC_TEST_MODE === 'true';

  try {
    const rate = await enforceOperationRateLimit({
      req,
      res,
      action: 'map:my-devices',
      minerKey: 'map:my-devices',
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
      return res.status(200).json({ success: true, devices: [] });
    }

    const minerKeysByCollection = new Map<string, string[]>();
    const devicesByMinerKey = new Map<string, DeviceLite>();

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
    const hexByMinerKey = new Map<string, string>();

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
        hexByMinerKey.set(minerKey, hexId);
      });
    }

    const deviceList: WalletDeviceSummary[] = [];
    devicesByMinerKey.forEach((device, minerKey) => {
      const hexId = hexByMinerKey.get(minerKey) ?? null;
      deviceList.push({
        miner_key: minerKey,
        nickname: device.nickname ? String(device.nickname) : null,
        is_registered: Boolean(device.is_registered),
        status: deriveDeviceStatus(device, telemetryByMinerKey.get(minerKey)?.online),
        hexId,
        hasLocation: Boolean(hexId)
      });
    });

    deviceList.sort((a, b) => (a.nickname ?? a.miner_key).localeCompare(b.nickname ?? b.miner_key));
    return res.status(200).json({ success: true, devices: deviceList });
  } catch (error) {
    handleApiError(res, '/api/map/my-devices', error, {
      response: createApiError(
        ErrorCodes.INTERNAL_ERROR,
        'Unable to load explorer device list',
        'Please try again. If the problem persists, contact support.'
      ),
      issueType: 'EXPLORER_MAP_DEVICES_ERROR',
      part: 'map.my-devices.handler',
      walletAddress
    });
  }
}
