import { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import clientPromise from '../../../lib/mongoclient';
import { Reward, RewardBoost, Asset } from '../../../lib/types';
import { getFRYPrice } from '../../../lib/price';
import { verifyTransaction } from '../algorand/verify-txn';
import algosdk, { mnemonicToSecretKey, Account } from 'algosdk';
import { fixedInputSwap, FRY_1, FRY_2, fNODE, fVPN, ALGO, FRYALGO_WALLET } from '../../../lib/utils';
import { 
  DEFAULT_NODE_BASEURL,
  DEFAULT_NODE_TOKEN,
  DEFAULT_NODE_PORT,
 } from '@txnlab/use-wallet';
import { VERIFY_RESULT } from '../../../lib/txn';
import { AssetWithIdAndAmount } from '@tinymanorg/tinyman-js-sdk';

const algodClient = new algosdk.Algodv2(
  DEFAULT_NODE_TOKEN,
  DEFAULT_NODE_BASEURL,
  DEFAULT_NODE_PORT
);

const testMode =
  process.env.NEXT_PUBLIC_TEST_MODE &&
  process.env.NEXT_PUBLIC_TEST_MODE === 'true';

const swapWithInputAsset = async (acc: Account, asset: string, amount: number) => {

  if (asset === FRY_1.id) {
    const res_1 = await fixedInputSwap({account: acc, asset_1: FRY_1, asset_2: ALGO, amount: amount});
    if (res_1?.assetOut !== undefined) {
      const algoAmount = Number(res_1.assetOut.amount) / 10 ** ALGO.decimals;
      const res_2 = await fixedInputSwap({account: acc, asset_1: ALGO, asset_2: FRY_2, amount: algoAmount});
      return res_2?.assetOut;
    }
  } else if (asset === fNODE.id) {
    const res = await fixedInputSwap({account: acc, asset_1: fNODE, asset_2: FRY_2, amount: amount});
    return res?.assetOut;
  } else if (asset === fVPN.id) {
    const res = await fixedInputSwap({account: acc, asset_1: fVPN, asset_2: FRY_2, amount: amount});
    return res?.assetOut;
  } else {
    return undefined;
  }
}

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
    const rekey = algosdk.mnemonicToSecretKey(process.env.REWARD_REKEY!);

    const from = account.addr;
    let txns: algosdk.TransactionLike[] = [];
    let signedTxns: Uint8Array[] = [];
    let totalFeeAmount = 0;
    
    for (let i = 0; i < resultArray.length; i++) {
      const feeAmount = Math.round((resultArray[i].totalAmount * 100 * 30) / 100) / 100;

      let swappedAsset = {} as AssetWithIdAndAmount | undefined;
      if (Number(resultArray[i].asset_id) === Number(FRY_1.id)) {
        if (feeAmount > 10) {
          swappedAsset = await swapWithInputAsset(account, FRY_1.id, feeAmount);
          
          if (swappedAsset === undefined) {
            console.error("Failed to swap FRY1.0 asset for FRY2.0");
            res.status(402).json({
              success: false,
              message: `Failed to swap FRY1.0 asset for FRY2.0`
            });
            return;
          }
        } else {
          res.status(402).json({
            success: false,
            message: `Failed to swap too low FRY1.0 assets for FRY2.0`
          });
          return;
        }
      } else if (Number(resultArray[i].asset_id) === Number(fNODE.id) || Number(resultArray[i].asset_id) === Number(fVPN.id)){
        swappedAsset = await swapWithInputAsset(account, resultArray[i].asset_id.toString(), feeAmount);
        
        if (swappedAsset === undefined) {
          console.error("Failed to swap ${resultArray[i].asset_id} asset for FRY2.0");
          res.status(402).json({
            success: false,
            message: `Failed to swap ${resultArray[i].asset_id} asset for FRY2.0`
          });
          return;
        }
      }
      
      const noteInfo = {
        action: "Instant Claim",
        miner_key:
          miner_key.split('-')[0] + '-' + miner_key.split('-')[1].slice(0, 6),
        asset_id: FRY_2.id,
        fee_amount: Number(resultArray[i].asset_id) === Number(FRY_2.id) ? feeAmount : Number(swappedAsset?.amount) / 10 ** FRY_2.decimals,
        date: new Date(Date.now())
      };
      const enc = new TextEncoder();
      const note = enc.encode(JSON.stringify(noteInfo));

      const txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
        from,
        to: FRYALGO_WALLET,
        amount: testMode ? 0 : Number(resultArray[i].asset_id) === Number(FRY_2.id) ? feeAmount * Math.pow(10, FRY_2.decimals) : Number(swappedAsset?.amount),
        note,
        assetIndex: Number(FRY_2.id),
        suggestedParams: params,
        rekeyTo: rekey.addr
      });

      txns.push(txn);

      const signedTxn = txn.signTxn(rekey.sk);
      signedTxns.push(signedTxn);
      totalFeeAmount += Number(resultArray[i].asset_id) === Number(FRY_2.id) ? feeAmount : Number(swappedAsset?.amount) / 10 ** FRY_2.decimals;
    }

    let success = true;
    let rewards_nos: number[] = [];
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

      rewards_nos.push(reward.no);
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

    let boostReward = {} as RewardBoost;
    boostReward.miner_key = miner_key;
    boostReward.address = session.user.address;
    boostReward.rewards_nos = rewards_nos;
    boostReward.fee_amount = totalFeeAmount;
    boostReward.asset_id = FRY_2.id;
    boostReward.price = await getFRYPrice(FRY_2.id);
    boostReward.createdAt = new Date();
    boostReward.txID = tx.txId;
    const insertResult = await bCollection.insertOne(boostReward);
    
    const result = await verifyTransaction(account.addr, tx.txId);

    if (result !== VERIFY_RESULT.OK) {
      res
        .status(402)
        .json({ message: 'Failed to make verify Instant Claim fee transaction' });
      return;
    }

    res
      .status(200)
      .json({ success: true, message: `Boost success for ${miner_key}` });
  } catch (error) {
    console.error(miner_key + ':' + error);
    res.status(500).json({ message: 'Internal server error' });
    return;
  }
}
