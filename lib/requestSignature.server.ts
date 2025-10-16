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
 */

import { NextApiRequest } from 'next';

const SIGNATURE_SECRET = process.env.REQUEST_SIGNATURE_SECRET || 'REDACTED_ROTATE_ME';
const MAX_AGE_SECONDS = 300; // 5 minutes

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
