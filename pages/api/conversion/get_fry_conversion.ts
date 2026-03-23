import { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';

import { authOptions } from '../auth/[...nextauth]';
import clientPromise from '../../../lib/mongoclient';
import { loggers } from '../../../lib/logger';
import {
  CommonErrors,
  createApiError,
  ErrorCodes,
  handleApiError,
} from '../../../lib/api-errors';

const ENDPOINT = '/api/conversion/get_fry_conversion';

// FIP-010: Fixed 40:1 conversion ratio (FRY 1.0 → tFRY)
const TFRY_RATIO = 40;

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const session = await getServerSession(req, res, authOptions);
  // Check if user is authenticated
  if (!session || !session.user?.address) {
    res.status(401).json(CommonErrors.noSession());
    return;
  }

  const { address } = (req.body ?? {}) as {
    address?: string;
  };

  if (session.user.address !== address || !address) {
    loggers.apiError(ENDPOINT, new Error('Wallet mismatch retrieving conversion state'), {
      sessionAddress: session.user.address,
      address,
      issueType: 'FRY_CONVERSION_WALLET_MISMATCH',
      part: 'conversion.get-fry.auth',
    });
    res.status(401).json(CommonErrors.walletMismatch());
    return;
  }
  try {
    const client = await clientPromise;
    const db = client.db('main');
    const collection = db.collection('fry-conversions');
    const user = await collection.findOne({ address });
    if (!user) {
      res.status(404).json(
        createApiError(
          ErrorCodes.DEVICE_NOT_FOUND,
          'No conversion account found for this wallet',
          'Please verify the wallet address and try again.'
        )
      );
      return;
    }

    // FIP-010: No vesting - calculate full remaining claimable amount immediately
    const claimedMonths = Number(user.claimedMonths ?? 0);
    const remainingMonths = Math.max(0, 12 - claimedMonths);

    if (remainingMonths > 0) {
      // Calculate remaining FRY 1.0 amount to convert
      const remainingFry1 = (user.amount / 12) * remainingMonths;
      // FIP-010: Fixed 40:1 ratio for tFRY output
      const convertedAmount = remainingFry1 / TFRY_RATIO;

      const updateResult = await collection.updateOne(
        { address },
        {
          $set: {
            claimableMonths: remainingMonths,
            claimableAmount: convertedAmount,
            isProcessing: false
          },
          $unset: {
            processingStartedAt: ''
          }
        }
      );

      let success = true;
      if (updateResult.matchedCount <= 0) {
        success = false;
      }

      if (success === false) {
        res.status(500).json(
          createApiError(
            ErrorCodes.UPDATE_FAILED,
            `Failed to update conversion totals for ${address}`,
            'Please retry in a few minutes.'
          )
        );
        return;
      }

      const updated = await collection.findOne({ address });
      res.status(200).json({
        success: true,
        message: `Conversion ready for claim.`,
        user: updated 
      });
      return;
    }

    res.status(200).json({
      success: true,
      message: `Conversion ready for claim.`,
      user // user object includes 'history' array if present in DB
    });
  } catch (error) {
    handleApiError(res, ENDPOINT, error, {
      response: createApiError(
        ErrorCodes.INTERNAL_ERROR,
        'Unable to compute conversion state',
        'Please try again. If the problem persists, contact support.'
      ),
      walletAddress: address,
      issueType: 'FRY_CONVERSION_STATE_ERROR',
      part: 'conversion.get-fry.handler',
      metadata: {
        address,
      },
    });
  }
}
