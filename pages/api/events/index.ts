import { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import { isAdminRequest } from '../../../lib/adminCheck';
import {
  createApiError,
  handleApiError,
  ErrorCodes,
} from '../../../lib/api-errors';
import EventModel, { IEvent, EventStatus } from '../../../lib/events/eventModel';
import { connect } from '../../../lib/connect';

function isValidObjectId(id: string): boolean {
  return /^[a-f0-9]{24}$/i.test(id);
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  try {
    await connect();

    if (req.method === 'GET') {
      const session = await getServerSession(req, res, authOptions);
      const isAdmin = await isAdminRequest(req);

      let filter: Record<string, unknown> = {};

      const { status } = req.query;
      if (status && typeof status === 'string') {
        const allowed: EventStatus[] = ['draft', 'active', 'ended', 'cancelled'];
        if (!allowed.includes(status as EventStatus)) {
          return res.status(400).json(
            createApiError(
              ErrorCodes.INVALID_INPUT,
              'Invalid status filter',
              'Use draft, active, ended, or cancelled.'
            )
          );
        }
        filter.status = status;
      } else {
        // Default: show active and ended to public.
        // Admins see all statuses unless they explicitly filter.
        if (!isAdmin) {
          filter.status = { $in: ['active', 'ended'] };
        }
      }

      const events = await EventModel.find(filter)
        .sort({ startDate: -1 })
        .select('-__v')
        .lean();

      return res.status(200).json({
        success: true,
        events: events.map((e) => ({
          ...e,
          _id: (e as any)._id?.toString?.(),
        })),
      });
    }

    if (req.method === 'POST') {
      const isAdmin = await isAdminRequest(req);
      if (!isAdmin) {
        return res.status(403).json(
          createApiError(ErrorCodes.FORBIDDEN, 'Admin access required')
        );
      }

      const {
        name,
        description,
        status,
        startDate,
        endDate,
        prize,
        metric,
        bannerImage,
        ctaLink,
        audience,
        created_by,
      } = req.body;

      if (!name || typeof name !== 'string') {
        return res.status(400).json(
          createApiError(ErrorCodes.INVALID_INPUT, 'name is required')
        );
      }
      if (!startDate || !endDate) {
        return res.status(400).json(
          createApiError(ErrorCodes.INVALID_INPUT, 'startDate and endDate are required')
        );
      }
      const s = new Date(startDate);
      const e = new Date(endDate);
      if (isNaN(s.getTime()) || isNaN(e.getTime())) {
        return res.status(400).json(
          createApiError(ErrorCodes.INVALID_INPUT, 'Invalid date format')
        );
      }
      if (e <= s) {
        return res.status(400).json(
          createApiError(ErrorCodes.INVALID_INPUT, 'endDate must be after startDate')
        );
      }

      const allowedStatus: EventStatus[] = ['draft', 'active', 'ended', 'cancelled'];
      const resolvedStatus: EventStatus = allowedStatus.includes(status) ? status : 'draft';

      const doc = await EventModel.create({
        name,
        description,
        status: resolvedStatus,
        startDate: s,
        endDate: e,
        prize: prize || { type: 'USDC', amount: 0 },
        metric: metric || { type: 'manual' },
        bannerImage,
        ctaLink,
        audience,
        created_by,
      });

      return res.status(201).json({
        success: true,
        event: {
          ...doc.toObject(),
          _id: doc._id.toString(),
        },
      });
    }

    return res.status(405).json(
      createApiError(ErrorCodes.INVALID_INPUT, 'Method not allowed')
    );
  } catch (error) {
    handleApiError(res, '/api/events', error, {
      response: createApiError(
        ErrorCodes.INTERNAL_ERROR,
        'Unable to process events request'
      ),
    });
  }
}
