import { NextApiRequest, NextApiResponse } from 'next';
import { isAdminRequest } from '../../../lib/adminCheck';
import {
  createApiError,
  handleApiError,
  ErrorCodes,
} from '../../../lib/api-errors';
import EventModel, { EventStatus } from '../../../lib/events/eventModel';
import { connect } from '../../../lib/connect';

function isValidObjectId(id: string): boolean {
  return /^[a-f0-9]{24}$/i.test(id);
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const { id } = req.query;
  if (!id || typeof id !== 'string' || !isValidObjectId(id)) {
    return res.status(400).json(
      createApiError(ErrorCodes.INVALID_INPUT, 'Invalid event ID')
    );
  }
  try {
    await connect();
    if (req.method === 'GET') {
      const event = await EventModel.findById(id).select('-__v').lean();
      if (!event) {
        return res.status(404).json(
          createApiError(ErrorCodes.DEVICE_NOT_FOUND, 'Event not found')
        );
      }

      return res.status(200).json({
        success: true,
        event: {
          ...event,
          _id: (event as any)._id?.toString?.(),
        },
      });
    }

    if (req.method === 'PATCH' || req.method === 'PUT') {
      const isAdmin = await isAdminRequest(req);
      if (!isAdmin) {
        return res.status(403).json(
          createApiError(ErrorCodes.FORBIDDEN, 'Admin access required')
        );
      }

      const updateFields: Record<string, unknown> = {};
      const allowedFields = [
        'name',
        'description',
        'status',
        'startDate',
        'endDate',
        'prize',
        'metric',
        'bannerImage',
        'ctaLink',
        'audience',
        'leaderboard',
        'winner',
      ];

      for (const key of allowedFields) {
        if (req.body[key] !== undefined) {
          updateFields[key] = req.body[key];
        }
      }

      if (updateFields.status) {
        const allowed: EventStatus[] = ['draft', 'active', 'ended', 'cancelled'];
        if (!allowed.includes(updateFields.status as EventStatus)) {
          return res.status(400).json(
            createApiError(ErrorCodes.INVALID_INPUT, 'Invalid status value')
          );
        }
      }

      if (updateFields.startDate || updateFields.endDate) {
        const s = new Date((updateFields.startDate as string) || '');
        const e = new Date((updateFields.endDate as string) || '');
        if (
          updateFields.startDate && isNaN(s.getTime()) ||
          updateFields.endDate && isNaN(e.getTime())
        ) {
          return res.status(400).json(
            createApiError(ErrorCodes.INVALID_INPUT, 'Invalid date format')
          );
        }
        if (
          updateFields.startDate && updateFields.endDate && e <= s
        ) {
          return res.status(400).json(
            createApiError(ErrorCodes.INVALID_INPUT, 'endDate must be after startDate')
          );
        }
        if (updateFields.startDate) updateFields.startDate = s;
        if (updateFields.endDate) updateFields.endDate = e;
      }

      const event = await EventModel.findByIdAndUpdate(
        id,
        { $set: updateFields },
        { new: true, runValidators: true }
      ).select('-__v');

      if (!event) {
        return res.status(404).json(
          createApiError(ErrorCodes.DEVICE_NOT_FOUND, 'Event not found')
        );
      }

      return res.status(200).json({
        success: true,
        event: {
          ...event.toObject(),
          _id: event._id.toString(),
        },
      });
    }

    if (req.method === 'DELETE') {
      const isAdmin = await isAdminRequest(req);
      if (!isAdmin) {
        return res.status(403).json(
          createApiError(ErrorCodes.FORBIDDEN, 'Admin access required')
        );
      }

      const event = await EventModel.findByIdAndUpdate(
        id,
        { $set: { status: 'cancelled' } },
        { new: true }
      );

      if (!event) {
        return res.status(404).json(
          createApiError(ErrorCodes.DEVICE_NOT_FOUND, 'Event not found')
        );
      }

      return res.status(200).json({
        success: true,
        message: 'Event cancelled',
        event: {
          ...event.toObject(),
          _id: event._id.toString(),
        },
      });
    }

    return res.status(405).json(
      createApiError(ErrorCodes.INVALID_INPUT, 'Method not allowed')
    );
  } catch (error) {
    handleApiError(res, `/api/events/${id}`, error, {
      response: createApiError(
        ErrorCodes.INTERNAL_ERROR,
        'Unable to process event request'
      ),
    });
  }
}
