import { NextApiRequest, NextApiResponse } from 'next';
import { isAdminRequest } from '../../../../lib/adminCheck';
import {
  createApiError,
  handleApiError,
  ErrorCodes,
} from '../../../../lib/api-errors';
import EventModel from '../../../../lib/events/eventModel';
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

    const { id } = req.query;
    if (!id || typeof id !== 'string' || !isValidObjectId(id)) {
      return res.status(400).json(
        createApiError(ErrorCodes.INVALID_INPUT, 'Invalid event ID')
      );
    }

    if (req.method === 'GET') {
      const event = await EventModel.findById(id).select('leaderboard').lean();
      if (!event) {
        return res.status(404).json(
          createApiError(ErrorCodes.DEVICE_NOT_FOUND, 'Event not found')
        );
      }

      const leaderboard = ((event as any).leaderboard || [])
        .slice()
        .sort((a: any, b: any) => (b.score ?? 0) - (a.score ?? 0));

      return res.status(200).json({
        success: true,
        leaderboard,
      });
    }

    if (req.method === 'POST') {
      const isAdmin = await isAdminRequest(req);
      if (!isAdmin) {
        return res.status(403).json(
          createApiError(ErrorCodes.FORBIDDEN, 'Admin access required')
        );
      }

      const event = await EventModel.findById(id);
      if (!event) {
        return res.status(404).json(
          createApiError(ErrorCodes.DEVICE_NOT_FOUND, 'Event not found')
        );
      }

      if (event.metric?.type !== 'manual') {
        return res.status(400).json(
          createApiError(
            ErrorCodes.INVALID_INPUT,
            'Manual leaderboard updates are only allowed for metric.type=manual'
          )
        );
      }

      const { leaderboard } = req.body;
      if (!Array.isArray(leaderboard)) {
        return res.status(400).json(
          createApiError(ErrorCodes.INVALID_INPUT, 'leaderboard must be an array')
        );
      }

      for (const entry of leaderboard) {
        if (!entry.wallet || typeof entry.wallet !== 'string') {
          return res.status(400).json(
            createApiError(ErrorCodes.INVALID_INPUT, 'Each leaderboard entry requires a wallet string')
          );
        }
        if (typeof entry.score !== 'number' || !Number.isFinite(entry.score) || entry.score < 0) {
          return res.status(400).json(
            createApiError(ErrorCodes.INVALID_INPUT, 'score must be a finite number >= 0')
          );
        }
      }

      const sanitized = leaderboard.map((entry: any) => ({
        wallet: String(entry.wallet),
        score: Number(entry.score),
        lastCalculated: new Date(),
        source: 'manual' as const,
      }));

      event.leaderboard = sanitized;
      await event.save();

      return res.status(200).json({
        success: true,
        leaderboard: sanitized.sort((a, b) => b.score - a.score),
      });
    }

    return res.status(405).json(
      createApiError(ErrorCodes.INVALID_INPUT, 'Method not allowed')
    );
  } catch (error) {
    handleApiError(res, `/api/events/${req.query.id}/leaderboard`, error, {
      response: createApiError(
        ErrorCodes.INTERNAL_ERROR,
        'Unable to process leaderboard request'
      ),
    });
  }
}
