/**
 * Client Token Verification Middleware
 *
 * Verifies that API requests carry the PER-SESSION client token issued by
 * GET /api/auth/signing-key.
 *
 * 2026-09-22 (R12): the token used to be sha256('<constant>' + userAgent) from a constant that
 * this file and lib/clientToken.ts both hardcoded. That constant shipped inside the client
 * bundle, so it was public — anyone could compute a valid x-client-token and L1 was not a
 * boundary at all. It is now HMAC(REQUEST_SIGNATURE_SECRET, session identity | userAgent),
 * exactly mirroring the R11 L2 fix (lib/requestSignature.server.ts deriveSigningKey), so the
 * token cannot be produced without a real session and cannot be replayed into another one.
 *
 * This prevents automated scripts (curl, Node.js, etc.) from calling sensitive endpoints even
 * if they have a valid session cookie, because the token is also bound to the User-Agent.
 */

import { NextApiRequest, NextApiResponse, NextApiHandler } from 'next';
import crypto from 'crypto';
import { getToken } from 'next-auth/jwt';
import { logSecurityEventAggregated } from './securityEventAggregation';
import { CommonErrors } from './api-errors';

type RequestWithSessionWallet = NextApiRequest & { _sessionWalletAddress?: string };

/**
 * Derive the per-session L1 client token (R12).
 *
 * Both session inputs MUST be stable for the life of the session, for the same reason
 * deriveSigningKey documents: NextAuth re-issues the JWT while a page is open, so iat/exp and
 * session.expires drift. Callers pass the `sid` claim, minted once at sign-in.
 *
 * The secret is read at call time so a missing secret fails closed on every request rather than
 * only on the one that happened to load the module.
 *
 * Throws when REQUEST_SIGNATURE_SECRET is unset so the caller fails closed.
 */
export function deriveClientToken(
  sessionAddress: string,
  sessionId: string,
  userAgent: string
): string {
  const secret = process.env.REQUEST_SIGNATURE_SECRET;
  if (!secret) {
    throw new Error('REQUEST_SIGNATURE_SECRET is not configured');
  }
  return crypto
    .createHmac('sha256', secret)
    .update(`fry-l1-client-token|v2|${sessionAddress}|${sessionId}|${userAgent}`)
    .digest('hex');
}

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
    eventDetails = 'Client token does not match the session';
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
 * The token should be sent as the 'x-client-token' header. We recompute the expected value from
 * the caller's OWN session (address + sid, taken from the request's JWT) and the User-Agent
 * header, and compare in constant time.
 *
 * No admin bypass here: there is no session decision in scope. Routes that skip L1 for
 * admins decide that from the authenticated session (lib/adminCheck.ts).
 *
 * Fails closed: no token, no session, or no server secret all deny. The no-session case keeps
 * the 401 the caller already received from the session layer further down each route, so the
 * unauthenticated contract is unchanged.
 */
export async function verifyClientToken(req: NextApiRequest, res: NextApiResponse): Promise<boolean> {
  const token = req.headers['x-client-token'] as string | undefined;
  const userAgent = req.headers['user-agent'] || '';
  // Logging only (never a decision): session wallet, else the self-asserted body wallet.
  const walletAddress =
    (req as RequestWithSessionWallet)._sessionWalletAddress ||
    (req.body?.address as string | undefined) ||
    (req.body?.wallet as string | undefined) ||
    'unknown';
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

  // The token is derived from the caller's session, so without one there is nothing to compare
  // against. Answer with the same 401 the session layer would have produced rather than a
  // token error, so anonymous callers see exactly the status they saw before R12.
  let jwt: Awaited<ReturnType<typeof getToken>> = null;
  try {
    jwt = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  } catch {
    jwt = null;
  }
  const subject = (jwt?.address as string | undefined) || (jwt?.sub as string | undefined) || '';
  if (!jwt || !subject) {
    res.status(401).json(CommonErrors.noSession());
    return false;
  }

  // Recompute the expected token for THIS session and this User-Agent.
  let expectedToken: string;
  try {
    expectedToken = deriveClientToken(subject, String(jwt.sid ?? ''), String(userAgent));
  } catch (err) {
    // REQUEST_SIGNATURE_SECRET missing: fail closed rather than accept anything.
    console.error('[ClientToken] unable to derive the expected client token', err);
    await logLayer1Event(
      req,
      'INVALID_CLIENT_TOKEN',
      walletAddress,
      minerKey,
      'Server signing secret unavailable'
    );
    res.status(403).json({
      success: false,
      code: 'INVALID_CLIENT_TOKEN',
      message: 'Invalid client token'
    });
    return false;
  }

  // Constant-time comparison; unequal lengths cannot be compared and are simply invalid.
  // Encoded as Uint8Array rather than Buffer so the comparison type-checks under the DOM lib.
  let valid = false;
  try {
    const encoder = new TextEncoder();
    const provided = encoder.encode(token);
    const expected = encoder.encode(expectedToken);
    valid = provided.length === expected.length && crypto.timingSafeEqual(provided, expected);
  } catch {
    valid = false;
  }

  if (!valid) {
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
 * No admin bypass (no session in scope).
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
