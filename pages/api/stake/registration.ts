import { NextApiRequest, NextApiResponse } from 'next';
import axios from 'axios';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import algosdk from 'algosdk';
import clientPromise from '../../../lib/mongoclient';
import { getFRYPrice } from '../../../lib/price';
import mongoose from 'mongoose';
import { loggers } from '../../../lib/logger';
// ADDED: Import standardized error helpers for consistent API error responses
import { CommonErrors, createApiError, ErrorCodes, handleApiError } from '../../../lib/api-errors';

import { Product } from '../../../lib/types';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const testMode =
    process.env.NEXT_PUBLIC_TEST_MODE &&
    process.env.NEXT_PUBLIC_TEST_MODE === 'true';

  const session = await getServerSession(req, res, authOptions);
  // VALIDATION: Check if user is authenticated via NextAuth session
  // Error occurs when: User is not logged in or session has expired
  if (!session || !session.user) {
    res.status(401).json(CommonErrors.noSession());
    return;
  }

  const data: {
    txId: string;
    address: string;
    miner_key: string;
    amount: number;
    asset_id: string;
  } = req.body;
  const { miner_key: miner, txId, address, asset_id, amount } = data;
  try {
    // SECURITY: Verify the request address matches the authenticated user's wallet
    // Error occurs when: Request body address doesn't match session wallet (prevents spoofing)
    if (session.user.address !== address || !address) {
      res.status(401).json(CommonErrors.walletMismatch());
      return;
    }
    const client = await clientPromise;
    const db = client.db('main');
    
    // VALIDATION: Check if product configuration exists for this device type
    // Error occurs when: Device key prefix doesn't match any product in products collection
    const product = (await db
      .collection('products')
      .findOne({ key: miner.split('-')[0] })) as Product;
    if (!product) {
      res.status(404).json(CommonErrors.productNotFound());
      return;
    }

    // VALIDATION: Check if device is registered in the system
    // Error occurs when: Device with this miner_key doesn't exist in devices collection
    const miner_data = await db
      .collection(testMode ? 'test-devices' : 'devices')
      .findOne({ miner_key: miner });
    if (!miner_data) {
      res.status(404).json(CommonErrors.deviceNotFound());
      return;
    }
    const collection = db.collection(testMode ? 'test-devices' : 'devices');
    const result = await collection.updateOne(
      { miner_key: miner },
      {
        $set: {
          'registration.amount': amount,
          'registration.txId': txId,
          'registration.asset_id': asset_id,
          'registration.time': new Date(Date.now())
        }
      }
    );

    // DATABASE UPDATE: Record the registration stake details on the device
    if (result.matchedCount > 0) {
      loggers.stakeOperation('registration_updated', miner, {
        amount,
        txId,
        asset_id,
        matchedCount: result.matchedCount,
      });
    } else {
      // ERROR: Database update didn't match any documents (should never happen since we checked above)
      loggers.apiError('/api/stake/registration', new Error('Registration update failed'), {
        miner_key: miner,
        matchedCount: result.matchedCount,
        address,
        txId,
        asset_id,
        amount,
        issueType: 'REGISTRATION_STAKE_UPDATE_FAILED',
        part: 'registration.dbUpdate',
      });
      res.status(400).json(
        createApiError(
          ErrorCodes.UPDATE_FAILED,
          'Failed to update registration stake',
          'Please try again. If the problem persists, contact support.',
          { miner_key: miner }
        )
      );
      return;
    }

    res.status(200).json({ success: true, message: 'ok' });
  } catch (error) {
    // CATCH-ALL ERROR: Log the full error details and return user-friendly message
    // Occurs when: Any unexpected error happens during the stake registration process
    handleApiError(res, '/api/stake/registration', error, {
      response: createApiError(
        ErrorCodes.INTERNAL_ERROR,
        'An error occurred while processing registration stake',
        'Please try again. If the problem persists, contact support.',
        { errorId: `${miner}-${Date.now()}` }
      ),
      minerKey: miner,
      walletAddress: address,
      issueType: 'REGISTRATION_STAKE_ERROR',
      part: 'registration.handler',
      metadata: {
        miner_key: miner,
        address,
        txId,
        asset_id,
        amount,
      },
    });
  }
}
