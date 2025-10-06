import { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import clientPromise from '../../../lib/mongoclient';
import { Device } from '../../../lib/types';
import algosdk, { mnemonicToSecretKey } from 'algosdk';
import { getAssetDecimals } from '../../../lib/utils';
import { loggers } from '../../../lib/logger';

const testMode =
  process.env.NEXT_PUBLIC_TEST_MODE &&
  process.env.NEXT_PUBLIC_TEST_MODE === 'true';
const WEEKLY_FLAG = process.env.NEXT_PUBLIC_WEEKLY_REWARDS_ENABLED === 'true' || process.env.WEEKLY_REWARDS_ENABLED === 'true';

const token = '';
const server = 'https://xna-mainnet-api.algonode.cloud/';
const tokenToSend = { 'X-API-Key': token };
const port = 443;
const algodClient = new algosdk.Algodv2(tokenToSend, server, port);

const lockSet: Set<string> = new Set();

type DeviceClaimTarget = {
  source: 'weekly' | 'daily';
  reward_number: number;
  asset_id: string; // stored as string in device-rewards; cast to number where needed
  amount: number;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
    no?: number; // optional in weekly mode to claim all claimable
    address: string;
  } = req.body;

  const { miner_key, no } = data;
  if (lockSet.has(miner_key)) {
    res.status(429).json({ success: false, code: 'NETWORK_ERROR', message: 'Another claim is in progress. Please try again shortly.' });
    return;
  }
  lockSet.add(miner_key);

  let records: DeviceClaimTarget[] = [];
  let step = { id: 1, value: 'Step1: Initialization' };

  try {
    const client = await clientPromise;
    const db = client.db('main');
    const weeklyCollection = db.collection('device-rewards');
    const deviceCollection = db.collection(
      testMode ? 'test-devices' : 'devices'
    );

    const device = await deviceCollection.findOne({ miner_key: miner_key });
    if (!device) {
      lockSet.delete(miner_key);
      res.status(404).json({ success: false, code: 'NETWORK_ERROR', message: 'Device not found' });
      return;
    }

    if (!device.reward_wallet) {
      lockSet.delete(miner_key);
      res.status(400).json({ success: false, code: 'NETWORK_ERROR', message: 'No reward wallet set' });
      return;
    }

    if (!device.address || device.address !== session.user.address) {
      lockSet.delete(miner_key);
      res.status(401).json({ success: false, code: 'UNAUTHORIZED', message: 'Unauthorized' });
      return;
    }

    // Always use device-rewards (weekly + daily) as source of truth
    const doc = await weeklyCollection.findOne({ miner_key });
    const weeklyClaimables = (doc?.weekly_rewards || []).filter((wr: any) => wr.status === 'claimable');
    const dailyClaimables = (doc?.daily_rewards || []).filter((dr: any) => dr.status === 'claimable');

    if (typeof no === 'number') {
      const weeklyTargets = weeklyClaimables.filter((wr: any) => wr.reward_number === no);
      const dailyTargets = weeklyTargets.length ? [] : dailyClaimables.filter((dr: any) => dr.reward_number === no);
      if (weeklyTargets.length === 0 && dailyTargets.length === 0) {
        lockSet.delete(miner_key);
        res.status(404).json({ success: false, code: 'NO_REWARDS', message: 'No rewards available to claim' });
        return;
      }
      weeklyTargets.forEach((wr: any) => records.push({ source: 'weekly', reward_number: wr.reward_number, asset_id: wr.asset_id, amount: wr.amount }));
      dailyTargets.forEach((dr: any) => records.push({ source: 'daily', reward_number: dr.reward_number, asset_id: dr.asset_id, amount: dr.amount }));
    } else {
      if (weeklyClaimables.length === 0 && dailyClaimables.length === 0) {
        lockSet.delete(miner_key);
        res.status(404).json({ success: false, code: 'NO_REWARDS', message: 'No rewards available to claim' });
        return;
      }
      weeklyClaimables.forEach((wr: any) => records.push({ source: 'weekly', reward_number: wr.reward_number, asset_id: wr.asset_id, amount: wr.amount }));
      dailyClaimables.forEach((dr: any) => records.push({ source: 'daily', reward_number: dr.reward_number, asset_id: dr.asset_id, amount: dr.amount }));
    }

    step.id = 2;
    step.value = 'Prepared selected rewards for claim (pre-broadcast).';

    type Result = {
      asset_id: number;
      totalAmount: number;
      txId?: string; // Optional field
    };

    const sumByAssetId = records.reduce((acc: Map<number, number>, reward: DeviceClaimTarget) => {
      const idNum = Number(reward.asset_id);
      const prev = acc.get(idNum) || 0;
      acc.set(idNum, Math.round((prev + reward.amount) * 100) / 100);
      return acc;
    }, new Map<number, number>());

    const resultArray: Result[] = Array.from(sumByAssetId.entries()).map(
      ([asset_id, totalAmount]) => ({
        asset_id,
        totalAmount
      })
    );

    step.value = 'Preparing network parameters';
    const suggestedParams = await algodClient.getTransactionParams().do();
    const account = mnemonicToSecretKey(process.env.REWARD_MNEMONIC!);
    const rekey = mnemonicToSecretKey(process.env.REWARD_REKEY!);

    const from = account.addr;
    let txns: algosdk.Transaction[] = [];
    let signedTxns: Uint8Array[] = [];

    for (let i = 0; i < resultArray.length; i++) {
      step.value = 'Creating reward transactions';
      const noteInfo = {
        miner_key:
          miner_key.split('-')[0] + '-' + miner_key.split('-')[1].slice(0, 6),
        asset_id: resultArray[i].asset_id,
        amount: resultArray[i].totalAmount,
        date: new Date(Date.now())
      };

      const enc = new TextEncoder();
      const note = enc.encode(JSON.stringify(noteInfo));
      
      const decimals = await getAssetDecimals(resultArray[i].asset_id);

      const txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
        sender: from,
        receiver: device.reward_wallet,
        amount: testMode ? 0 : resultArray[i].totalAmount * Math.pow(10, decimals || 0),
        assetIndex: Number(resultArray[i].asset_id),
        note,
        suggestedParams
      });

      txns.push(txn);
      step.value = 'Signing reward transactions';
      const signedTxn = txn.signTxn(rekey.sk);
      signedTxns.push(signedTxn);
    }

    step.value = 'Assigning group ID to transactions';
    algosdk.assignGroupID(txns);
    // const stx = await algodClient.simulateRawTransactions(signedTxns).do();

    // let fee: number | undefined = 0;
    // if (!stx) {
    //   fee = 1000;
    // } else {
    //   fee = stx.txnGroups[0].txnResults[0].txnResult.txn.txn.fee;
    // }
    // console.log("Simulation : ", stx.txnGroups[0].txnResults[0].txnResult.txn.txn.fee);

    // const isFeePaid = await requestGasFee(suggestedParams, session.user.address, from, fee);

    // if (!isFeePaid) {
    //   res
    //     .status(402)
    //     .json({ message: 'Failed to make fee payment transaction' });
    //   return;
    // }

    step.value = 'Broadcasting transactions to the network';
    const tx = await algodClient.sendRawTransaction(signedTxns).do();
    if (!tx) {
      lockSet.delete(miner_key);
      res.status(500).json({ success: false, code: 'NETWORK_ERROR', message: 'Failed to broadcast reward transaction' });
      return;
    }

    step.id = 3;
    step.value = `Broadcasted reward claim transaction.`;

    // post-broadcast updates (device-rewards only)
      // Device-based: mark selected weekly and/or daily entries as claimed and set tx_id
      const weeklyNos = records.filter(r => r.source === 'weekly').map(r => r.reward_number);
      const dailyNos = records.filter(r => r.source === 'daily').map(r => r.reward_number);
      const totalAmount = resultArray.reduce((acc, r) => acc + r.totalAmount, 0);

      let modifiedAny = false;
      if (weeklyNos.length > 0) {
        const updW = await weeklyCollection.updateOne(
          { miner_key },
          {
            $set: {
              'weekly_rewards.$[elem].status': 'claimed',
              'weekly_rewards.$[elem].tx_id': tx.txid,
              'weekly_rewards.$[elem].claimed_at': new Date()
            }
          },
          { arrayFilters: [{ 'elem.reward_number': { $in: weeklyNos }, 'elem.status': 'claimable' }] }
        );
        if (updW.modifiedCount && updW.modifiedCount > 0) modifiedAny = true;
      }

      if (dailyNos.length > 0) {
        const updD = await weeklyCollection.updateOne(
          { miner_key },
          {
            $set: {
              'daily_rewards.$[elem].status': 'claimed',
              'daily_rewards.$[elem].tx_id': tx.txid,
              'daily_rewards.$[elem].claimed_at': new Date()
            }
          },
          { arrayFilters: [{ 'elem.reward_number': { $in: dailyNos }, 'elem.status': 'claimable' }] }
        );
        if (updD.modifiedCount && updD.modifiedCount > 0) modifiedAny = true;
      }

      // Adjust totals
      await weeklyCollection.updateOne(
        { miner_key },
        { $inc: { total_claimable: -totalAmount, total_claimed: totalAmount } }
      );
      if (!modifiedAny) {
        lockSet.delete(miner_key);
        return res.status(409).json({
          success: false,
          code: 'ALREADY_TRANSITIONED',
          message: 'Nothing to claim — selected rewards are no longer claimable. Please refresh.'
        });
      }

    // no-op: all error cases above return early with clear messages

    step.id = 4;
    step.value = `Step4: Recorded transaction ID in database.`;

    lockSet.delete(miner_key);
    res.status(200).json({
      success: true,
      message: `Claim submitted for ${miner_key}`,
      result: tx.txid
    });

  } catch (error) {
    const claimError = error as any;
    const detailMessage =
      claimError?.response?.body?.message ||
      claimError?.response?.text ||
      claimError?.message ||
      (typeof claimError === 'string' ? claimError : JSON.stringify(claimError));

    loggers.apiError('/api/rewards/claim', claimError, {
      miner_key,
      step: step.value,
      detail: detailMessage,
    });
    lockSet.delete(miner_key);

    if (step.id === 2) {
      try {
        const client = await clientPromise;
        const db = client.db('main');
        const weeklyCollection = db.collection('device-rewards');
        // Reset weekly entries back to claimable
        const weeklyDoc = await weeklyCollection.findOne({ miner_key });
        const claimables = (weeklyDoc?.weekly_rewards || []).filter((wr: any) => wr.status === 'claimable');
        const targetNos = typeof data.no === 'number'
          ? claimables.filter((wr: any) => wr.reward_number === data.no).map((wr: any) => wr.reward_number)
          : claimables.map((wr: any) => wr.reward_number);
        await weeklyCollection.updateOne(
          { miner_key },
          {
            $set: {
              'weekly_rewards.$[elem].status': 'claimable',
              'weekly_rewards.$[elem].tx_id': undefined,
              'weekly_rewards.$[elem].claimed_at': undefined
            }
          },
          { arrayFilters: [{ 'elem.reward_number': { $in: targetNos } }] }
        );
      } catch (e) {
        // fallthrough to generic error
      }
    }

    res.status(500).json({ success: false, code: 'NETWORK_ERROR', message: step.value });
    return;
  }
}
