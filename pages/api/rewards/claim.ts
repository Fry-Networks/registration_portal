import { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import clientPromise from '../../../lib/mongoclient';
import { Device, Reward } from '../../../lib/types';
import algosdk, { mnemonicToSecretKey, waitForConfirmation } from 'algosdk';
import { verifyTransaction } from '../algorand/verify-txn';
import { getAssetDecimals } from '../../../lib/utils';
import { VERIFY_RESULT } from '../../../lib/txn';
import { WithId } from 'mongodb';

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
  let records: WithId<Reward>[] = [];
  let step = { id: 1, value: 'Step1: Initialization' };

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

    if (!device.address || device.address !== session.user.address) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }

    records = await collection
      .find(
        no
          ? { miner_key: miner_key, no: no, status: 'claimable' }
          : { miner_key: miner_key, status: 'claimable' }
      )
      .toArray() as WithId<Reward>[];
    if (!records || records.length <= 0) {
      res.status(402).json({ message: 'No rewards data' });
      return;
    }

    let success = true;
    for (let i = 0; i < records.length; i++) {
      const reward = records[i] as Reward;
      const updateResult = await collection.updateOne(
        { no: reward.no, miner_key: reward.miner_key },
        {
          $set: {
            status: 'claimed',
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
        message: `Failed to set claimed status for miner ${miner_key}`
      });
      return;
    }

    step.id = 2;
    step.value = 'Step2: Set claimable to claimed status.';

    type Result = {
      asset_id: number;
      totalAmount: number;
      txId?: string; // Optional field
    };

    const sumByAssetId = records.reduce((acc, reward) => {
      const asset_id = reward.asset_id ?? '924268058';
      if (acc.has(Number(asset_id))) {
        acc.set(
          Number(asset_id),
          Math.round((acc.get(Number(asset_id))! + reward.amount) * 100) / 100
        );
      } else {
        acc.set(Number(asset_id), reward.amount);
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
      const decimals = await getAssetDecimals(resultArray[i].asset_id);

      const txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
        from,
        to: device.reward_wallet,
        amount: testMode ? 0 : resultArray[i].totalAmount * Math.pow(10, decimals || 0),
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

      step.id = 3;
      step.value = `Step3: Transferred ${resultArray[i].asset_id} Asset Successfully.`;

      const result = await verifyTransaction(account.addr, tx.txId);
      // console.log(`${miner_key} transaction: `, account.addr, tx);

      if (result !== VERIFY_RESULT.OK) {
        res
          .status(402)
          .json({ message: 'Failed to make verify reward transaction' });
        return;
      }

      step.id = 4;
      step.value = `Step4: Confirmed ${resultArray[i].asset_id} Asset Transaction.`;

      resultArray[i].txId = tx.txId;
    }

    success = true;
    for (let i = 0; i < records.length; i++) {
      const reward = records[i] as Reward;
      const updateResult = await collection.updateOne(
        { no: reward.no, miner_key: reward.miner_key },
        {
          $set: {
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
      res.status(402).json({
        success: false,
        message: `Failed to set transaction ID for miner ${miner_key}`
      });
      return;
    }

    step.id = 5;
    step.value = `Step5: Set Transaction ID for each reward on Database.`;

    res.status(200).json({
      success: true,
      message: `Claim success for ${miner_key}`,
      result: resultArray
    });
  } catch (error) {
    console.error(miner_key + ':' + error);

    if (step.id === 2) {
      const client = await clientPromise;
      const db = client.db('main');
      const collection = db.collection(testMode ? 'test-rewards' : 'rewards');

      let success = true;
      for (let i = 0; i < records.length; i++) {
        const reward = records[i] as Reward;
        const updateResult = await collection.updateOne(
          { no: reward.no, miner_key: reward.miner_key },
          {
            $set: {
              status: 'claimable',
            }
          }
        );
  
        if (updateResult.matchedCount <= 0) {
          success = false;
        }
      }

      if (success === false) {
        res.status(402).json({
          success: false,
          message: `Failed to reset claimed status for miner ${miner_key}`
        });
        return;
      }
    }

    res.status(500).json({ message: step.value });
    return;
  }
}
