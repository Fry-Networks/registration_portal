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
import { getToken } from 'next-auth/jwt';
import { logSecurityEventAggregated } from './securityEventAggregation';

// R11: no fallback. The previous default was a public constant that also shipped in the
// client bundle, so falling back to it silently disabled L2 entirely. Missing secret now
// fails closed at the call sites (deriveSigningKey throws).
const SIGNATURE_SECRET = process.env.REQUEST_SIGNATURE_SECRET;
const MAX_AGE_SECONDS = 900; // 15 minutes — increased from 5 min to tolerate clock skew while clients adopt serverTime

// Clients cache the derived key; keep that cache inside the server's own signature window.
export const SIGNING_KEY_TTL_SECONDS = MAX_AGE_SECONDS;

/**
 * Derive the per-session L2 signing key (R11).
 *
 * The key handed to the browser is HMAC(server secret, session identity) rather than the
 * server secret itself, so a leaked key compromises one session rather than the whole scheme,
 * and a key minted for one session cannot sign for another. Binding in session.expires makes
 * the key rotate whenever the session does.
 *
 * Both inputs MUST be stable for the life of the session. Do NOT pass session.expires or
 * the JWT's iat/exp: NextAuth re-issues the token while a page is open, so those drift and
 * the key would change between the request that issues it and the request that uses it.
 * Callers pass the JWT's `sid` claim, which is minted once at sign-in.
 *
 * Throws when REQUEST_SIGNATURE_SECRET is unset so the caller fails closed.
 */
export function deriveSigningKey(sessionAddress: string, sessionIssuedAt: string): string {
  if (!SIGNATURE_SECRET) {
    throw new Error('REQUEST_SIGNATURE_SECRET is not configured');
  }
  const crypto = require('crypto');
  return crypto
    .createHmac('sha256', SIGNATURE_SECRET)
    .update(`fry-l2-signing-key|v2|${sessionAddress}|${sessionIssuedAt}`)
    .digest('hex');
}

type RequestWithSessionWallet = NextApiRequest & {
  _sessionWalletAddress?: string;
  // Set by enforceWalletApiSecurity from the authenticated session (R11).
  _sessionSigningKey?: string;
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
  // The signature-gated routes call this directly rather than through
  // enforceWalletApiSecurity, so the per-session key cannot be assumed to be present.
  // Derive it here from the request's own session JWT when it is missing.
  if (req) {
    const tagged = req as RequestWithSessionWallet;
    if (!tagged._sessionSigningKey) {
      try {
        const jwt = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
        const subject =
          (jwt?.address as string | undefined) || (jwt?.sub as string | undefined) || '';
        if (jwt && subject) {
          tagged._sessionSigningKey = deriveSigningKey(subject, String(jwt.sid ?? ''));
        }
      } catch {
        // No usable session: fall through and fail closed in verifyRequestSignature.
      }
    }
  }
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

  // R11: verify against the caller's PER-SESSION key, set by enforceWalletApiSecurity.
  // The previous implementation also dual-accepted a hardcoded legacy constant that shipped
  // in the client bundle — so any visitor could mint a valid signature and L2 was not a
  // boundary at all. There is deliberately no fallback here: no key, no pass.
  const signingKey = (req as RequestWithSessionWallet | undefined)?._sessionSigningKey;
  if (!signingKey) {
    if (req) {
      logLayer2Event(req, 'MISSING_SIGNATURE', walletAddress, minerKey, 'No per-session signing key on request').catch(() => {});
    }
    return false;
  }

  // Use timing-safe comparison to prevent timing attacks
  try {
    const expected = crypto
      .createHmac('sha256', signingKey)
      .update(message)
      .digest('hex');
    const valid = crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));

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
