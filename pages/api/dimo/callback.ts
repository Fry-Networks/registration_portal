import type { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { serialize } from 'cookie';
import { authOptions } from '../auth/[...nextauth]';
import { CommonErrors, createApiError, ErrorCodes, handleApiError } from '../../../lib/api-errors';
import { getDimoConfig } from '../../../lib/dimo/config';
import { verifyAndFetchSubscriptions } from '../../../lib/dimo/client';
import { upsertSubscriptions } from '../../../lib/dimo/store';
import { loggers } from '../../../lib/logger';
import { enforceWalletApiSecurity } from '../../../lib/api/enforceWalletSecurity';
import { enforceOperationRateLimit } from '../../../lib/api/operationRateLimit';
import { getConfigFlag } from '../../../lib/config';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const resolvedMethod = req.method ?? 'POST';
  if (resolvedMethod !== 'GET' && resolvedMethod !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res
      .status(405)
      .json(createApiError(ErrorCodes.INVALID_INPUT, 'Only GET/POST are allowed for the DIMO callback.'));
  }

  // Short-circuit if ops have the DIMO flow disabled.
  const dimoEnabled = await getConfigFlag('dimo_enabled', true);
  if (!dimoEnabled) {
    return res.status(403).json(
      createApiError(
        ErrorCodes.FORBIDDEN,
        'DIMO sync is disabled right now',
        'Please try again after the launch window.'
      )
    );
  }

  let session = await getServerSession(req, res, authOptions);

  if (resolvedMethod === 'POST') {
    const security = await enforceWalletApiSecurity(req, res, {
      endpoint: '/api/dimo/callback',
      method: resolvedMethod
    });
    if (!security) return;
    session = security.session;

    const rateLimit = await enforceOperationRateLimit({
      req,
      res,
      action: 'dimo:sync',
      minerKey: 'dimo:sync',
      address: security.session.user.address
    });
    if (!rateLimit.allowed) return;
  }

  if (!session || !session.user?.address) {
    return res.status(401).json(CommonErrors.noSession());
  }

  const isPost = resolvedMethod === 'POST';
  const stateParam = isPost ? (req.body?.state as string | undefined) : (req.query.state as string | undefined);
  const userJwtParam = isPost ? (req.body?.userJwt as string | undefined) : (req.query.userJwt as string | undefined);

  if (!stateParam || typeof stateParam !== 'string') {
    return res.status(400).json(
      createApiError(
        ErrorCodes.INVALID_INPUT,
        'Missing state from DIMO',
        'Please retry logging in with DIMO.'
      )
    );
  }

  const stateCookie = req.cookies?.['dimo_oauth_state'];
  if (!stateCookie || stateCookie !== stateParam) {
    return res.status(403).json(
      createApiError(
        ErrorCodes.FORBIDDEN,
        'DIMO state check failed',
        'Please restart the DIMO login flow.'
      )
    );
  }

  const token = typeof userJwtParam === 'string' ? userJwtParam : undefined;
  if (!token) {
    return res.status(400).json(
      createApiError(
        ErrorCodes.INVALID_INPUT,
        'Missing user token from DIMO',
        'Please retry logging in with DIMO.'
      )
    );
  }

  // Clear the state cookie after use to avoid reuse.
  res.setHeader(
    'Set-Cookie',
    serialize('dimo_oauth_state', '', {
      path: '/',
      expires: new Date(0)
    })
  );

  try {
    const config = getDimoConfig();
    // Verify JWT, fetch account (for user id) and subscriptions with the same token.
    const { account, subscriptions } = await verifyAndFetchSubscriptions(token);

    await upsertSubscriptions({
      subs: subscriptions,
      walletAddress: session.user.address,
      config,
      dimoUserId: account?.id || undefined,
      dimoEmail: account?.email?.address || null
    });

    loggers.userAction('dimo_sync_success', session.user.address, {
      dimoAccountId: account?.id ?? 'unknown',
      subscriptionCount: subscriptions.length,
      endpoint: '/api/dimo/callback'
    });

    const wantsJson =
      resolvedMethod === 'POST' || (req.headers.accept ?? '').includes('application/json');

    // Redirect back to the dashboard when this was a browser redirect; return JSON for XHR callers.
    if (wantsJson) {
      return res.status(200).json({
        success: true,
        accountId: account?.id,
        subscriptions: subscriptions.map((s) => ({
          subscriptionId: s.subscriptionId,
          plan: s.plan,
          status: s.status,
          startedAt: s.startedAt,
          renewalAt: s.renewalAt
        }))
      });
    }

    return res.redirect(302, '/dimo?connected=1');
  } catch (error) {
    const status = (error as { status?: number })?.status;
    const decodedAud = (error as { dimoDecoded?: { aud?: string | string[] } })?.dimoDecoded?.aud;
    const audValue = Array.isArray(decodedAud) ? decodedAud.join(', ') : decodedAud;
    const responseSnippet = (error as { responseSnippet?: string })?.responseSnippet ?? '';
    // If subscriptions return 404 for a verified JWT, surface a clearer message to the user.
    if (status === 404 && audValue) {
      return res.status(502).json(
        createApiError(
          ErrorCodes.INTERNAL_ERROR,
          'We could not load your DIMO subscriptions with this login.',
          'Please contact support through our Discord Helpdesk.',
          { dimoAudience: audValue }
        )
      );
    }
    const code = (error as any)?.code;
    if (code === 'DIMO_WALLET_CONFLICT') {
      return res.status(409).json(
        createApiError(
          ErrorCodes.FORBIDDEN,
          'This DIMO subscription is already linked to another wallet',
          'Please sign in with the wallet that originally linked it.'
        )
      );
    }
    if (code === 'DIMO_USER_CONFLICT') {
      return res.status(409).json(
        createApiError(
          ErrorCodes.FORBIDDEN,
          'This DIMO account is already linked to another wallet',
          'Please sign in with the wallet that originally linked it.'
        )
      );
    }
    if (code === 'DIMO_USER_ID_MISSING') {
      return res.status(502).json(
        createApiError(
          ErrorCodes.INTERNAL_ERROR,
          'Unable to verify your DIMO account identity',
          'Please retry DIMO login or contact support.'
        )
      );
    }
    loggers.userAction('dimo_sync_failed', session.user.address, {
      endpoint: '/api/dimo/callback',
      error: error instanceof Error ? error.message : String(error),
      dimoAccountId: undefined
    });
    const endpointHint = (error as { endpoint?: string })?.endpoint;
    const subscriptionAttempts = (error as { attempts?: Array<{ url: string; status?: number }> })?.attempts;
    return handleApiError(res, '/api/dimo/callback', error, {
      response: createApiError(
        ErrorCodes.INTERNAL_ERROR,
        'Unable to sync your DIMO subscriptions',
        'Please retry the login.'
      ),
      walletAddress: session.user.address,
      issueType: 'DIMO_CALLBACK_ERROR',
      part: 'dimo.callback.handler',
      metadata: {
        dimoEndpoint: endpointHint,
        dimoResponseSnippet: responseSnippet,
        // Emit attempt history to diagnose endpoint mismatches.
        dimoSubscriptionAttempts: subscriptionAttempts
      }
    });
  }
}
