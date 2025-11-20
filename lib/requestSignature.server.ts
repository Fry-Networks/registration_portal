/**
 * Request Signature Verification (SERVER-SIDE ONLY)
 * 
 * This file contains ONLY server-side signature verification.
 * Client-side generation is in requestSignature.client.ts
 * 
 * Prevents:
 * - Request tampering (body modification)
 * - Request replay attacks (time-bound signatures)
 * - Unauthorized signature generation (only frontend knows the secret)
 * 
 * ADMIN BYPASS: If the wallet address has admin=true in registration-users,
 * signature verification is skipped.
 */

import { NextApiRequest } from 'next';
import { isAdminWallet } from './adminCheck';
import { logSecurityEventAggregated } from './securityEventAggregation';

const SIGNATURE_SECRET = process.env.REQUEST_SIGNATURE_SECRET || 'REDACTED_ROTATE_ME';
const MAX_AGE_SECONDS = 300; // 5 minutes

type RequestWithSessionWallet = NextApiRequest & {
  _sessionWalletAddress?: string;
};

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
 * Helper: Log Layer 2 security event to console and aggregated MongoDB
 */
async function logLayer2Event(
  req: NextApiRequest,
  eventType: 'MISSING_SIGNATURE' | 'INVALID_SIGNATURE' | 'EXPIRED_TIMESTAMP' | 'TAMPERED_REQUEST',
  walletAddress: string,
  minerKey: string,
  details?: string
): Promise<void> {
  const layerName = 'L2 - RequestSignature';
  
  let eventDetails = '';
  let severity: 'low' | 'medium' | 'high' | 'critical' = 'high';
  
  if (eventType === 'MISSING_SIGNATURE') {
    eventDetails = 'Signature or timestamp missing';
  } else if (eventType === 'INVALID_SIGNATURE') {
    eventDetails = 'Signature verification failed';
  } else if (eventType === 'EXPIRED_TIMESTAMP') {
    eventDetails = 'Request timestamp expired';
  } else if (eventType === 'TAMPERED_REQUEST') {
    eventDetails = 'Request body tampering detected';
    severity = 'critical';
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
    severity,
    details || eventDetails
  );
}

/**
 * Verify a request signature with admin bypass (ASYNC).
 * 
 * This async wrapper checks if the wallet is admin FIRST.
 * If admin, returns true without verification.
 * If not admin, calls verifyRequestSignature for full verification.
 * 
 * Backend usage:
 *   if (!await verifyRequestSignatureAsync('POST', '/api/rewards/claim', body, timestamp, signature, req)) {
 *     return res.status(403).json({ error: 'Invalid signature' });
 *   }
 */
export async function verifyRequestSignatureAsync(
  method: string,
  path: string,
  body: any,
  timestamp: number,
  signature: string,
  req?: NextApiRequest
): Promise<boolean> {
  // Admin bypass: check if wallet is admin
  if (req) {
    try {
      const walletAddress = req.body?.address || req.body?.wallet || 'unknown';
      const minerKey = (req.body?.miner_key || req.query?.miner_key || 'unknown') as string;
      const isAdmin = await isAdminWallet(walletAddress);
      if (isAdmin) {
        // Admin users bypass signature verification
        const timeStr = new Date().toISOString();
        const consoleLog = `[L2 - RequestSignature] ${timeStr} - Admin bypass allowed | Wallet: ${walletAddress} | Miner: ${minerKey}`;
        console.log(consoleLog);
        return true;
      }
    } catch (err) {
      console.error('[L2 - RequestSignature] Error checking admin status:', err);
      // Fall through to normal verification
    }
  }

  // Non-admin: perform full verification (sync version)
  return verifyRequestSignature(method, path, body, timestamp, signature, req);
}

/**
 * Verify a request signature server-side (Node.js implementation).
 * 
 * Backend usage:
 *   if (!verifyRequestSignature('POST', '/api/rewards/claim', body, timestamp, signature)) {
 *     return res.status(403).json({ error: 'Invalid signature' });
 *   }
 */
export function verifyRequestSignature(
  method: string,
  path: string,
  body: any,
  timestamp: number,
  signature: string,
  req?: NextApiRequest
): boolean {
  // Must be called from backend
  if (typeof window !== 'undefined') {
    throw new Error('verifyRequestSignature should only be called from backend');
  }

  const crypto = require('crypto');
  const sessionWalletAddress = (req as RequestWithSessionWallet | undefined)?._sessionWalletAddress;
  const headerWallet =
    (typeof req?.headers?.['x-wallet'] === 'string' ? (req.headers['x-wallet'] as string) : undefined) ??
    (typeof req?.headers?.['x-address'] === 'string' ? (req.headers['x-address'] as string) : undefined);

  const walletAddress = (
    (req?.body?.address as string | undefined) ||
    (req?.body?.wallet as string | undefined) ||
    sessionWalletAddress ||
    headerWallet ||
    'unknown'
  ) as string;  
  const minerKey = (req?.body?.miner_key || req?.query?.miner_key || 'unknown') as string;

  // Check timestamp is within acceptable range
  const now = Math.floor(Date.now() / 1000);
  const age = now - timestamp;

  if (age > MAX_AGE_SECONDS) {
    if (req) {
      logLayer2Event(req, 'EXPIRED_TIMESTAMP', walletAddress, minerKey, `Request expired: ${age}s old`).catch(() => {});
    }
    return false;
  }

  if (age < -10) {
    // Clock skew tolerance: allow up to 10 seconds in the future
    if (req) {
      logLayer2Event(req, 'INVALID_SIGNATURE', walletAddress, minerKey, `Request timestamp in future by ${Math.abs(age)}s`).catch(() => {});
    }
    return false;
  }

  // Compute expected signature
  const message = `${method}|${path}|${JSON.stringify(body)}|${timestamp}`;
  const expected = crypto
    .createHmac('sha256', SIGNATURE_SECRET)
    .update(message)
    .digest('hex');

  // Use timing-safe comparison to prevent timing attacks
  try {
    const valid = crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expected)
    );
    
    if (!valid && req) {
      logLayer2Event(req, 'INVALID_SIGNATURE', walletAddress, minerKey).catch(() => {});
    }
    
    return valid;
  } catch (err) {
    // Buffers are not equal length (signature is invalid format)
    if (req) {
      logLayer2Event(req, 'TAMPERED_REQUEST', walletAddress, minerKey).catch(() => {});
    }
    return false;
  }
}
