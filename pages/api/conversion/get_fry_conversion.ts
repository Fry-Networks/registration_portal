import { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';

import { authOptions } from '../auth/[...nextauth]';
import clientPromise from '../../../lib/mongoclient';
import { FRY_2, ALL_RELEASE_DATE, CORE_RELEASE_DATE, MODS_RELEASE_DATE } from '../../../lib/utils';
import { loggers } from '../../../lib/logger';
import {
  CommonErrors,
  createApiError,
  ErrorCodes,
  handleApiError,
} from '../../../lib/api-errors';

const ENDPOINT = '/api/conversion/get_fry_conversion';

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

  const { address, convertType } = (req.body ?? {}) as {
    address?: string;
    convertType?: string;
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

    const currentDateObj = new Date();
    // Use RELEASE_DATE for vesting schedule
    const vestingStart = user?.ratio ? (user.ratio[2] === 1 ? CORE_RELEASE_DATE : MODS_RELEASE_DATE) : ALL_RELEASE_DATE;
    const differenceInTime = currentDateObj.getTime() - vestingStart.getTime();
    const differenceInDays = Math.floor(
      differenceInTime / (1000 * 60 * 60 * 24)
    );

    // Only allow up to 12 months
    const monthsVested = Math.min(Math.floor(differenceInDays / 30), 11);
    if (monthsVested + 1 > user.claimedMonths) {
      const times = (monthsVested + 1) - user.claimedMonths;
      const src = (user.amount / 12) * times;
      const convertedAmount =
        convertType === FRY_2.id
          ? src / (user?.ratio ? user.ratio[0] : 80)
          : src / (user?.ratio ? user.ratio[1] : 40);

      const updateResult = await collection.updateOne(
        { address },
        {
          $set: {
            claimableMonths: times,
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
      
      // Include post-snapshot data in response
      const post_snapshot = {
        eligible_fry1: updated?.post_snapshot_amount || 0,
        eligible_tFRY: (updated?.post_snapshot_amount || 0) / 40,
        burned: !!updated?.post_burn_txId,
        claimed: updated?.post_claimed || false,
        claim_txId: updated?.post_claim_txId || null,
        claimed_at: updated?.post_claimed_at || null
      };

      res.status(200).json({
        success: true,
        message: `Started claiming for conversion successfully.`,
        user: updated,
        post_snapshot
      });
      return;
    }

    // Include post-snapshot data in response
    const post_snapshot = {
      eligible_fry1: user.post_snapshot_amount || 0,
      eligible_tFRY: (user.post_snapshot_amount || 0) / 40,
      burned: !!user.post_burn_txId,
      claimed: user.post_claimed || false,
      claim_txId: user.post_claim_txId || null,
      claimed_at: user.post_claimed_at || null
    };

    res.status(200).json({
      success: true,
      message: `Started claiming for conversion successfully.`,
      user, // user object includes 'history' array if present in DB
      post_snapshot
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
        convertType,
      },
    });
  }
}
