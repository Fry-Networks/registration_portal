/**
 * Client Token Verification Middleware
 * 
 * Verifies that API requests include a valid client token that matches
 * the expected SHA-256 hash based on the request's User-Agent header.
 * 
 * This prevents automated scripts (curl, Node.js, etc.) from calling
 * sensitive endpoints even if they have a valid session cookie.
 */

import { NextApiRequest, NextApiResponse, NextApiHandler } from 'next';
import crypto from 'crypto';
import { isAdminRequest, extractWalletFromRequest } from './adminCheck';

const TOKEN_GENERATION_SECRET = 'fry-rewards-client-';

/**
 * Verify the client token from the request header.
 * 
 * The token should be sent as the 'x-client-token' header.
 * We verify it by computing the expected hash based on the User-Agent header.
 * 
 * ADMIN BYPASS: If the wallet address has admin=true in registration-users,
 * this verification is skipped entirely.
 */
export async function verifyClientToken(req: NextApiRequest, res: NextApiResponse): Promise<boolean> {
  // Admin bypass: check if wallet is admin
  const isAdmin = await isAdminRequest(req);
  if (isAdmin) {
    // Admin users bypass this check
    return true;
  }

  const token = req.headers['x-client-token'] as string | undefined;
  const userAgent = req.headers['user-agent'] || '';

  if (!token) {
    // Dynamic import to avoid bundling MongoDB into client
    import('./securityMonitoring').then(({ logSecurityEvent }) => {
      logSecurityEvent(req, 'MISSING_CLIENT_TOKEN', 'medium', 'No client token provided').catch(() => {});
    }).catch(() => {});
    res.status(403).json({
      success: false,
      code: 'MISSING_CLIENT_TOKEN',
      message: 'Client token is required'
    });
    return false;
  }

  // Compute the expected token based on the User-Agent
  const expectedToken = crypto
    .createHash('sha256')
    .update(TOKEN_GENERATION_SECRET + userAgent)
    .digest('hex');

  if (token !== expectedToken) {
    // Dynamic import to avoid bundling MongoDB into client
    import('./securityMonitoring').then(({ logSecurityEvent }) => {
      logSecurityEvent(req, 'INVALID_CLIENT_TOKEN', 'medium', 'Client token does not match User-Agent').catch(() => {});
    }).catch(() => {});
    res.status(403).json({
      success: false,
      code: 'INVALID_CLIENT_TOKEN',
      message: 'Invalid client token'
    });
    return false;
  }

  return true;
}

/**
 * Middleware wrapper: protect an API handler with client token verification.
 * 
 * Admin users bypass this check.
 * 
 * Usage:
 *   export default withClientTokenVerification(async (req, res) => {
 *     // protected logic here
 *   });
 */
export function withClientTokenVerification(handler: NextApiHandler): NextApiHandler {
  return async (req: NextApiRequest, res: NextApiResponse) => {
    if (req.method !== 'GET') {
      const verified = await verifyClientToken(req, res);
      if (!verified) {
        return;
      }
    }
    return handler(req, res);
  };
}
