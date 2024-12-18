import { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import clientPromise from '../../../lib/mongoclient';
import { Device, Reward } from '../../../lib/types';
import algosdk, { mnemonicToSecretKey, waitForConfirmation } from 'algosdk';
import { verifyTransaction } from '../algorand/verify-txn';

const testMode =
  process.env.NEXT_PUBLIC_TEST_MODE &&
  process.env.NEXT_PUBLIC_TEST_MODE === 'true';

const token = '';
const server = 'https://xna-mainnet-api.algonode.cloud/';
const tokenToSend = { 'X-API-Key': token };
const port = 443;
const algodClient = new algosdk.Algodv2(tokenToSend, server, port);

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const session = await getServerSession(req, res, authOptions);

  if (!session || !session.user) {
    res.status(401).json({ message: 'Unauthroized' });
    return;
  }

  const data: {
    miner_key: string;
    no: number;
    address: string;
  } = req.body;

  const { miner_key, no } = data;

  try {
    const client = await clientPromise;
    const db = client.db('main');
    const collection = db.collection(testMode ? 'test-rewards' : 'rewards');
    const deviceCollection = db.collection(
      testMode ? 'test-devices' : 'devices'
    );

    const device = await deviceCollection.findOne({ miner_key: miner_key });
    if (!device) {
      res.status(402).json({ message: 'No device' });
      return;
    }

    if (!device.reward_wallet) {
      res.status(402).json({ message: 'No reward wallet set' });
      return;
    }

    const records = await collection
      .find(
        no
          ? { miner_key: miner_key, no: no, status: 'claimable' }
          : { miner_key: miner_key, status: 'claimable' }
      )
      .toArray();
    if (!records || records.length <= 0) {
      res.status(402).json({ message: 'No rewards data' });
      return;
    }

    type Result = {
      asset_id: number;
      totalAmount: number;
      txId?: string; // Optional field
    };

    const sumByAssetId = records.reduce((acc, reward) => {
      const asset_id = reward.asset_id ?? '924268058';
      if (acc.has(asset_id)) {
        acc.set(
          asset_id,
          Math.round((acc.get(asset_id)! + reward.amount) * 100) / 100
        );
      } else {
        acc.set(asset_id, reward.amount);
      }
      return acc;
    }, new Map<number, number>());

    const resultArray: Result[] = Array.from(sumByAssetId.entries()).map(
      ([asset_id, totalAmount]) => ({
        asset_id,
        totalAmount
      })
    );

    const suggestedParams = await algodClient.getTransactionParams().do();

    for (let i = 0; i < resultArray.length; i++) {
      const noteInfo = {
        miner_key:
          miner_key.split('-')[0] + '-' + miner_key.split('-')[1].slice(0, 6),
        asset_id: resultArray[i].asset_id,
        amount: resultArray[i].totalAmount,
        date: new Date(Date.now())
      };

      const enc = new TextEncoder();
      const note = enc.encode(JSON.stringify(noteInfo));
      const account = mnemonicToSecretKey(process.env.REWARD_MNEMONIC!);
      const from = account.addr;

      const txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
        from,
        to: device.reward_wallet,
        amount: testMode ? 0 : resultArray[i].totalAmount * 1_000_000,
        assetIndex: Number(resultArray[i].asset_id),
        note,
        suggestedParams
      });

      const signedTxn = txn.signTxn(account.sk);
      const tx = await algodClient.sendRawTransaction(signedTxn).do();

      if (!tx) {
        res
          .status(402)
          .json({ message: 'Failed to make rewarding transaction' });
        return;
      }

      const result = await verifyTransaction(tx.txId, account.addr);

      if (!result) {
        res
          .status(402)
          .json({ message: 'Failed to make verify reward transaction' });
        return;
      }

      resultArray[i].txId = tx.txId;
    }

    let success = true;
    for (let i = 0; i < records.length; i++) {
      const reward = records[i] as Reward;
      const updateResult = await collection.updateOne(
        { no: reward.no, miner_key: reward.miner_key },
        {
          $set: {
            status: 'claimed',
            txId: resultArray.find((value) => {
              return (
                value.asset_id.toString() === (reward.asset_id ?? '924268058')
              );
            })?.txId
          }
        }
      );

      if (updateResult.matchedCount <= 0) {
        success = false;
      }
    }

    if (success === false) {
      res.status(200).json({
        success: false,
        message: `Failed to claim rewards for miner ${miner_key}`
      });
      return;
    }

    res.status(200).json({
      success: true,
      message: `Claim success for ${miner_key}`,
      result: resultArray
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: 'Internal server error' });
    return;
  }
}
