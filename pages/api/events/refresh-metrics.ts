import { NextApiRequest, NextApiResponse } from 'next';
import { isAdminRequest } from '../../../lib/adminCheck';
import {
  createApiError,
  handleApiError,
  ErrorCodes,
} from '../../../lib/api-errors';
import EventModel from '../../../lib/events/eventModel';
import { resolveHardwareMetric } from '../../../lib/events/hardwareMetricResolver.server';
import { connect } from '../../../lib/connect';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  try {
    await connect();

    if (req.method !== 'POST') {
      return res.status(405).json(
        createApiError(ErrorCodes.INVALID_INPUT, 'Method not allowed')
      );
    }

    const isAdmin = await isAdminRequest(req);
    if (!isAdmin) {
      return res.status(403).json(
        createApiError(ErrorCodes.FORBIDDEN, 'Admin access required')
      );
    }

    const events = await EventModel.find({
      status: 'active',
      'metric.type': { $in: ['aem_count', 'device_count'] },
    });

    const results: Array<{
      eventId: string;
      ok: boolean;
      errorCode?: string;
    }> = [];

    for (const event of events) {
      const metricType = event.metric?.type;
      if (metricType !== 'aem_count' && metricType !== 'device_count') {
        continue;
      }

      const result = await resolveHardwareMetric(
        metricType,
        event.startDate,
        event.endDate
      );

      event.metric = {
        ...event.metric,
        lastRefreshAt: new Date(),
        lastRefreshStatus: result.ok ? 'ok' : 'failed',
        lastRefreshError: result.ok ? undefined : result.errorCode,
      };

      if (result.ok && result.wallets) {
        event.leaderboard = result.wallets.map((w) => ({
          wallet: w.wallet,
          score: w.score,
          lastCalculated: new Date(),
          source: 'hardwareapi' as const,
        }));
      }

      await event.save();

      results.push({
        eventId: event._id.toString(),
        ok: result.ok,
        errorCode: result.errorCode,
      });
    }

    const anyFailed = results.some((r) => !r.ok);

    return res.status(anyFailed ? 207 : 200).json({
      success: !anyFailed,
      refreshed: results.length,
      results,
    });
  } catch (error) {
    handleApiError(res, '/api/events/refresh-metrics', error, {
      response: createApiError(
        ErrorCodes.INTERNAL_ERROR,
        'Unable to refresh metrics'
      ),
    });
  }
}
