import { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import algosdk from 'algosdk';
import type { indexerModels } from 'algosdk'; // Reuse Algorand indexer typings to satisfy strict TypeScript checks
import clientPromise from '../../../lib/mongoclient';
import mongoose from 'mongoose';
import { loggers } from '../../../lib/logger';
// ADDED: Import standardized error helpers for consistent API error responses
import { CommonErrors, createApiError, ErrorCodes, handleApiError } from '../../../lib/api-errors';
import {
  Algodv2,
  Indexer,
} from 'algosdk';

const token = '';
const port = 443;
const tokenToSend = {
  'X-API-Key': token
};
const algodClient = new algosdk.Algodv2(
  '',
  'https://mainnet-api.algonode.cloud',
  ''
);
const indexServer = 'https://mainnet-idx.algonode.cloud/';
const indexer = new Indexer(tokenToSend, indexServer, port);
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
  if (!session || !session.user) {
    res.status(401).json(CommonErrors.noSession());
    return;
  }

  const data: {
    txId: string;
    address: string;
    miner: string;
    amount: number;
    asset_id: string;
  } = req.body;
  const { miner, txId, address, asset_id, amount } = data;
  try {
    if (session.user.address !== address || !address) {
      res.status(401).json(CommonErrors.walletMismatch());
      return;
    }
    const client = await clientPromise;
    const db = client.db('main');
    const product = (await db
      .collection('products')
      .findOne({ key: miner.split('-')[0] })) as Product;
    if (!product) {
      res.status(404).json(CommonErrors.productNotFound());
      return;
    }
    /*let price = await getFRYPrice();
        if (!price) return 1;
        const USD = product.reward.stake ?? 0;
        //price = Math.floor((USD / price)) * (process.env.NODE_ENV === 'development' ? 1 : 1000000)
        const FRYamount = Math.floor((USD / price))
        */
    if (!product.reward.stake) {
      res.status(400).json(
        createApiError(
          ErrorCodes.INVALID_INPUT,
          'This product does not define a verification stake',
          'Please contact support to confirm the staking requirements.'
        )
      );
      return;
    }
    const stake_amt = amount;

    const miner_data = await db
      .collection(testMode ? 'test-devices' : 'devices')
      .findOne({ miner_key: miner });
    if (!miner_data) {
      res.status(404).json(CommonErrors.deviceNotFound());
      return;
    }
    if (miner_data.verified) {
      res.status(400).json(
        createApiError(
          ErrorCodes.ALREADY_STAKED,
          'This device is already verified',
          'If you believe this is incorrect, please contact support.'
        )
      );
      return;
    }
    const FRYamount = stake_amt;
    if (FRYamount === 0) {
      res.status(400).json(
        createApiError(
          ErrorCodes.ZERO_STAKE_AMOUNT,
          'Stake amount cannot be zero',
          'Please submit the verification transaction again with the correct amount.'
        )
      );
      return;
    }

    let checking = false;
    let checkingRetry = 0;
    while (!checking) {
      const lastTransactions = (await indexer
        .lookupAccountTransactions(address)
        .limit(50)
        .do()) as indexerModels.TransactionsResponse; // Cast the raw indexer response so we can access the typed transactions list safely

      if (lastTransactions !== undefined) {
        const transactions = lastTransactions.transactions ?? []; // Guard against missing transaction arrays when the account is empty
        const targetTx = transactions.find((transaction) => transaction.id === txId); // Search for the target transaction using the SDK-provided model

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
      loggers.apiError('/api/stake/verify-node', new Error('Transaction verification timed out'), {
        miner_key: miner,
        address,
        txId,
        asset_id,
        amount: FRYamount,
        issueType: 'NODE_VERIFICATION_TX_TIMEOUT',
        part: 'verify-node.transactionCheck',
      });
      res.status(400).json(
        createApiError(
          ErrorCodes.INVALID_TRANSACTION,
          'We could not verify the staking transaction on-chain',
          'Please confirm the transaction ID and try again.'
        )
      );
      return;
    }

    const collection = db.collection(testMode ? 'test-devices' : 'devices');
    const result = await collection.updateOne(
      { miner_key: miner },
      {
        $set: {
          address: address,
          is_registered: true,
          'node.amount': FRYamount,
          'node.txId': txId,
          'node.asset_id': asset_id,
          'node.time': new Date(Date.now())
        }
      }
    );

    if (result.matchedCount > 0) {
      loggers.stakeOperation('node_verification_completed', miner, {
        txId,
        amount: FRYamount,
        asset_id,
        matchedCount: result.matchedCount,
      });
    } else {
      loggers.apiError('/api/stake/verify-node', new Error('Node verification update failed'), {
        miner_key: miner,
        address,
        txId,
        asset_id,
        amount: FRYamount,
        issueType: 'NODE_VERIFICATION_UPDATE_FAILED',
        part: 'verify-node.dbUpdate',
        matchedCount: result.matchedCount,
      });
      res.status(400).json(
        createApiError(
          ErrorCodes.UPDATE_FAILED,
          'Failed to update node verification status',
          'Please try again. If the problem persists, contact support.',
          { miner_key: miner }
        )
      );
      return;
    }

    res.status(200).json({ success: true, message: 'ok' });
  } catch (error) {
    handleApiError(res, '/api/stake/verify-node', error, {
      response: createApiError(
        ErrorCodes.INTERNAL_ERROR,
        'An error occurred while processing node verification',
        'Please try again. If the problem persists, contact support.',
        { errorId: `${miner}-${Date.now()}` }
      ),
      minerKey: miner,
      walletAddress: address,
      issueType: 'NODE_VERIFICATION_ERROR',
      part: 'verify-node.handler',
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

const fryReceiver =
  'UKVAN7ORIUX7Y6QJFYQ4YGQAZD3RAC7QTDB73S2E5MSILUWAA7FJ6N7WLU';

async function confirmTransaction(
  txId: string,
  price: number
): Promise<{ code: number; amount?: number }> {
  let amount;
  try {
    const lowerBound = price - price * 0.05; // lower bound is 95% of the price
    const upperBound = price + price * 0.05; // upper bound is 105% of the price

    // Get the confirmed transaction
    await wait(2000);
    const confirmedTxn = await algodClient
      .pendingTransactionInformation(txId)
      .do();

    // Check if the receiver is correct
    const actualReceiverField = 'arcv';
    const actualReceiver = algosdk.encodeAddress(
      confirmedTxn['txn']['txn'][actualReceiverField]
    );
    const receiver = fryReceiver;
    if (actualReceiver !== receiver) return { code: 2 };

    // Check if the amount is correct (assuming price is in MicroAlgos)
    const amountField = 'aamt';
    amount = confirmedTxn['txn']['txn'][amountField] || 0; // Default to 0 if amt field is missing
    if (amount < lowerBound || amount > upperBound) return { code: 3 };
  } catch (error) {
    loggers.apiError('/api/stake/verify-node#confirm', error, {
      txId,
      issueType: 'NODE_VERIFICATION_CONFIRMATION_FAILED',
      part: 'verify-node.confirmTransaction',
    });
    return { code: 4 };
  }
  return { code: 0, amount };
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

export interface Product extends mongoose.Document {
  wix_id: string;
  name: string;
  key: string;
  reward: {
    unverified: number;
    verified: number;
    stake?: {
      stake_one: number;
      stake_two: number;
      register: number;
      node: number;
    };
    tokens?: {
      stake: string;
      reward: string;
      register: string;
      node: string;
    };
  };
  created_at: Date;
}
