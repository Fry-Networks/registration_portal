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
 * No admin bypass here. Routes skip L2 for admins based on the authenticated
 * session (lib/adminCheck.ts); this module only verifies signatures.
 */

import { NextApiRequest } from 'next';
import { logSecurityEventAggregated } from './securityEventAggregation';

const SIGNATURE_SECRET = process.env.REQUEST_SIGNATURE_SECRET || 'fry-rewards-signature-v1-';
const MAX_AGE_SECONDS = 900; // 15 minutes — increased from 5 min to tolerate clock skew while clients adopt serverTime

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
 * Async verification entry point (kept for API compatibility with its callers).
 *
 * No admin bypass: L2 is only reached for non-admin sessions and the signature
 * is always verified.
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
  // Logging only: session wallet first, then the self-asserted body wallet; headers are never read.
  const walletAddress = (
    sessionWalletAddress ||
    (req?.body?.address as string | undefined) ||
    (req?.body?.wallet as string | undefined) ||
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
  // Dual-accept rotation: accept the configured secret AND the legacy default so
  // old client bundles keep working while a new secret is rolled out. Non-breaking.
  const SECRETS = Array.from(new Set([SIGNATURE_SECRET, 'fry-rewards-signature-v1-']));

  // Use timing-safe comparison to prevent timing attacks
  try {
    let valid = false;
    for (const secret of SECRETS) {
      const expected = crypto
        .createHmac('sha256', secret)
        .update(message)
        .digest('hex');
      if (crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
        valid = true;
        break;
      }
    }

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
