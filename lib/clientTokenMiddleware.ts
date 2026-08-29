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
import { logSecurityEventAggregated } from './securityEventAggregation';

const TOKEN_GENERATION_SECRET = process.env.NEXT_PUBLIC_CLIENT_TOKEN_SECRET || 'fry-rewards-client-';

/**
 * Helper: Format and log security event
 */
function formatSecurityLog(
  layerName: string,
  walletAddress: string,
  minerKey: string,
  details?: string
): string {
  const timestamp = new Date().toISOString();
  const detail = details ? ` - ${details}` : '';
  return `[${layerName}] ${timestamp}${detail} | Wallet: ${walletAddress} | Miner: ${minerKey}`;
}

/**
 * Helper: Log security event to console and MongoDB
 */
async function logLayer1Event(
  req: NextApiRequest,
  eventType: 'MISSING_CLIENT_TOKEN' | 'INVALID_CLIENT_TOKEN',
  walletAddress: string,
  minerKey: string,
  details?: string
): Promise<void> {
  const layerName = 'L1 - ClientToken';
  
  let eventDetails = '';
  if (eventType === 'MISSING_CLIENT_TOKEN') {
    eventDetails = 'No client token provided';
  } else if (eventType === 'INVALID_CLIENT_TOKEN') {
    eventDetails = 'Client token does not match User-Agent';
  }

  // Log to console
  const consoleLog = formatSecurityLog(layerName, walletAddress, minerKey, eventDetails);
  console.warn(consoleLog);

  // Log to aggregated MongoDB (updates wallet's summary document)
  await logSecurityEventAggregated(
    req,
    eventType,
    walletAddress,
    minerKey,
    'medium',
    details || eventDetails
  );
}

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
    const walletAddress = extractWalletFromRequest(req) || 'unknown';
    const minerKey = (req.body?.miner_key || req.query?.miner_key || 'unknown') as string;
    const timestamp = new Date().toISOString();
    const consoleLog = `[L1 - ClientToken] ${timestamp} - Admin bypass allowed | Wallet: ${walletAddress} | Miner: ${minerKey}`;
    console.log(consoleLog);
    return true;
  }

  const token = req.headers['x-client-token'] as string | undefined;
  const userAgent = req.headers['user-agent'] || '';
  const walletAddress = extractWalletFromRequest(req) || 'unknown';
  const minerKey = (req.body?.miner_key || req.query?.miner_key || 'unknown') as string;

  if (!token) {
    await logLayer1Event(req, 'MISSING_CLIENT_TOKEN', walletAddress, minerKey);
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
    await logLayer1Event(req, 'INVALID_CLIENT_TOKEN', walletAddress, minerKey);
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
