import type { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { getToken } from 'next-auth/jwt';

import { authOptions } from './[...nextauth]';
import { deriveSigningKey, SIGNING_KEY_TTL_SECONDS } from '../../../lib/requestSignature.server';
import { deriveClientToken } from '../../../lib/clientTokenMiddleware';
import { CommonErrors, createApiError } from '../../../lib/api-errors';

/**
 * Issues the per-session L2 request-signing key.
 *
 * Before R11 the client signed with a build-time constant that shipped in the JS bundle, so
 * any visitor could mint a valid signature and L2 added no real boundary. The key is now
 * derived server-side from the caller's own session and handed only to an authenticated
 * caller, so an anonymous client cannot produce a valid signature at all.
 *
 * The derivation is session-scoped (address + session expiry), so a key minted for one
 * session cannot sign for another, and the key rotates when the session does.
 *
 * R12: the same endpoint now also issues the L1 `x-client-token`. It used to be
 * sha256('<constant>' + userAgent) from a constant that shipped in the client bundle, so it was
 * public. It is now derived from the same session identity plus the caller's User-Agent.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json(createApiError('METHOD_NOT_ALLOWED', 'Use GET'));
  }

  const session = await getServerSession(req, res, authOptions);

  if (!session || !session.user || !session.user.address) {
    return res.status(401).json(CommonErrors.noSession());
  }

  // This is a per-session credential: it must never be cached by the browser or the CDN.
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');

  // Bind to the stable session id. NOT iat/expires: both are re-issued while a page is
  // open, which would invalidate a key the client already holds.
  const jwt = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  if (!jwt) {
    return res.status(401).json(CommonErrors.noSession());
  }

  // The L1 token is bound to the User-Agent as well, so it must be derived from the very
  // header the browser will replay on the protected request.
  const userAgent = String(req.headers['user-agent'] || '');

  let key: string;
  let clientToken: string;
  try {
    key = deriveSigningKey(session.user.address, String(jwt.sid ?? ''));
    clientToken = deriveClientToken(session.user.address, String(jwt.sid ?? ''), userAgent);
  } catch (err) {
    // REQUEST_SIGNATURE_SECRET missing: fail closed rather than fall back to a known constant.
    console.error('[signing-key] unable to derive signing key', err);
    return res
      .status(500)
      .json(createApiError('SIGNING_KEY_UNAVAILABLE', 'Request signing is temporarily unavailable'));
  }

  return res.status(200).json({
    key,
    clientToken,
    expiresAt: session.expires,
    ttlSeconds: SIGNING_KEY_TTL_SECONDS
  });
}
