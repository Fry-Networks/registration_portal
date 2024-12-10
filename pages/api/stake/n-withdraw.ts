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

const fryCryptoAssetId = '924268058';
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const session = await getServerSession(req, res, authOptions);
  // Check if user is authenticated
  if (!session || !session.user) {
    console.log(`no session`);
    res.status(401).json({ message: 'Unauthorized 1' });
    return;
  }

  const data: {
    address: string;
    miner_key: string;
  } = req.body;

  const { address, miner_key } = data;
  console.log(address, miner_key, session.user.address);
  if (session.user.address !== address || !address) {
    console.log(
      `get miner type session.user.address: ${session.user.address}, address: ${address} SPOOF`
    );
    res.status(401).json({ message: 'Unauthorized 2' });
    return;
  }

  try {
    const client = await clientPromise;
    const db = client.db('main');
    const collection = db.collection(testMode ? 'test-devices' : 'devices');
    console.log(req.body);
    const device = (await collection.findOne({
      miner_key
    })) as unknown as Device;

    const deviceType = device.miner_key.split('-')[0];
    const product = (await db
      .collection('products')
      .findOne({ key: deviceType })) as Product;

    if (!device) {
      res.status(404).json({ message: 'not found' });
      return;
    }
    if (!device.node) {
      res.status(401).json({ message: 'Unauthorized 3' });
      return;
    }

    if (!product) {
      res.status(404).json({ message: 'Product not found' });
      return;
    }
    const amount = device.node.amount;
    if (!amount) {
      res.status(401).json({ message: 'Unauthorized 5' });
      return;
    }

    let result = 'success';

    const asset_id = device.node?.asset_id ?? fryCryptoAssetId;
    result = await withdraw(miner_key, address, amount, asset_id);
    if (!result) {
      res.status(500).json({ message: 'error' });
      return;
    }

    console.log(result);

    await collection.updateOne(
      { miner_key },
      {
        $set: {
          node: {
            amount: 0,
            txId: result,
            time: new Date(),
            asset_id: asset_id
          }
        }
      }
    );

    res.status(200).json({ message: 'ok', txId: result });
  } catch (error) {
    console.log(error);
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

    const from = account.addr.toString();

    const assetIndex: number = asset_id === 'none' ? 0 : Number(asset_id);

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

    console.log(noteInformation);

    const enc = new TextEncoder();
    const note = enc.encode(JSON.stringify(noteInformation));

    // Create a transaction to send FRY
    const txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      from,
      to: address,
      amount: testMode ? 0 : amount * 1_000_000,
      assetIndex,
      note,
      suggestedParams
    });

    console.log(txn);

    // Sign the transaction with the account secret key
    const signedTxn = txn.signTxn(account.sk);

    // Send the signed transaction to the network
    const tx = await algodClient.sendRawTransaction(signedTxn).do();

    console.log(tx);
    // const result = await waitForConfirmation(algodClient, tx.txid, 3);

    const checking = await verifyTransaction(address, tx.txId);
    return checking === VERIFY_RESULT.OK ? tx.txId : '';
  } catch (error) {
    console.error(error);
    return null;
  }
}
