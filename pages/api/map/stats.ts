import type { NextApiRequest, NextApiResponse } from 'next';
import clientPromise from '../../../lib/mongoclient';
import { enforceWalletApiSecurity } from '../../../lib/api/enforceWalletSecurity';
import { createApiError, ErrorCodes, handleApiError } from '../../../lib/api-errors';
import { enforceOperationRateLimit } from '../../../lib/api/operationRateLimit';
import { ensureTelemetryMapIndexes } from '../../../lib/db/mapIndexes';
// Use shared miner prefix grouping for the "Other" breakdown in explorer stats.
import {
  NODE_PREFIXES,
  OTHER_BREAKDOWN_ORDER,
  categorizeMinerPrefix,
  type MinerCategory,
  type OtherBreakdownCategory
} from '../../../lib/minerKeyCategories';

type GlobalStatsResponse = {
  totalRegistered: number;
  nodes: number;
  aem: number;
  bm: number;
  other: number;
  breakdown: Record<OtherBreakdownCategory, number>;
  online: number | null;
  offline: number | null;
  onlineReady: boolean;
};

// PoC telemetry runs in its own database/collection.
const POC_DB_NAME = 'PoC';
const POC_COLLECTION_NAME = 'hardware';

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
    endpoint: '/api/map/stats',
    minerKey: 'map:stats'
  });
  if (!security) return;

  const walletAddress = security.session.user.address;
  const testMode = process.env.NEXT_PUBLIC_TEST_MODE === 'true';

  try {
    const rate = await enforceOperationRateLimit({
      req,
      res,
      action: 'map:stats',
      minerKey: 'map:stats',
      address: walletAddress
    });
    if (!rate.allowed) return;

    const client = await clientPromise;
    const deviceCollectionName = testMode ? 'test-devices' : 'devices';
    const deviceCollection = client.db('main').collection(deviceCollectionName);

    const totalRegistered = await deviceCollection.countDocuments({ is_registered: true });
    const prefixes = await deviceCollection
      .aggregate<{ _id: string | null; count: number }>([
        {
          $match: {
            is_registered: true,
            miner_key: { $type: 'string', $ne: '' }
          }
        },
        {
          $project: {
            prefix: { $arrayElemAt: [{ $split: ['$miner_key', '-'] }, 0] }
          }
        },
        {
          $group: {
            _id: '$prefix',
            count: { $sum: 1 }
          }
        }
      ])
      .toArray();

    let nodes = 0;
    let aem = 0;
    let bm = 0;
    // Track how many registered devices are missing miner_key so counts stay consistent.
    let prefixTotal = 0;
    // Track per-category counts for the "Other" breakdown panel.
    const breakdown: Record<MinerCategory, number> = {
      nodes: 0,
      aem: 0,
      bm: 0,
      camera: 0,
      weather: 0,
      water: 0,
      air: 0,
      radiation: 0,
      energy: 0,
      hardware: 0,
      unknown: 0
    };

    prefixes.forEach((row) => {
      const prefix = row._id ? String(row._id).toUpperCase() : '';
      prefixTotal += row.count;
      const category = categorizeMinerPrefix(prefix);
      breakdown[category] += row.count;
      if (NODE_PREFIXES.has(prefix)) {
        nodes += row.count;
        return;
      }
      if (prefix === 'AEM') {
        aem += row.count;
        return;
      }
      if (prefix === 'BM') {
        bm += row.count;
      }
    });

    // Treat missing miner keys as unknown so the breakdown matches the total.
    const missingPrefixCount = Math.max(0, totalRegistered - prefixTotal);
    breakdown.unknown += missingPrefixCount;
    // Preserve a stable ordering for the "Other" breakdown payload.
    const breakdownOrdered = OTHER_BREAKDOWN_ORDER.reduce<Record<OtherBreakdownCategory, number>>((acc, key) => {
      acc[key] = breakdown[key] ?? 0;
      return acc;
    }, {} as Record<OtherBreakdownCategory, number>);
    // Keep "Other" aligned with the detailed breakdown totals.
    const other = Object.values(breakdownOrdered).reduce((sum, value) => sum + value, 0);

    // Pull telemetry counts from PoC.hardware to surface online/offline availability.
    await ensureTelemetryMapIndexes(client);
    const telemetryCollection = client.db(POC_DB_NAME).collection(POC_COLLECTION_NAME);
    const telemetryTotal = await telemetryCollection.countDocuments({});
    const telemetryOnline = await telemetryCollection.countDocuments({ 'uptime.status': 'online' });
    const telemetryReady = telemetryTotal > 0;

    const response: GlobalStatsResponse = {
      totalRegistered,
      nodes,
      aem,
      bm,
      other,
      breakdown: breakdownOrdered,
      online: telemetryReady ? telemetryOnline : null,
      offline: telemetryReady ? Math.max(0, telemetryTotal - telemetryOnline) : null,
      onlineReady: telemetryReady
    };

    return res.status(200).json({ success: true, stats: response });
  } catch (error) {
    handleApiError(res, '/api/map/stats', error, {
      response: createApiError(
        ErrorCodes.INTERNAL_ERROR,
        'Unable to load explorer stats',
        'Please try again. If the problem persists, contact support.'
      ),
      issueType: 'EXPLORER_MAP_STATS_ERROR',
      part: 'map.stats.handler',
      walletAddress
    });
  }
}
