import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceWalletApiSecurity } from '../../../lib/api/enforceWalletSecurity';
import { createApiError, ErrorCodes, handleApiError } from '../../../lib/api-errors';
import { findEligibleSubscriptions } from '../../../lib/dimo/store';
import { getConfigFlag } from '../../../lib/config';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const resolvedMethod = req.method ?? 'POST';
  if (resolvedMethod !== 'GET' && resolvedMethod !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res
      .status(405)
      .json(createApiError(ErrorCodes.INVALID_INPUT, 'Only GET/POST are allowed for eligibility checks.'));
  }

  try {
    // Guard the endpoint behind the Mongo-driven toggle to avoid surprise launches.
    const dimoEnabled = await getConfigFlag('dimo_enabled', true);
    if (!dimoEnabled) {
      return res
        .status(403)
        .json(
          createApiError(
            ErrorCodes.FORBIDDEN,
            'DIMO eligibility is not available',
            'Please try again after the announcement.'
          )
        );
    }

    const security = await enforceWalletApiSecurity(req, res, {
      endpoint: '/api/dimo/eligible',
      method: resolvedMethod
    });
    if (!security) return;

    const subs = await findEligibleSubscriptions(security.session.user.address);
    return res.status(200).json({
      subscriptions: subs.map((s) => ({
        subscriptionId: s.dimo_subscription_id,
        plan: s.plan,
        status: s.status,
        eligible: s.eligible,
        eligibilityReason: s.eligibility_reason,
        startedAt: s.started_at,
        renewalAt: s.renewal_at,
        graceExpiresAt: s.grace_expires_at,
        claimed: Boolean(s.claimed_at || s.miner_key_hash),
        minerKeyChecksum: s.miner_key_checksum
      }))
    });
  } catch (error) {
    return handleApiError(res, '/api/dimo/eligible', error, {
      response: createApiError(
        ErrorCodes.INTERNAL_ERROR,
        'Unable to load DIMO eligibility',
        'Please retry the request.'
      ),
      issueType: 'DIMO_ELIGIBILITY_ERROR',
      part: 'dimo.eligible.handler'
    });
  }
}
