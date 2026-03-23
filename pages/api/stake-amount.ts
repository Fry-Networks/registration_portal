import { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from './auth/[...nextauth]';
import clientPromise from '../../lib/mongoclient';
import { loggers } from '../../lib/logger';
import { getFRYPrice } from '../../lib/price';
import { FRY_2 } from '../../lib/utils';
import {
  CommonErrors,
  createApiError,
  ErrorCodes,
  handleApiError,
} from '../../lib/api-errors';

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

  const { address, key } = (req.body ?? {}) as {
    address?: string;
    key?: string;
  };

  if (!address || session.user.address !== address) {
    loggers.apiError('/api/stake-amount', new Error('Wallet mismatch during stake amount lookup'), {
      sessionAddress: session.user.address,
      address,
      key,
      issueType: 'STAKE_AMOUNT_WALLET_MISMATCH',
      part: 'stake-amount.auth',
    });
    res.status(401).json(CommonErrors.walletMismatch());
    return;
  }

  if (!key) {
    res.status(400).json(
      createApiError(
        ErrorCodes.INVALID_INPUT,
        'Product key is required',
        'Submit the product key to fetch staking amounts.'
      )
    );
    return;
  }
  try {
    const client = await clientPromise;
    const db = client.db('main');
    const collection = db.collection('products');
    const product = await collection.findOne({ key: key });
    if (!product) {
      res.status(404).json(CommonErrors.productNotFound());
      return;
    }

    // FIP-012: USD-Pegged Verification Stakes
    // If USD amounts are configured, convert to FRY using price oracle
    const stakeOneUsd = product.reward?.stake?.stake_one_usd;
    const stakeTwoUsd = product.reward?.stake?.stake_two_usd;

    let stakeData: { stake_one: number; stake_two: number; stake_one_usd?: number; stake_two_usd?: number };

    if (typeof stakeOneUsd === 'number' && stakeOneUsd > 0 && 
        typeof stakeTwoUsd === 'number' && stakeTwoUsd > 0) {
      // USD amounts are configured - convert to FRY
      const stakeAssetId = product.reward?.tokens?.stake ?? FRY_2.id;
      const fryPrice = await getFRYPrice(stakeAssetId);

      // Critical: Never use 0 or undefined price - return error to user
      if (!fryPrice || fryPrice <= 0 || !Number.isFinite(fryPrice)) {
        loggers.apiError('/api/stake-amount', new Error('Price oracle unavailable for USD conversion'), {
          key,
          stakeAssetId,
          fryPrice,
          issueType: 'STAKE_AMOUNT_PRICE_UNAVAILABLE',
          part: 'stake-amount.usd-conversion',
        });
        res.status(503).json(
          createApiError(
            'SERVICE_UNAVAILABLE',
            'Price unavailable',
            'Unable to fetch current token price. Please try again in a few moments.'
          )
        );
        return;
      }

      // Convert USD to FRY tokens (floor to avoid fractional tokens)
      const stakeOneFry = Math.floor(stakeOneUsd / fryPrice);
      const stakeTwoFry = Math.floor(stakeTwoUsd / fryPrice);

      stakeData = {
        stake_one: stakeOneFry,
        stake_two: stakeTwoFry,
        stake_one_usd: stakeOneUsd,
        stake_two_usd: stakeTwoUsd
      };

      console.log(`[STAKE-AMOUNT] ${key} - USD peg active: $${stakeOneUsd}/${stakeTwoUsd} USD -> ${stakeOneFry}/${stakeTwoFry} FRY @ $${fryPrice}`);
    } else {
      // Fall back to legacy token amounts
      stakeData = {
        stake_one: product.reward?.stake?.stake_one ?? 0,
        stake_two: product.reward?.stake?.stake_two ?? 0
      };

      console.log(`[STAKE-AMOUNT] ${key} - Legacy FRY amounts: ${stakeData.stake_one}/${stakeData.stake_two} FRY`);
    }

    const data = {
      stake: stakeData
    };

    res.status(200).json({ message: 'ok', data });
  } catch (error) {
    handleApiError(res, '/api/stake-amount', error, {
      response: createApiError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to retrieve product stake data',
        'Please try again. If the problem persists, contact support.'
      ),
      issueType: 'STAKE_AMOUNT_ERROR',
      part: 'stake-amount.handler',
      metadata: {
        key,
        address,
      },
    });
  }
}
