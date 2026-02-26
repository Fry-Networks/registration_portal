import { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import type { indexerModels } from 'algosdk'; // Use Algorand indexer typings for safer transaction access
import { loggers } from '../../../lib/logger';
import clientPromise from '../../../lib/mongoclient';
import mongoose from 'mongoose';
import { VERIFY_RESULT } from '../../../lib/algorand/verification';
import {
  CommonErrors,
  createApiError,
  ErrorCodes,
  handleApiError,
} from '../../../lib/api-errors';
import { getIndexerClient } from '../../../lib/wallet/clients';
export const wait = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const testMode =
    process.env.NEXT_PUBLIC_TEST_MODE &&
    process.env.NEXT_PUBLIC_TEST_MODE === 'true';

  const session = await getServerSession(req, res, authOptions);
  // Check if user is authenticated
  if (!session || !session.user?.address) {
    res.status(401).json(CommonErrors.noSession());
    return;
  }

  const { address, txId } = (req.body ?? {}) as {
    address?: string;
    txId?: string;
  };

  if (!address || !txId) {
    res.status(400).json(
      createApiError(
        ErrorCodes.INVALID_INPUT,
        'Missing transaction verification parameters',
        'Provide the wallet address and transaction ID to verify.'
      )
    );
    return;
  }

  if (session.user.address !== address) {
    loggers.apiError('/api/algorand/verify-txn', new Error('Wallet mismatch during transaction verify'), {
      sessionAddress: session.user.address,
      address,
      txId,
      issueType: 'VERIFY_TXN_WALLET_MISMATCH',
      part: 'algorand.verify-txn.auth',
    });
    res.status(401).json(CommonErrors.walletMismatch());
    return;
  }

  try {
    const indexer = getIndexerClient();
    let checking = false;
    let checkingRetry = 0;
    while (!checking) {
      const lastTransactions = (await indexer
        .lookupAccountTransactions(address)
        .limit(50)
        .do()) as indexerModels.TransactionsResponse; // Cast the API response to the official indexer type to expose its shape

      if (lastTransactions !== undefined) {
        const transactions = lastTransactions.transactions ?? []; // Default to an empty list when the account has no transactions
        const targetTx = transactions.find((transaction) => transaction.id === txId); // Locate a transaction whose id matches the requested txId

        if (targetTx) {
          checking = true;
          break;
        }
      }

      checkingRetry++;
      if (checkingRetry >= 20) {
        break;
      }
      await wait(1000);
    }

    if (!checking) {
      res
        .status(200)
        .json({ success: false, message: 'Failed in trasaction verification' });
      return;
    }

    res.status(200).json({ success: true, message: 'ok' });
  } catch (error) {
    handleApiError(res, '/api/algorand/verify-txn', error, {
      response: createApiError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to verify transaction status',
        'Please try again. If the issue persists, contact support.'
      ),
      walletAddress: address,
      issueType: 'VERIFY_TXN_HANDLER_ERROR',
      part: 'algorand.verify-txn.handler',
      metadata: {
        address,
        txId,
      },
    });
  }
}

export async function verifyTransaction(address: string, txId: string) {
  const indexer = getIndexerClient();
  let checking = false;
  let checkingRetry = 0;

  try {
    while (!checking) {
      const lastTransactions = (await indexer
        .lookupAccountTransactions(address)
        .limit(50)
        .do()) as indexerModels.TransactionsResponse; // Reuse the typed response so both loops share the same safety guarantees

      if (lastTransactions !== undefined) {
        const transactions = lastTransactions.transactions ?? []; // Guard against undefined arrays before searching
        const targetTx = transactions.find((transaction) => transaction.id === txId); // Match by txId using the SDK-provided transaction shape

        if (targetTx) {
          checking = true;
          break;
        }
      }

      checkingRetry++;
      if (checkingRetry >= 20) {
        break;
      }
      await wait(1000);
    }

    if (checking) {
      return VERIFY_RESULT.OK;
    } else {
      return VERIFY_RESULT.FAILED;
    }
  } catch (error) {
    loggers.apiError('/api/algorand/verify-txn#lookup', error, {
      address,
      txId,
      issueType: 'VERIFY_TXN_LOOKUP_ERROR',
      part: 'algorand.verify-txn.lookup',
    });
    return VERIFY_RESULT.INTERNAL_ERROR;
  }
}

export interface Transaction {
  'close-rewards': number;
  'closing-amount': number;
  'asset-transfer-transaction': {
    amount: number;
    'asset-id': number;
  };
  'confirmed-round': number;
  fee: number;
  'first-valid': number;
  'genesis-hash': string;
  'genesis-id': string;
  id: string;
  'intra-round-offset': number;
  'last-valid': number;
  note: string;
  'payment-transaction': Object;
  'receiver-rewards': number;
  'round-time': number;
  sender: string;
  'sender-rewards': number;
  signature: Object;
  'tx-type': string;
}
