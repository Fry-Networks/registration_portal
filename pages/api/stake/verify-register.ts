import { NextApiRequest, NextApiResponse } from 'next';
import axios from 'axios';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import algosdk from 'algosdk';
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
    txId: string;
    address: string;
    miner: string;
    amount: number;
    asset_id: string;
  } = req.body;
  const { miner, txId, address, asset_id, amount } = data;
  try {
    if (session.user.address !== address || !address) {
      console.log(
        `stake session.user.address: ${session.user.address}, address: ${address} SPOOF`
      );
      res.status(401).json({ message: 'Unauthorized 2' });
      return;
    }
    console.log('TxId: ' + txId);
    const client = await clientPromise;
    const db = client.db('main');
    const product = (await db
      .collection('products')
      .findOne({ key: miner.split('-')[0] })) as Product;
    if (!product) {
      res.status(404).json({ message: 'not found' });
      return;
    }
    /*let price = await getFRYPrice();
        if (!price) return 1;
        const USD = product.reward.stake ?? 0;
        //price = Math.floor((USD / price)) * (process.env.NODE_ENV === 'development' ? 1 : 1000000)
        const FRYamount = Math.floor((USD / price))
        */
    if (!product.reward.stake) {
      res.status(404).json({ message: 'product stake empty' });
      return;
    }
    const stake_amt = amount;

    const miner_data = await db
      .collection(testMode ? 'test-devices' : 'devices')
      .findOne({ miner_key: miner });
    if (!miner_data) {
      res.status(404).json({ message: 'miner not found' });
      return;
    }
    if (miner_data.verified) {
      res.status(400).json({ message: 'already verified' });
      return;
    }
    const FRYamount = stake_amt;
    if (FRYamount === 0) {
      res.status(404).json({ message: 'withdraw = 0' });
      return;
    }

    let checking = false;
    let checkingRetry = 0;
    while (!checking) {
      console.log(address);
      const lastTransactions = await indexer
        .lookupAccountTransactions(address)
        .limit(50)
        .do();

      if (lastTransactions !== undefined) {
        const targetTx = lastTransactions.transactions.find(
          (transaction: Transaction) => {
            return transaction.id === txId;
          }
        );

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
      res.status(400).json({ message: 'Failed in trasaction verification' });
      return;
    }

    const collection = db.collection(testMode ? 'test-devices' : 'devices');
    console.log(product);
    const result =
      (product.reward.tokens?.node && product.reward.tokens!.node === 'none') ||
      (product.reward.stake && product.reward.stake.node === 0)
        ? await collection.updateOne(
            { miner_key: miner },
            {
              $set: {
                address: address,
                is_registered: true,
                'registration.amount': FRYamount,
                'registration.txId': txId,
                'registration.asset_id': asset_id,
                'registration.time': new Date(Date.now())
              }
            }
          )
        : await collection.updateOne(
            { miner_key: miner },
            {
              $set: {
                'registration.amount': FRYamount,
                'registration.txId': txId,
                'registration.asset_id': asset_id,
                'registration.time': new Date(Date.now())
              }
            }
          );

    if (result.matchedCount > 0) {
      console.log('success');
    } else {
      console.log('failed');
    }

    res.status(200).json({ message: 'ok' });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: 'error' });
  }
}

const fryReceiver =
  'UKVAN7ORIUX7Y6QJFYQ4YGQAZD3RAC7QTDB73S2E5MSILUWAA7FJ6N7WLU';

async function confirmTransaction(
  txId: string,
  price: number
): Promise<{ code: number; amount?: number }> {
  console.log(txId);
  console.log(price);
  let amount;
  try {
    const lowerBound = price - price * 0.05; // lower bound is 95% of the price
    const upperBound = price + price * 0.05; // upper bound is 105% of the price

    // Get the confirmed transaction
    console.log('Getting transaction info for txId: ' + txId);
    await wait(2000);
    const confirmedTxn = await algodClient
      .pendingTransactionInformation(txId)
      .do();

    console.log('Got transaction info');
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
    console.error(error);
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
