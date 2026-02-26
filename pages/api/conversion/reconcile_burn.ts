import { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import {
  reconcileFryBurn,
  ReconcileBurnError
} from '../../../lib/conversion/reconcileBurn';
import { loggers } from '../../../lib/logger';
import {
  CommonErrors,
  createApiError,
  ErrorCodes,
  handleApiError,
} from '../../../lib/api-errors';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    res.status(405).json(
      createApiError(
        ErrorCodes.INVALID_INPUT,
        'That request is not available.',
        'Please retry this action from the dashboard.'
      )
    );
    return;
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session || !session.user?.address) {
    res.status(401).json(CommonErrors.noSession());
    return;
  }

  const isAdmin = Boolean((session.user as any)?.admin);
  if (!isAdmin) {
    res.status(403).json(
      createApiError(
        ErrorCodes.FORBIDDEN,
        'You do not have permission to reconcile burns',
        'Please contact an administrator for access.'
      )
    );
    return;
  }

  const data: {
    address?: string;
    txId?: string;
    id?: string;
  } = req.body;

  const address = typeof data?.address === 'string' ? data.address.trim() : '';
  const txId =
    typeof data?.txId === 'string' && data.txId.length > 0
      ? data.txId
      : typeof data?.id === 'string' && data.id.length > 0
      ? data.id
      : undefined;

  if (!address) {
    res.status(400).json(
      createApiError(
        ErrorCodes.INVALID_INPUT,
        'Wallet address is required.',
        'Submit a wallet address to reconcile burns.'
      )
    );
    return;
  }

  try {
    const result = await reconcileFryBurn({
      address,
      txId
    });

    res.status(200).json(result);
  } catch (error) {
    if (error instanceof ReconcileBurnError) {
      res.status(error.status).json({ success: false, message: error.message });
      return;
    }
    handleApiError(res, '/api/conversion/reconcile_burn', error, {
      response: createApiError(
        ErrorCodes.INTERNAL_ERROR,
        'Unexpected error reconciling conversion burn',
        'Please review the transaction details and try again.'
      ),
      walletAddress: address,
      issueType: 'FRY_CONVERSION_RECONCILE_ERROR',
      part: 'conversion.reconcile-burn.handler',
      metadata: {
        address,
        txId,
      },
    });
  }
}
