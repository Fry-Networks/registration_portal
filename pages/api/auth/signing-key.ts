import type { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { getToken } from 'next-auth/jwt';

import { authOptions } from './[...nextauth]';
import { deriveSigningKey, SIGNING_KEY_TTL_SECONDS } from '../../../lib/requestSignature.server';
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

  let key: string;
  try {
    key = deriveSigningKey(session.user.address, String(jwt.sid ?? ''));
  } catch (err) {
    // REQUEST_SIGNATURE_SECRET missing: fail closed rather than fall back to a known constant.
    console.error('[signing-key] unable to derive signing key', err);
    return res
      .status(500)
      .json(createApiError('SIGNING_KEY_UNAVAILABLE', 'Request signing is temporarily unavailable'));
  }

  return res.status(200).json({
    key,
    expiresAt: session.expires,
    ttlSeconds: SIGNING_KEY_TTL_SECONDS
  });
}
