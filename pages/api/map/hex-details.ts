import type { NextApiRequest, NextApiResponse } from 'next';
import { cellToChildren, cellToParent, getResolution, isValidCell } from 'h3-js';
import clientPromise from '../../../lib/mongoclient';
import { enforceWalletApiSecurity } from '../../../lib/api/enforceWalletSecurity';
import { collectionFor } from '../../../lib/credentials-utils';
import { createApiError, ErrorCodes, handleApiError } from '../../../lib/api-errors';
import { ensureCredsMapIndexes, ensureDeviceMapIndexes } from '../../../lib/db/mapIndexes';
import { enforceOperationRateLimit } from '../../../lib/api/operationRateLimit';
import { getTelemetryByMinerKey } from '../../../lib/mapTelemetry';

type MapHexStatus = 'registered' | 'unregistered' | 'offline';

type DeviceSummary = {
  miner_key: string;
  nickname: string | null;
  is_registered: boolean;
  status: MapHexStatus;
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
    endpoint: '/api/map/hex-details',
    minerKey: 'map:hex-details'
  });
  if (!security) return;

  const walletAddress = security.session.user.address;
  const testMode = process.env.NEXT_PUBLIC_TEST_MODE === 'true';

  const { hexId } = req.body ?? {};
  if (!hexId || typeof hexId !== 'string' || !isValidCell(hexId)) {
    return res.status(400).json(
      createApiError(
        ErrorCodes.INVALID_INPUT,
        'Invalid hex id provided.',
        'Please select a valid map hex and try again.'
      )
    );
  }

  try {
    const rate = await enforceOperationRateLimit({
      req,
      res,
      action: 'map:hex-details',
      minerKey: hexId,
      address: walletAddress
    });
    if (!rate.allowed) return;

    const client = await clientPromise;
    // Wallet location data is stored at H3 resolution 7 in creds.position.hexId.
    const walletHexResolution = 7;
    const selectedResolution = getResolution(hexId);
    // Map arbitrary-resolution selections to the stored res-7 hex ids for matching.
    const hexIdsToMatch =
      selectedResolution === walletHexResolution
        ? [hexId]
        : selectedResolution > walletHexResolution
          ? [cellToParent(hexId, walletHexResolution)]
          : cellToChildren(hexId, walletHexResolution);
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
      return res.status(200).json({ success: true, hexId, devices: [] });
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
    const matches: DeviceSummary[] = [];

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
          // Use a small $in list to support parent/child matches across resolutions.
          'position.hexId': { $in: hexIdsToMatch }
        })
        .project({ miner_key: 1 })
        .toArray();

      rows.forEach((row) => {
        const minerKey = row.miner_key ? String(row.miner_key) : '';
        if (!minerKey) return;
        const device = devicesByMinerKey.get(minerKey);
        if (!device) return;

        matches.push({
          miner_key: minerKey,
          nickname: device.nickname ? String(device.nickname) : null,
          is_registered: Boolean(device.is_registered),
          status: deriveDeviceStatus(device, telemetryByMinerKey.get(minerKey)?.online)
        });
      });
    }

    matches.sort((a, b) => a.miner_key.localeCompare(b.miner_key));
    return res.status(200).json({ success: true, hexId, devices: matches });
  } catch (error) {
    handleApiError(res, '/api/map/hex-details', error, {
      response: createApiError(
        ErrorCodes.INTERNAL_ERROR,
        'Unable to load explorer map details',
        'Please try again. If the problem persists, contact support.'
      ),
      issueType: 'EXPLORER_MAP_DETAILS_ERROR',
      part: 'map.hex-details.handler',
      walletAddress,
      metadata: { hexId }
    });
  }
}
