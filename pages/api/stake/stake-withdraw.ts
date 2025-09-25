'use server';
import { NextApiRequest, NextApiResponse } from 'next';
import axios from 'axios';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import algosdk, { Indexer, waitForConfirmation } from 'algosdk';
import 'dotenv/config';
import clientPromise from '../../../lib/mongoclient';
import { getFRYPrice } from '../../../lib/price';
import { Device, Product } from '../../../lib/types';
import { confirmTransaction, VERIFY_RESULT } from '../../../lib/txn';
import { verifyTransaction } from '../algorand/verify-txn';

// Algorand client setup
const token = '';
const server = 'https://xna-mainnet-api.algonode.cloud/';
const tokenToSend = { 'X-API-Key': token };
const port = 443;
const algodClient = new algosdk.Algodv2(tokenToSend, server, port);

const testMode =
  process.env.NEXT_PUBLIC_TEST_MODE &&
  process.env.NEXT_PUBLIC_TEST_MODE === 'true';

const devMode =
  process.env.NEXT_PUBLIC_DEV_MODE &&
  process.env.NEXT_PUBLIC_DEV_MODE === 'true';

const indexServer = 'https://mainnet-idx.algonode.cloud/';
const indexer = new Indexer(tokenToSend, indexServer, port);

const lockSet: Set<string> = new Set();
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const session = await getServerSession(req, res, authOptions);
  // Check if user is authenticated
  if (!session || !session.user) {
    res.status(401).json({ message: 'Unauthorized 1' });
    return;
  }

  const data: {
    address: string;
    miner_key: string;
  } = req.body;

  const { address, miner_key } = data;

  if (lockSet.has(miner_key)) {
    res.status(402).json({ message: 'Too Many Request!' });
    return;
  }
    
  lockSet.add(miner_key);

  if (session.user.address !== address || !address) {
    // console.log(
    //   `get miner type session.user.address: ${session.user.address}, address: ${address} SPOOF`
    // );
    lockSet.delete(miner_key);
    res.status(401).json({ message: 'Unauthorized 2' });
    return;
  }

  try {
    const client = await clientPromise;
    const db = client.db('main');
    const collection = db.collection(testMode ? 'test-devices' : 'devices');
    const device = (await collection.findOne({
      miner_key
    })) as unknown as Device;

    const deviceType = device.miner_key.split('-')[0];
    const product = (await db
      .collection('products')
      .findOne({ key: deviceType })) as Product;

    if (!device) {
      lockSet.delete(miner_key);
      res.status(404).json({ message: 'not found' });
      return;
    }
    if (!device.staked) {
      lockSet.delete(miner_key);
      res.status(401).json({ message: 'Unauthorized 3' });
      return;
    }

    if (!product) {
      lockSet.delete(miner_key);
      res.status(404).json({ message: 'Product not found' });
      return;
    }

    const type = device.staked.type;
    const check =
      devMode ||
      device.staked.asset_id !== product.reward.tokens?.stake ||
      (type == 'one'
        ? (Date.now() - new Date(device.staked.time).getTime()) /
            (1000 * 60 * 60 * 24) >
          1
        : (Date.now() - new Date(device.staked.time).getTime()) /
            (1000 * 60 * 60 * 24) >
          180);
    if (!check) {
      lockSet.delete(miner_key);
      res.status(401).json({ message: 'Unauthorized 4' });
      return;
    }
    const amount = device.staked.amount;
    const assetId = device.staked.asset_id; // Preserve the staking asset identifier for the withdrawal transaction
    if (!amount) {
      lockSet.delete(miner_key);
      res.status(401).json({ message: 'Unauthorized 5' });
      return;
    }

    let result: string | null = null;

    if (!assetId) {
      lockSet.delete(miner_key);
      res.status(500).json({ message: 'Missing staking asset' });
      return;
    }

    result = await withdraw(miner_key, address, amount, assetId); // Send back the same asset that was originally staked
    if (!result) {
      lockSet.delete(miner_key);
      res.status(500).json({ message: 'error' });
      return;
    }

    await collection.updateOne(
      { miner_key },
      {
        $set: {
          staked: {
            amount: 0,
            txId: result,
            time: new Date(),
            rewarded_time: new Date()
          },
          verified: false
        }
      }
    );

    lockSet.delete(miner_key);
    res.status(200).json({ message: 'ok', txId: result });
  } catch (error) {
    lockSet.delete(miner_key);
    console.error(miner_key + ':' + error);
    res.status(500).json({ message: 'error' });
  }
}

export async function withdraw(
  miner_key: string,
  address: string,
  amount: number,
  asset_id: string
) {
  try {
    // Convert mnemonic to secret key
    const account = algosdk.mnemonicToSecretKey(process.env.STAKE_MNEMONIC!);
    const rekey = algosdk.mnemonicToSecretKey(process.env.STAKE_REKEY!);

    const from = account.addr.toString();

    const assetIndex: number = asset_id === 'none' ? 0 : Number(asset_id); // Respect the stored asset id instead of falling back to FRY 1.0

    // Fetch transaction parameters from the Algorand network
    const suggestedParams = await algodClient.getTransactionParams().do();

    const noteInformation = {
      miner_key:
        miner_key.split('-')[0] + '-' + miner_key.split('-')[1].slice(0, 6),
      asset_id: asset_id,
      from: account.addr.toString(),
      to: address,
      amount: amount
    };

    const enc = new TextEncoder();
    const note = enc.encode(JSON.stringify(noteInformation));

    // Create a transaction to send FRY
    const txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      sender: from,
      receiver: address,
      amount: testMode ? 0 : amount * 1_000_000,
      assetIndex,
      note,
      suggestedParams
    });

    // Sign the transaction with the account secret key
    const signedTxn = txn.signTxn(rekey.sk);

    // Send the signed transaction to the network
    const tx = await algodClient.sendRawTransaction(signedTxn).do();

    // const result = await waitForConfirmation(algodClient, tx.txid, 3);

    const checking = await verifyTransaction(address, tx.txid);
    return checking === VERIFY_RESULT.OK ? tx.txid : '';
  } catch (error) {
    console.error(miner_key + ':' + error);
    return null;
  }
}
