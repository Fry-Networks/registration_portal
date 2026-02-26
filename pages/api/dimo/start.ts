import type { NextApiRequest, NextApiResponse } from 'next';
import crypto from 'node:crypto';
import { serialize } from 'cookie';
import { buildDimoAuthUrl, getDimoConfig } from '../../../lib/dimo/config';
import { enforceWalletApiSecurity } from '../../../lib/api/enforceWalletSecurity';
import { createApiError, ErrorCodes, handleApiError } from '../../../lib/api-errors';
import { getConfigFlag } from '../../../lib/config';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const resolvedMethod = req.method ?? 'POST';
  if (resolvedMethod !== 'GET' && resolvedMethod !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res
      .status(405)
      .json(createApiError(ErrorCodes.INVALID_INPUT, 'Only GET/POST are allowed for DIMO auth start.'));
  }

  try {
    // Feature flag guard so ops can disable/enable the flow without a redeploy.
    const dimoEnabled = await getConfigFlag('dimo_enabled', true);
    if (!dimoEnabled) {
      return res
        .status(403)
        .json(
          createApiError(
            ErrorCodes.FORBIDDEN,
            'DIMO login is not available right now',
            'Please check back after the announcement.'
          )
        );
    }

    const security = await enforceWalletApiSecurity(req, res, {
      endpoint: '/api/dimo/start',
      method: resolvedMethod
    });
    if (!security) return;

    const config = getDimoConfig();
    const state = crypto.randomBytes(16).toString('hex');
    const stateCookie = serialize('dimo_oauth_state', state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 10 * 60 // short-lived CSRF guard
    });

    res.setHeader('Set-Cookie', stateCookie);

    const authUrl = buildDimoAuthUrl(state, config);
    return res.status(200).json({ authUrl, state });
  } catch (error) {
    return handleApiError(res, '/api/dimo/start', error, {
      response: createApiError(
        ErrorCodes.INTERNAL_ERROR,
        'Unable to initiate DIMO login',
        'Please retry in a moment.'
      ),
      issueType: 'DIMO_START_ERROR',
      part: 'dimo.start.handler'
    });
  }
}
