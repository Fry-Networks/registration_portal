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

const SIGNATURE_SECRET = process.env.REQUEST_SIGNATURE_SECRET || 'REDACTED_ROTATE_ME';
const MAX_AGE_SECONDS = 300; // 5 minutes

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
      const walletAddress = req.body?.address || req.body?.wallet;
      const isAdmin = await isAdminWallet(walletAddress);
      if (isAdmin) {
        // Admin users bypass signature verification
        console.log('[RequestSignature] Admin user bypassed signature verification:', walletAddress);
        return true;
      }
    } catch (err) {
      console.error('[RequestSignature] Error checking admin status:', err);
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

  // Check timestamp is within acceptable range
  const now = Math.floor(Date.now() / 1000);
  const age = now - timestamp;

  if (age > MAX_AGE_SECONDS) {
    console.warn('[RequestSignature] Request too old:', {
      timestamp,
      now,
      age,
      maxAge: MAX_AGE_SECONDS
    });
    if (req) {
      // Dynamic import to avoid bundling MongoDB into client
      import('./securityMonitoring').then(({ logSecurityEvent }) => {
        logSecurityEvent(req, 'EXPIRED_TIMESTAMP', 'high', `Request expired: ${age}s old`).catch(() => {});
      }).catch(() => {});
    }
    return false;
  }

  if (age < -10) {
    // Clock skew tolerance: allow up to 10 seconds in the future
    console.warn('[RequestSignature] Request timestamp in future:', {
      timestamp,
      now,
      skew: age
    });
    if (req) {
      // Dynamic import to avoid bundling MongoDB into client
      import('./securityMonitoring').then(({ logSecurityEvent }) => {
        logSecurityEvent(req, 'INVALID_SIGNATURE', 'medium', 'Request timestamp in future').catch(() => {});
      }).catch(() => {});
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
      // Dynamic import to avoid bundling MongoDB into client
      import('./securityMonitoring').then(({ logSecurityEvent }) => {
        logSecurityEvent(req, 'INVALID_SIGNATURE', 'high', 'Signature verification failed').catch(() => {});
      }).catch(() => {});
    }
    
    return valid;
  } catch (err) {
    // Buffers are not equal length (signature is invalid format)
    if (req) {
      // Dynamic import to avoid bundling MongoDB into client
      import('./securityMonitoring').then(({ logSecurityEvent }) => {
        logSecurityEvent(req, 'TAMPERED_REQUEST', 'critical', 'Request body tampering detected').catch(() => {});
      }).catch(() => {});
    }
    return false;
  }
}
