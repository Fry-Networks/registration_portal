import type { NextApiRequest, NextApiResponse } from 'next';

import { enforceWalletApiSecurity } from '../../../lib/api/enforceWalletSecurity';
import { createApiError, ErrorCodes } from '../../../lib/api-errors';
import type { DeviceAction } from '../../../lib/db/requestLocks';
import { peekOperationRateLimit } from '../../../lib/api/operationRateLimit';

const CONTEXT_TO_ACTION: Record<string, DeviceAction> = {
  verification: 'stake:verification',
  registration: 'stake:registration',
  node: 'stake:node'
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.status(405).json(createApiError(ErrorCodes.INVALID_INPUT, 'Unsupported method.'));
    return;
  }

  const { miner_key: miner, address, context } = req.body ?? {};

  if (typeof miner !== 'string' || miner.length === 0) {
    res.status(400).json(createApiError(ErrorCodes.INVALID_INPUT, 'Missing miner key for stake precheck.'));
    return;
  }

  if (typeof context !== 'string' || !(context in CONTEXT_TO_ACTION)) {
    res.status(400).json(createApiError(ErrorCodes.INVALID_INPUT, 'Invalid staking context supplied.'));
    return;
  }

  const security = await enforceWalletApiSecurity(req, res, {
    endpoint: '/api/stake/precheck',
    minerKey: miner
  });
  if (!security) {
    return;
  }

  const { session } = security;

  if (!address || session.user.address !== address) {
    res.status(401).json(createApiError(ErrorCodes.WALLET_MISMATCH, 'Wallet mismatch detected.'));
    return;
  }

  const action = CONTEXT_TO_ACTION[context];
  const status = peekOperationRateLimit({
    req,
    action,
    address: session.user.address,
    minerKey: miner
  });

  if (!status.allowed) {
    if (typeof status.retryAfterMs === 'number' && status.retryAfterMs > 0) {
      res.setHeader('Retry-After', Math.ceil(status.retryAfterMs / 1000));
    }
    res.status(429).json(
      createApiError(
        ErrorCodes.RATE_LIMIT_EXCEEDED,
        `Too many ${context} staking requests. Please wait before trying again.`,
        'Give it a moment for the previous requests to finish before submitting another stake.'
      )
    );
    return;
  }

  res.status(200).json({ allowed: true });
}
