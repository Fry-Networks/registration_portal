import { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import { getSecurityEvents, getSecuritySummary, isUnderAttack } from '../../../lib/securityMonitoring';

/**
 * Security Events Query API
 * 
 * Endpoint: GET /api/security/events
 * 
 * Query Parameters:
 *   - wallet: Filter by wallet address
 *   - miner_key: Filter by miner key
 *   - endpoint: Filter by endpoint path (e.g., /api/rewards/claim)
 *   - type: Filter by event type (MISSING_CLIENT_TOKEN, INVALID_SIGNATURE, etc.)
 *   - severity: Filter by severity (low, medium, high, critical)
 *   - startDate: ISO date string for start of range
 *   - endDate: ISO date string for end of range
 *   - limit: Maximum number of results (default: 100, max: 1000)
 * 
 * Response:
 *   - events: Array of SecurityEvent objects
 *   - total: Total count of matching events
 *   - underAttack: Boolean indicating if wallet/miner is under active attack
 *   - summary: Security statistics if wallet/miner specified
 * 
 * Examples:
 *   GET /api/security/events?wallet=AAAAA...
 *   GET /api/security/events?miner_key=abc123&severity=critical
 *   GET /api/security/events?endpoint=/api/rewards/claim&limit=50
 */

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Only GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({ code: 'METHOD_NOT_ALLOWED', error: 'Use GET' });
  }

  // Require authentication (admin check optional - adjust as needed)
  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).json({ code: 'UNAUTHORIZED', error: 'Session required' });
  }

  try {
    const {
      wallet,
      miner_key,
      endpoint,
      type,
      severity,
      startDate,
      endDate,
      limit = '100'
    } = req.query;

    // Parse and validate limit
    let limitNum = parseInt(limit as string, 10);
    if (isNaN(limitNum) || limitNum < 1) limitNum = 100;
    if (limitNum > 1000) limitNum = 1000;

    // Build filter object
    const filter: any = {};

    if (wallet) filter.wallet = wallet as string;
    if (miner_key) filter.miner_key = miner_key as string;
    if (endpoint) filter.endpoint = endpoint as string;
    if (type) filter.type = type as string;
    if (severity) filter.severity = severity as string;

    // Parse date range
    if (startDate || endDate) {
      filter.timestamp = {};
      if (startDate) {
        const start = new Date(startDate as string);
        if (!isNaN(start.getTime())) {
          filter.timestamp.$gte = start;
        }
      }
      if (endDate) {
        const end = new Date(endDate as string);
        if (!isNaN(end.getTime())) {
          filter.timestamp.$lte = end;
        }
      }
    }

    // Add limit to filter
    filter.limit = limitNum;

    // Query events
    const events = await getSecurityEvents(filter);

    // Check if under attack
    let underAttack = false;
    if (wallet || miner_key) {
      underAttack = await isUnderAttack(wallet as string, miner_key as string);
    }

    // Get summary if wallet/miner specified
    let summary: any = null;
    if (wallet || miner_key) {
      summary = await getSecuritySummary(wallet as string, miner_key as string);
    }

    return res.status(200).json({
      code: 'SECURITY_EVENTS_RETRIEVED',
      events,
      total: events.length,
      underAttack,
      summary,
      filters: {
        wallet,
        miner_key,
        endpoint,
        type,
        severity,
        startDate,
        endDate,
        limit: limitNum
      }
    });
  } catch (error) {
    console.error('[SecurityEvents] Query failed:', error);
    return res.status(500).json({
      code: 'SECURITY_QUERY_ERROR',
      error: error instanceof Error ? error.message : 'Query failed'
    });
  }
}
