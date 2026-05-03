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

    const { wallet, score, declaredBy, prizeTxId } = req.body || {};

    if (!wallet || typeof wallet !== 'string') {
      return res.status(400).json(
        createApiError(ErrorCodes.INVALID_INPUT, 'wallet is required')
      );
    }
    if (typeof score !== 'number' || !Number.isFinite(score) || score < 0) {
      return res.status(400).json(
        createApiError(ErrorCodes.INVALID_INPUT, 'score must be a finite number >= 0')
      );
    }

    const event = await EventModel.findById(id);
    if (!event) {
      return res.status(404).json(
        createApiError(ErrorCodes.DEVICE_NOT_FOUND, 'Event not found')
      );
    }

    event.winner = {
      wallet: String(wallet),
      score: Number(score),
      declaredAt: new Date(),
      declaredBy: declaredBy || undefined,
      prizeTxId: prizeTxId || undefined,
    };
    await event.save();

    return res.status(200).json({
      success: true,
      winner: event.winner,
    });
  } catch (error) {
    handleApiError(res, `/api/events/${req.query.id}/declare-winner`, error, {
      response: createApiError(
        ErrorCodes.INTERNAL_ERROR,
        'Unable to declare winner'
      ),
    });
  }
}
