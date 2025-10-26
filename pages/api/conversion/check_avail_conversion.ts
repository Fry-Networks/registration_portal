import { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';

import { authOptions } from '../auth/[...nextauth]';
import clientPromise from '../../../lib/mongoclient';
import { FRY_1, FC_CHECKED, FC_UNCHECKED, FC_STARTED } from '../../../lib/utils';
import { loggers } from '../../../lib/logger';
import {
  CommonErrors,
  createApiError,
  ErrorCodes,
  handleApiError,
} from '../../../lib/api-errors';

const ENDPOINT = '/api/conversion/check_avail_conversion';

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

  const { address, isLoading } = (req.body ?? {}) as {
    address?: string;
    isLoading?: boolean;
  };

  if (session.user.address !== address || !address) {
    loggers.apiError(ENDPOINT, new Error('Wallet mismatch on conversion availability check'), {
      sessionAddress: session.user.address,
      address,
      issueType: 'CONVERSION_CHECK_WALLET_MISMATCH',
      part: 'conversion.check-avail.auth',
    });
    res.status(401).json(CommonErrors.walletMismatch());
    return;
  }
  try {
    const client = await clientPromise;
    const db = client.db('main');
    const collection = db.collection('fry-conversions');
    const user = await collection.findOne({ address });
    if (user) {
      if (isLoading) {
        if (user.status === 'valid') {
          res.status(200).json({ success: true, message: 'Already Checked The Availability For FRY1.0 Conversion.', data: user, isChecked: FC_CHECKED });
          return;
        } else if ( user.status === 'pending') {
          res.status(200).json({ success: true, message: 'Already Started The FRY1.0 Conversion.', data: user, isChecked: FC_STARTED });
          return;
        } else {
          res.status(200).json({ message: 'Still Not Check Availability For Conversion.', isChecked: FC_UNCHECKED });
          return;
        }
      }

      if (user['amount'] === 0) {
        res.status(400).json(
          createApiError(
            ErrorCodes.INVALID_INPUT,
            'The balance for conversion is zero.'
          )
        );
        return;
      
      } else {
        const updateResult = await collection.updateOne(
          { address },
          {
            $set: {
              status : 'valid',
              asset_id : FRY_1.id,
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
              `Failed to update conversion availability for ${address}`,
              'Please retry in a few minutes.'
            )
          );
          return;
        }
      }
      res.status(200).json({ success: true, message: 'Successfully Checked Availability For FRY1.0 Conversion!', data: user});
      return;
    }

    res.status(404).json(
      createApiError(
        ErrorCodes.DEVICE_NOT_FOUND,
        'Invalid account for FRY1.0 conversion',
        'Please confirm the wallet address and try again.'
      )
    );
    return;
  } catch (error) {
    handleApiError(res, ENDPOINT, error, {
      response: createApiError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to evaluate conversion availability',
        'Please try again. If the problem persists, contact support.'
      ),
      walletAddress: address,
      issueType: 'FRY_CONVERSION_CHECK_ERROR',
      part: 'conversion.check-avail.handler',
      metadata: {
        address,
        isLoading,
      },
    });
  }
}
