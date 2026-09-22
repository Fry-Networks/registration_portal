import type { NextApiRequest, NextApiResponse } from 'next';
import type { Session } from 'next-auth';
import { getServerSession } from 'next-auth';
import { getToken } from 'next-auth/jwt';

import { authOptions } from '../../pages/api/auth/[...nextauth]';
import { verifyClientToken } from '../clientTokenMiddleware';
import { deriveSigningKey, verifyRequestSignatureAsync } from '../requestSignature.server';
import { verifyDeviceFingerprintMiddleware } from '../deviceFingerprint';
import { CommonErrors, createApiError } from '../api-errors';
import { isAdminRequest } from '../adminCheck';

type SecurityContext = {
  endpoint: string;
  minerKey?: string;
  method?: string;
};

type AuthenticatedSession = Session & { user: NonNullable<Session['user']> };

type RequestWithSessionState = NextApiRequest & {
  _sessionWalletAddress?: string;
  _sessionSigningKey?: string;
};

export interface WalletSecurityResult {
  session: AuthenticatedSession;
  isAdmin: boolean;
}

export const enforceWalletApiSecurity = async (
  req: NextApiRequest,
  res: NextApiResponse,
  { endpoint, minerKey, method }: SecurityContext
): Promise<WalletSecurityResult | null> => {
  const resolvedMethod = method ?? req.method ?? 'POST';
  const session = await getServerSession(req, res, authOptions);
  if (session?.user?.address) {
    (req as RequestWithSessionState)._sessionWalletAddress = session.user.address;
  }

  const isAdmin = await isAdminRequest(req, session);

  if (!isAdmin) {
    const tokenVerified = await verifyClientToken(req, res);
    if (!tokenVerified) {
      return null;
    }

    // The L2 signing key is derived from the session (R11). Without a session there is no key
    // to verify against, so an anonymous caller is answered with the same 401 it received
    // before — not a signature error — keeping the unauthenticated contract unchanged.
    if (!session?.user?.address) {
      res.status(401).json(CommonErrors.noSession());
      return null;
    }

    const signature = req.headers['x-request-signature'] as string | undefined;
    const timestampHeader = req.headers['x-request-timestamp'];
    const timestamp = typeof timestampHeader === 'string' ? Number(timestampHeader) : NaN;

    if (!signature || Number.isNaN(timestamp)) {
      // RC5 (r12): the body carries the server's own clock so a skewed client can correct its
      // offset and retry. Before this, serverTime only ever reached the client on a SUCCESSFUL
      // response, so a client whose clock was outside the window could never recover.
      res.status(403).json(
        createApiError(
          'MISSING_SIGNATURE',
          'Request signature or timestamp missing',
          undefined,
          { serverTime: Date.now() }
        )
      );
      return null;
    }

    // Must match the identifier /api/auth/signing-key used, or every correct signature is
    // rejected. sid is stable across token re-issues; iat and expires are not.
    const jwt = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
    if (!jwt) {
      res.status(401).json(CommonErrors.noSession());
      return null;
    }

    try {
      (req as RequestWithSessionState)._sessionSigningKey = deriveSigningKey(
        session.user.address,
        String(jwt.sid ?? '')
      );
    } catch (err) {
      // REQUEST_SIGNATURE_SECRET missing: fail closed rather than accept a known constant.
      console.error('[enforceWalletApiSecurity] unable to derive signing key', err);
      res.status(500).json(
        createApiError(
          'SIGNING_KEY_UNAVAILABLE',
          'Request signing is temporarily unavailable'
        )
      );
      return null;
    }

    const signatureValid = await verifyRequestSignatureAsync(
      resolvedMethod,
      endpoint,
      req.body,
      timestamp,
      signature,
      req
    );

    if (!signatureValid) {
      // RC5 (r12): see above — an expired timestamp surfaces here as INVALID_SIGNATURE (the
      // EXPIRED_TIMESTAMP distinction is server-log only), so this is THE body a clock-skewed
      // client sees. The code string is unchanged; only serverTime is added.
      res.status(403).json(
        createApiError(
          'INVALID_SIGNATURE',
          'Invalid or expired request signature',
          undefined,
          { serverTime: Date.now() }
        )
      );
      return null;
    }
  }

  if (!session || !session.user) {
    res.status(401).json(CommonErrors.noSession());
    return null;
  }

  const fingerprintStatus = await verifyDeviceFingerprintMiddleware(req, session, isAdmin, {
    walletAddress: session.user.address,
    minerKey: minerKey ?? endpoint
  });

  if (fingerprintStatus === 'retry') {
    res.status(409).json(
      createApiError(
        'DEVICE_FINGERPRINT_REFRESH',
        'Security check refreshed your session. Please retry the request.'
      )
    );
    return null;
  }

  if (fingerprintStatus === 'blocked') {
    res.status(403).json(
      createApiError(
        'DEVICE_MISMATCH',
        'Request originated from a different device or script',
        undefined,
        { serverTime: Date.now() }
      )
    );
    return null;
  }

  return { session: session as AuthenticatedSession, isAdmin };
};
