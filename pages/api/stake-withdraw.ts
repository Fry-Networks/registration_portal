'use server';
import { NextApiRequest, NextApiResponse } from 'next';
import axios from 'axios';
import { getServerSession } from 'next-auth';
import { authOptions } from './auth/[...nextauth]';
import algosdk, { waitForConfirmation } from 'algosdk';
import 'dotenv/config';
import clientPromise from '../../lib/mongoclient';
import { getFRYPrice } from '../../lib/price';
import { Device } from '../../lib/types';
import txnValidate, {
  hasOptedInForAsset,
  optInForAsset
} from '../../lib/txnValidate';

// Algorand client setup
const token = '';
const server = process.env.NEXT_PUBLIC_ALGOD_SERVER || '';
const tokenToSend = { 'X-API-Key': token };
const port = '';
const algodClient = new algosdk.Algodv2(tokenToSend, server, port);

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
    console.log(`no session`);
    res.status(401).json({ message: 'Unauthorized 1' });
    return;
  }

  const data: {
    address: string;
    miner_key: string;
  } = req.body;

  const { address, miner_key } = data;
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
    if (!device) {
      res.status(404).json({ message: 'not found' });
      return;
    }
    if (!device.staked) {
      res.status(401).json({ message: 'Unauthorized 3' });
      return;
    }
    const type = device.staked.type;
    const check =
      type == 'one'
        ? (Date.now() - new Date(device.staked.time).getTime()) /
            (1000 * 60 * 60 * 24) >
          1
        : (Date.now() - new Date(device.staked.time).getTime()) /
            (1000 * 60 * 60 * 24) >
          180;
    if (!check) {
      res.status(401).json({ message: 'Unauthorized 4' });
      return;
    }
    const amount = device.staked.amount;
    if (!amount) {
      res.status(401).json({ message: 'Unauthorized 5' });
      return;
    }

    let result = 'success';

    if (!testMode) {
      result = await withdraw(address, amount);
      if (!result) {
        res.status(500).json({ message: 'error' });
        return;
      }

      console.log(result);
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

    res.status(200).json({ message: 'ok' });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: 'error' });
  }
}

async function withdraw(address: string, amount: number) {
  try {
    // Convert mnemonic to secret key
    const account = algosdk.mnemonicToSecretKey(process.env.STAKE_MNEMONIC!);

    const from = account.addr.toString();

    const assetIndex: number = Number(process.env.NEXT_PUBLIC_ASSET_INDEX) || 0;

    // Fetch transaction parameters from the Algorand network
    const suggestedParams = await algodClient.getTransactionParams().do();

    const note = new Uint8Array(
      Buffer.from('Verification stake' + Math.floor(Math.random() * 1000))
    );

    if (
      (await hasOptedInForAsset(account.addr.toString(), assetIndex)) === false
    ) {
      await optInForAsset(account, account.addr.toString(), assetIndex);
    }

    // Create a transaction to send FRY
    const txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      from,
      to: address,
      amount: amount * 1_000_000,
      assetIndex,
      note,
      suggestedParams
    });

    // Sign the transaction with the account secret key
    const signedTxn = txn.signTxn(account.sk);

    // Send the signed transaction to the network
    const tx = await algodClient.sendRawTransaction(signedTxn).do();
    const result = await waitForConfirmation(algodClient, tx.txid, 3);

    console.log('Transaction ID: ' + tx);
    if ((await txnValidate(from, note)) === false) {
      return null;
    }

    return tx.txid;
  } catch (error) {
    console.error(
      'An error occurred, please check your network/mnemonic/asset index'
    );
    console.error(error);
    return null;
  }
}
