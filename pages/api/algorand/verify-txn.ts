import { NextApiRequest, NextApiResponse } from 'next';
import axios from 'axios';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import algosdk from 'algosdk';
import type { indexerModels } from 'algosdk'; // Use Algorand indexer typings for safer transaction access
import clientPromise from '../../../lib/mongoclient';
import { getFRYPrice } from '../../../lib/price';
import mongoose from 'mongoose';
import {
  Algodv2,
  Indexer,
  makeAssetTransferTxnWithSuggestedParamsFromObject,
  mnemonicToSecretKey,
  Account
} from 'algosdk';
import { check } from 'prettier';
import { VERIFY_RESULT } from '../../../lib/txn';

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
    res.status(401).json({ message: 'Unauthorized 1' });
    return;
  }

  const data: {
    address: string;
    txId: string;
  } = req.body;
  const { address, txId } = data;
  try {
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
    console.log(error);
    res.status(500).json({ message: 'error' });
  }
}

export async function verifyTransaction(address: string, txId: string) {
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
    console.error(address + ':' + error);
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
