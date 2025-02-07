import { NextApiRequest, NextApiResponse } from 'next';
import algosdk, { waitForConfirmation } from 'algosdk';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import clientPromise from '../../../lib/mongoclient';
import { verifyTransaction } from '../algorand/verify-txn';
import { VERIFY_RESULT } from '../../../lib/txn';

// Algorand client setup
const token = '';
const server = 'https://xna-mainnet-api.algonode.cloud/';
const tokenToSend = { 'X-API-Key': token };
const port = 443;
const algodClient = new algosdk.Algodv2(tokenToSend, server, port);

const testMode =
  process.env.NEXT_PUBLIC_TEST_MODE &&
  process.env.NEXT_PUBLIC_TEST_MODE === 'true';

const lockSet: Set<string> = new Set();

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const session = await getServerSession(req, res, authOptions);
  // Check if user is authenticated
  if (!session || !session.user) {
    res.status(401).json({ message: 'Unauthorized' });
    return;
  }

  const data: {
    miner_key: string;
    asset_id: string;
    from: string;
    to: string;
    amount: number;
  } = req.body;
  const { miner_key, asset_id, from, to, amount } = data;

  if (lockSet.has(miner_key)) {
    res.status(402).json({ message: 'Too Many Request!' });
    return;
  }
  lockSet.add(miner_key);

  try {
    // Convert mnemonic to secret key
    const account = algosdk.mnemonicToSecretKey(
      process.env.NEXT_PUBLIC_ALGORAND_DEV_MNEMONIC!
    );

    const from = account.addr.toString();
    const assetIndex: number = asset_id === 'none' ? 0 : Number(asset_id);

    // Fetch transaction parameters from the Algorand network
    const suggestedParams = await algodClient.getTransactionParams().do();

    const noteInfo = {
      miner_key:
        miner_key.split('-')[0] + '-' + miner_key.split('-')[1].slice(0, 6),
      asset_id: asset_id,
      from: from,
      to: to,
      amount: amount,
      date: new Date(Date.now())
    };

    const enc = new TextEncoder();
    const note = enc.encode(JSON.stringify(noteInfo));

    // Create a transaction to send FRY
    const txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      from,
      to,
      amount: testMode ? 0 : amount * 1_000_000,
      assetIndex,
      note,
      suggestedParams
    });

    // Sign the transaction with the account secret key
    const signedTxn = txn.signTxn(account.sk);

    // Send the signed transaction to the network
    const tx = await algodClient.sendRawTransaction(signedTxn).do();
    const checking = await verifyTransaction(from, tx.txId);
    const client = await clientPromise;
    const db = client.db('main');
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
      lockSet.delete(miner_key);
      return res.status(200).json({ txId: tx.txId });
    } else {
      lockSet.delete(miner_key);
      return res.status(500).json({ txId: tx.txId });
    }
  } catch (error) {
    lockSet.delete(miner_key);
    console.error(miner_key + ':' + error);
    return res.status(500).json({ txId: null });
  }
}
