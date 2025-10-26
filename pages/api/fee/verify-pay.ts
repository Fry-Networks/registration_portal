import { NextApiRequest, NextApiResponse } from 'next';
import clientPromise from '../../../lib/mongoclient';
import algosdk, { waitForConfirmation } from 'algosdk';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import { verifyTransaction } from '../algorand/verify-txn';
import { VERIFY_RESULT } from '../../../lib/txn';
import {
  CommonErrors,
  createApiError,
  ErrorCodes,
  handleApiError,
} from '../../../lib/api-errors';
import { loggers } from '../../../lib/logger';

const token = '';
const server = 'https://xna-mainnet-api.algonode.cloud/';
const tokenToSend = { 'X-API-Key': token };
const port = 443;
const algodClient = new algosdk.Algodv2(tokenToSend, server, port);

const testMode =
  process.env.NEXT_PUBLIC_TEST_MODE &&
  process.env.NEXT_PUBLIC_TEST_MODE === 'true';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json(
      createApiError(
        ErrorCodes.INVALID_INPUT,
        'That request is not available.',
        'Please retry this action from the dashboard.'
      )
    );
  }

  const session = await getServerSession(req, res, authOptions);
  // Check if user is authenticated
  if (!session || !session.user?.address) {
    return res.status(401).json(CommonErrors.noSession());
  }
  const client = await clientPromise;
  const db = client.db('main');

  const {
    miner_key,
    txId,
    address,
  } = (req.body ?? {}) as {
    miner_key?: string;
    txId?: string;
    address?: string;
  };

  if (!miner_key || !txId || !address) {
    return res.status(400).json(
      createApiError(
        ErrorCodes.INVALID_INPUT,
        'Missing verification parameters',
        'Please include miner key, wallet address, and transaction id.'
      )
    );
  }

  if (address && address !== session.user.address) {
    loggers.apiError('/api/fee/verify-pay', new Error('Wallet mismatch during fee verify'), {
      sessionAddress: session.user.address,
      address,
      miner_key,
      issueType: 'FEE_VERIFY_WALLET_MISMATCH',
      part: 'fee.verify-pay.auth',
    });
    return res.status(401).json(CommonErrors.walletMismatch());
  }

  try {
    const checking = await verifyTransaction(address, txId);

    if (checking === VERIFY_RESULT.OK) {
      const collection = db.collection(testMode ? 'test-devices' : 'devices');
      await collection.updateOne(
        { miner_key: miner_key, address: session.user.address },
        {
          $set: {
            'staked.withdraw_boost': true
          }
        }
      );
      return res.status(200).json({ message: 'ok' });
    } else {
      return res.status(500).json(
        createApiError(
          ErrorCodes.TRANSACTION_FAILED,
          'Failed to verify withdrawal transaction',
          'Please wait a moment and try again.'
        )
      );
    }
  } catch (error) {
    handleApiError(res, '/api/fee/verify-pay', error, {
      response: createApiError(
        ErrorCodes.INTERNAL_ERROR,
        'Unable to verify withdrawal transaction',
        'Please try again. If the problem persists, contact support.'
      ),
      minerKey: miner_key,
      walletAddress: address,
      issueType: 'FEE_VERIFY_ERROR',
      part: 'fee.verify-pay.handler',
      metadata: {
        miner_key,
        address,
        txId,
      },
    });
  }
}
