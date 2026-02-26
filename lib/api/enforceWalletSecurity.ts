import type { NextApiRequest, NextApiResponse } from 'next';
import type { Session } from 'next-auth';
import { getServerSession } from 'next-auth';

import { authOptions } from '../../pages/api/auth/[...nextauth]';
import { verifyClientToken } from '../clientTokenMiddleware';
import { verifyRequestSignatureAsync } from '../requestSignature.server';
import { verifyDeviceFingerprintMiddleware } from '../deviceFingerprint';
import { CommonErrors, createApiError } from '../api-errors';
import { isAdminRequest } from '../adminCheck';

type SecurityContext = {
  endpoint: string;
  minerKey?: string;
  method?: string;
};

type AuthenticatedSession = Session & { user: NonNullable<Session['user']> };

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
    (req as NextApiRequest & { _sessionWalletAddress?: string })._sessionWalletAddress =
      session.user.address;
  }

  const isAdmin = await isAdminRequest(req);

  if (!isAdmin) {
    const tokenVerified = await verifyClientToken(req, res);
    if (!tokenVerified) {
      return null;
    }

    const signature = req.headers['x-request-signature'] as string | undefined;
    const timestampHeader = req.headers['x-request-timestamp'];
    const timestamp = typeof timestampHeader === 'string' ? Number(timestampHeader) : NaN;

    if (!signature || Number.isNaN(timestamp)) {
      res.status(403).json(
        createApiError(
          'MISSING_SIGNATURE',
          'Request signature or timestamp missing'
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
      res.status(403).json(
        createApiError(
          'INVALID_SIGNATURE',
          'Invalid or expired request signature'
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
        'Request originated from a different device or script'
      )
    );
    return null;
  }

  return { session: session as AuthenticatedSession, isAdmin };
};
