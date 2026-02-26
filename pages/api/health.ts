import type { NextApiRequest, NextApiResponse } from 'next';

/**
 * Health check endpoint for Docker healthcheck and monitoring.
 * Returns HTTP 200 with a simple JSON payload.
 * No authentication required, no side effects.
 */
export default function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  res.status(200).json({
    status: 'ok',
    timestamp: Date.now()
  });
}
