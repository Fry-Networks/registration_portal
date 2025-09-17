import { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import clientPromise from '../../../lib/mongoclient';
import { RewardBoost, Asset } from '../../../lib/types';
import { getFRYPrice } from '../../../lib/price';
import { verifyTransaction } from '../algorand/verify-txn';
import algosdk, { mnemonicToSecretKey, Account } from 'algosdk';
import { fixedInputSwap, FRY_1, FRY_2, fNODE, fVPN, ALGO, FRYALGO_WALLET } from '../../../lib/utils';
import { VERIFY_RESULT } from '../../../lib/txn';
import { AssetWithIdAndAmount } from '@tinymanorg/tinyman-js-sdk';

// Algod client configuration (align with other API routes)
const token = '';
const server = 'https://xna-mainnet-api.algonode.cloud/';
const tokenToSend = { 'X-API-Key': token };
const port = 443;
const algodClient = new algosdk.Algodv2(tokenToSend, server, port);

const testMode =
  process.env.NEXT_PUBLIC_TEST_MODE &&
  process.env.NEXT_PUBLIC_TEST_MODE === 'true';
const WEEKLY_FLAG = process.env.NEXT_PUBLIC_WEEKLY_REWARDS_ENABLED === 'true' || process.env.WEEKLY_REWARDS_ENABLED === 'true';

const swapWithInputAsset = async (acc: Account, asset: string, amount: number, rekey: Account) => {

  if (asset === FRY_1.id) {
    const res_1 = await fixedInputSwap({account: acc, asset_1: FRY_1, asset_2: ALGO, amount: amount, rekey});
    if (res_1?.assetOut !== undefined) {
      const algoAmount = Number(res_1.assetOut.amount) / 10 ** ALGO.decimals;
      const res_2 = await fixedInputSwap({account: acc, asset_1: ALGO, asset_2: FRY_2, amount: algoAmount, rekey});
      return res_2?.assetOut;
    }
  } else if (asset === fNODE.id) {
    const res = await fixedInputSwap({account: acc, asset_1: fNODE, asset_2: FRY_2, amount: amount, rekey});
    return res?.assetOut;
  } else if (asset === fVPN.id) {
    const res = await fixedInputSwap({account: acc, asset_1: fVPN, asset_2: FRY_2, amount: amount, rekey});
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
    res.status(401).json({ success: false, code: 'UNAUTHORIZED', message: 'Unauthorized' });
    return;
  }

  const data: {
    miner_key: string;
    no?: number; // optional in weekly mode
  } = req.body;

  const { miner_key, no } = data;

  try {
    const client = await clientPromise;
    const db = client.db('main');

    const device = await db
      .collection(testMode ? 'test-devices' : 'devices')
      .findOne({ miner_key });

    if (!device) {
      return res.status(404).json({ success: false, code: 'NETWORK_ERROR', message: 'Device not found' });
    }

    if (!device.address || device.address !== session.user.address) {
      res.status(401).json({ success: false, code: 'UNAUTHORIZED', message: 'Unauthorized' });
      return;
    }
    const weeklyCollection = db.collection('device-rewards');
    const bCollection = db.collection('reward-boosts');

    type BoostRecord = { reward_number: number; asset_id: string; amount: number };
    let records: BoostRecord[] = [];
    let mode: 'weekly' | 'daily' = 'weekly';
    const weeklyDoc = await weeklyCollection.findOne({ miner_key });
    const weeklyPendings = (weeklyDoc?.weekly_rewards || []).filter((wr: any) => wr.status === 'pending');
    const dailyPendings = (weeklyDoc?.daily_rewards || []).filter((dr: any) => dr.status === 'pending');
    if (typeof no === 'number') {
      const weeklyRecords = weeklyPendings.filter((wr: any) => wr.reward_number === no);
      if (weeklyRecords && weeklyRecords.length > 0) {
        records = weeklyRecords;
        mode = 'weekly';
      } else {
        const dailyRecords = dailyPendings.filter((dr: any) => dr.reward_number === no);
        if (dailyRecords && dailyRecords.length > 0) {
          records = dailyRecords;
          mode = 'daily';
        } else {
          res.status(404).json({ success: false, code: 'NO_REWARDS', message: 'No pending reward with that number. If it shows claimable, please use Claim.' });
          return;
        }
      }
    } else {
      if (weeklyPendings.length > 0) {
        records = weeklyPendings;
        mode = 'weekly';
      } else if (dailyPendings.length > 0) {
        records = dailyPendings;
        mode = 'daily';
      } else {
        res.status(404).json({ success: false, code: 'NO_REWARDS', message: 'No pending rewards to boost. If the selected reward is already claimable, please use Claim.' });
        return;
      }
    }

    type Result = {
      asset_id: number;
      totalAmount: number;
      txId?: string; // Optional field
    };

    const sumByAssetId = records.reduce((acc: Map<number, number>, reward: any) => {
      const asset_id = Number(reward.asset_id ?? '924268058');
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

    const entries = Array.from(sumByAssetId.entries()) as Array<[number, number]>;
    const resultArray: Result[] = entries.map(([asset_id, totalAmount]) => ({ asset_id, totalAmount }));

    const params = await algodClient.getTransactionParams().do();
    const account = mnemonicToSecretKey(process.env.REWARD_MNEMONIC!);
    const rekey = mnemonicToSecretKey(process.env.REWARD_REKEY!);

    const from = account.addr;
    let txns: algosdk.Transaction[] = [];
    let signedTxns: Uint8Array[] = [];
    let totalFeeAmount = 0;
    
    for (let i = 0; i < resultArray.length; i++) {
      const feeAmount = Math.round((resultArray[i].totalAmount * 100 * 30) / 100) / 100;

      let swappedAsset = {} as AssetWithIdAndAmount | undefined;
      if (Number(resultArray[i].asset_id) === Number(FRY_1.id)) {
        if (feeAmount > 10) {
          swappedAsset = await swapWithInputAsset(account, FRY_1.id, feeAmount, rekey);
          
          if (swappedAsset === undefined) {
            console.error("Failed to swap FRY1.0 asset for FRY2.0");
            res.status(500).json({ success: false, code: 'SWAP_FAILED', message: `Failed to swap FRY1.0 asset for FRY2.0` });
            return;
          }
        } else {
          res.status(400).json({ success: false, code: 'INSUFFICIENT_SWAP_AMOUNT', message: `Too little FRY1.0 to swap for FRY2.0` });
          return;
        }
      } else if (Number(resultArray[i].asset_id) === Number(fNODE.id) || Number(resultArray[i].asset_id) === Number(fVPN.id)){
        swappedAsset = await swapWithInputAsset(account, resultArray[i].asset_id.toString(), feeAmount, rekey);
        
        if (swappedAsset === undefined) {
          console.error(`Failed to swap ${resultArray[i].asset_id} asset for FRY2.0`);
          res.status(500).json({ success: false, code: 'SWAP_FAILED', message: `Failed to swap ${resultArray[i].asset_id} asset for FRY2.0` });
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
        sender: from,
        receiver: FRYALGO_WALLET,
        amount: testMode ? 0 : Number(resultArray[i].asset_id) === Number(FRY_2.id) ? feeAmount * Math.pow(10, FRY_2.decimals) : Number(swappedAsset?.amount),
        note,
        assetIndex: Number(FRY_2.id),
        suggestedParams: params,
      });

      txns.push(txn);

      const signedTxn = txn.signTxn(rekey.sk);
      signedTxns.push(signedTxn);
      totalFeeAmount += Number(resultArray[i].asset_id) === Number(FRY_2.id) ? feeAmount : Number(swappedAsset?.amount) / 10 ** FRY_2.decimals;
    }

    algosdk.assignGroupID(txns);
    const tx = await algodClient.sendRawTransaction(signedTxns).do();
    if (!tx) {
      res.status(500).json({ success: false, code: 'NETWORK_ERROR', message: `Failed to submit boost transaction` });
      return;
    }

    // Apply database updates only after successful submission
    let rewards_nos: number[] = [];
    if (mode === 'daily') {
      let modifiedAny = false;
      for (let i = 0; i < records.length; i++) {
        const r = records[i];
        const num = r.reward_number;
        const amt = r.amount;
        const boostedAmount = Math.round((amt * 100 * 70) / 100) / 100;

        // Source of truth: device-rewards.daily_rewards
        const devRes = await weeklyCollection.updateOne(
          { miner_key },
          {
            $set: {
              'daily_rewards.$[elem].status': 'claimable',
              'daily_rewards.$[elem].amount': boostedAmount
            }
          },
          { arrayFilters: [{ 'elem.reward_number': num, 'elem.status': 'pending' }] }
        );
        if (devRes.modifiedCount && devRes.modifiedCount > 0) modifiedAny = true;
        rewards_nos.push(num);
      }
      // Update device-rewards totals (pending -> claimable 70%)
      const sumOriginal = records.reduce((acc: number, r: any) => acc + (r.amount || 0), 0);
      const sumBoosted = records.reduce((acc: number, r: any) => acc + Math.round(((r.amount || 0) * 100 * 70) / 100) / 100, 0);
      await weeklyCollection.updateOne(
        { miner_key },
        { $inc: { total_pending: -sumOriginal, total_claimable: sumBoosted } }
      );
      if (!modifiedAny) {
        return res.status(409).json({
          success: false,
          code: 'ALREADY_TRANSITIONED',
          message: 'Nothing to boost — selected rewards are no longer pending. Please refresh.'
        });
      }
    } else {
      // WEEKLY MODE: Update many weekly entries: pending -> claimable and 70% amount
      const targetNos = records.map((wr: any) => wr.reward_number);
      const sumOriginal = records.reduce((acc: number, wr: any) => acc + wr.amount, 0);
      const sumBoosted = Math.round(sumOriginal * 0.7 * 100) / 100;
      const updateRes = await weeklyCollection.updateOne(
        { miner_key: data.miner_key },
        {
          $set: { 'weekly_rewards.$[elem].status': 'claimable' },
          $mul: { 'weekly_rewards.$[elem].amount': 0.7 },
          $inc: { total_pending: -sumOriginal, total_claimable: sumBoosted }
        },
        { arrayFilters: [{ 'elem.reward_number': { $in: targetNos }, 'elem.status': 'pending' }] }
      );
      if (!updateRes.modifiedCount || updateRes.modifiedCount <= 0) {
        return res.status(409).json({
          success: false,
          code: 'ALREADY_TRANSITIONED',
          message: 'Nothing to boost — selected rewards are no longer pending. Please refresh.'
        });
      }
      rewards_nos = targetNos;
    }

    let boostReward = {} as RewardBoost;
    boostReward.miner_key = miner_key;
    boostReward.address = session.user.address;
    boostReward.rewards_nos = rewards_nos;
    boostReward.fee_amount = totalFeeAmount;
    boostReward.asset_id = FRY_2.id;
    boostReward.price = await getFRYPrice(FRY_2.id);
    boostReward.createdAt = new Date();
    boostReward.txID = tx.txid;
    const insertResult = await bCollection.insertOne(boostReward);
    
    // Respond immediately; confirmation handled by client background polling
    res.status(200).json({ success: true, message: `Boost submitted for ${miner_key}`, txId: tx.txid });
  } catch (error) {
    console.error(miner_key + ':' + error);
    res.status(500).json({ success: false, code: 'NETWORK_ERROR', message: 'Internal server error' });
    return;
  }
}
