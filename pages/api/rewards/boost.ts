import { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import clientPromise from '../../../lib/mongoclient';
import { Reward, RewardBoost } from '../../../lib/types';
import { getFRYPrice } from '../../../lib/price';
import { verifyTransaction } from '../algorand/verify-txn';
import algosdk, { mnemonicToSecretKey } from 'algosdk';
import { 
  DEFAULT_NODE_BASEURL,
  DEFAULT_NODE_TOKEN,
  DEFAULT_NODE_PORT,
 } from '@txnlab/use-wallet';

const algodClient = new algosdk.Algodv2(
  DEFAULT_NODE_TOKEN,
  DEFAULT_NODE_BASEURL,
  DEFAULT_NODE_PORT
);

const FRYALGO_WALLET = 'ATPVJYGEGP5H6GCZ4T6CG4PK7LH5OMWXHLXZHDPGO7RO6T3EHWTF6UUY6E';

const testMode =
  process.env.NEXT_PUBLIC_TEST_MODE &&
  process.env.NEXT_PUBLIC_TEST_MODE === 'true';

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
  } = req.body;

  const { miner_key, no } = data;

  try {
    const client = await clientPromise;
    const db = client.db('main');

    const device = await db
      .collection(testMode ? 'test-devices' : 'devices')
      .findOne({ miner_key });

    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }

    if (!device.address || device.address !== session.user.address) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }
    
    const collection = db.collection(testMode ? 'test-rewards' : 'rewards');
    const bCollection = db.collection('reward-boosts');

    const records = await collection
      .find(
        no
          ? { miner_key: miner_key, no: no, status: 'pending' }
          : { miner_key: miner_key, status: 'pending' }
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

    const params = await algodClient.getTransactionParams().do();
    const account = mnemonicToSecretKey(process.env.REWARD_MNEMONIC!);
    const from = account.addr;
    let txns: algosdk.TransactionLike[] = [];
    let signedTxns: Uint8Array[] = [];
    
    for (let i = 0; i < resultArray.length; i++) {
      const feeAmount = Math.round((resultArray[i].totalAmount * 100 * 30) / 100) / 100;

      const noteInfo = {
        action: "Instant Claim",
        miner_key:
          miner_key.split('-')[0] + '-' + miner_key.split('-')[1].slice(0, 6),
        asset_id: resultArray[i].asset_id,
        fee_amount: feeAmount,
        date: new Date(Date.now())
      };
      const enc = new TextEncoder();
      const note = enc.encode(JSON.stringify(noteInfo));

      const txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
        from,
        to: FRYALGO_WALLET,
        amount: testMode ? 0 : feeAmount * 1_000_000,
        note,
        assetIndex: Number(resultArray[i].asset_id),
        suggestedParams: params,
      });

      txns.push(txn);

      const signedTxn = txn.signTxn(account.sk);
      signedTxns.push(signedTxn);
    }

    let success = true;
    for (let i = 0; i < records.length; i++) {
      const reward = records[i] as Reward;
      const boostedAmount = Math.round((reward.amount * 100 * 70) / 100) / 100;
      const updateResult = await collection.updateOne(
        { no: reward.no, miner_key: reward.miner_key },
        {
          $set: {
            status: 'claimable',
            amount: boostedAmount
          }
        }
      );

      if (updateResult.matchedCount <= 0) {
        success = false;
      }

      let boostReward = {} as RewardBoost;
      boostReward.miner_key = reward.miner_key;
      boostReward.address = session.user.address;
      boostReward.rewards_no = reward.no;
      boostReward.fee = Math.round((reward.amount * 100 * 30) / 100) / 100;
      boostReward.amount = reward.amount;
      boostReward.asset_id = reward.asset_id;
      boostReward.price = await getFRYPrice(reward.asset_id);
      boostReward.createdAt = new Date();
      const insertResult = await bCollection.insertOne(boostReward);
    }

    if (success === false) {
      res.status(200).json({
        success: false,
        message: `Failed to boost rewards for miner ${miner_key}`
      });
      return;
    }

    algosdk.assignGroupID(txns);
    const tx = await algodClient.sendRawTransaction(signedTxns).do();
    const result = await verifyTransaction(tx.txId, account.addr);

    if (!result) {
      res
        .status(402)
        .json({ message: 'Failed to make verify Instant Claim fee transaction' });
      return;
    }

    res
      .status(200)
      .json({ success: true, message: `Boost success for ${miner_key}` });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: 'Internal server error' });
    return;
  }
}
