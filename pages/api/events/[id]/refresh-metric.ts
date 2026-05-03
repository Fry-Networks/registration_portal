import { NextApiRequest, NextApiResponse } from 'next';
import { isAdminRequest } from '../../../../lib/adminCheck';
import {
  createApiError,
  handleApiError,
  ErrorCodes,
} from '../../../../lib/api-errors';
import EventModel from '../../../../lib/events/eventModel';
import { resolveHardwareMetric } from '../../../../lib/events/hardwareMetricResolver.server';
import { connect } from '../../../../lib/connect';

function isValidObjectId(id: string): boolean {
  return /^[a-f0-9]{24}$/i.test(id);
}

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

    const { id } = req.query;
    if (!id || typeof id !== 'string' || !isValidObjectId(id)) {
      return res.status(400).json(
        createApiError(ErrorCodes.INVALID_INPUT, 'Invalid event ID')
      );
    }

    const event = await EventModel.findById(id);
    if (!event) {
      return res.status(404).json(
        createApiError(ErrorCodes.DEVICE_NOT_FOUND, 'Event not found')
      );
    }

    const metricType = event.metric?.type;
    if (metricType === 'manual') {
      return res.status(400).json(
        createApiError(
          ErrorCodes.INVALID_INPUT,
          'Manual events do not support auto-metric refresh'
        )
      );
    }

    if (metricType !== 'aem_count' && metricType !== 'device_count') {
      return res.status(400).json(
        createApiError(ErrorCodes.INVALID_INPUT, 'Unsupported metric type for refresh')
      );
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

    if (!result.ok) {
      return res.status(503).json({
        success: false,
        code: result.errorCode,
        message: result.errorMessage,
        event: {
          ...event.toObject(),
          _id: event._id.toString(),
        },
      });
    }

    return res.status(200).json({
      success: true,
      refreshed: result.ok,
      walletsCount: result.wallets?.length ?? 0,
      event: {
        ...event.toObject(),
        _id: event._id.toString(),
      },
    });
  } catch (error) {
    handleApiError(res, `/api/events/${req.query.id}/refresh-metric`, error, {
      response: createApiError(
        ErrorCodes.INTERNAL_ERROR,
        'Unable to refresh metric'
      ),
    });
  }
}
