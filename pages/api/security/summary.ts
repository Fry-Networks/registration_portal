import { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import { getSecuritySummary, isUnderAttack } from '../../../lib/securityMonitoring';

/**
 * Security Summary API
 * 
 * Endpoint: GET /api/security/summary
 * 
 * Query Parameters:
 *   - wallet: Filter by wallet address
 *   - miner_key: Filter by miner key
 * 
 * Response:
 *   - total_events: Total number of security events
 *   - by_type: Count of events by type
 *   - by_severity: Count of events by severity
 *   - critical_events: Count of critical severity events
 *   - last_event: Most recent security event details
 *   - underAttack: Boolean indicating active attack status
 * 
 * Examples:
 *   GET /api/security/summary?wallet=AAAAA...
 *   GET /api/security/summary?miner_key=abc123
 */

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Only GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({ code: 'METHOD_NOT_ALLOWED', error: 'Use GET' });
  }

  // Require authentication
  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).json({ code: 'UNAUTHORIZED', error: 'Session required' });
  }

  try {
    const { wallet, miner_key } = req.query;

    // Get summary statistics
    const summary = await getSecuritySummary(wallet as string, miner_key as string);

    // Check if under attack
    const underAttack = await isUnderAttack(wallet as string, miner_key as string);

    return res.status(200).json({
      code: 'SECURITY_SUMMARY_RETRIEVED',
      ...summary,
      underAttack,
      filters: {
        wallet,
        miner_key
      }
    });
  } catch (error) {
    console.error('[SecuritySummary] Query failed:', error);
    return res.status(500).json({
      code: 'SECURITY_SUMMARY_ERROR',
      error: error instanceof Error ? error.message : 'Query failed'
    });
  }
}
