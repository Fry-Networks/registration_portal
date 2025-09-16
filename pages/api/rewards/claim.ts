import { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import clientPromise from '../../../lib/mongoclient';
import { Device, Reward } from '../../../lib/types';
import algosdk, { mnemonicToSecretKey, waitForConfirmation } from 'algosdk';
import { getAssetDecimals } from '../../../lib/utils';
import { VERIFY_RESULT } from '../../../lib/txn';
import { WithId } from 'mongodb';

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

  let records: WithId<Reward>[] = [];
  let step = { id: 1, value: 'Step1: Initialization' };

  try {
    const client = await clientPromise;
    const db = client.db('main');
    const collection = db.collection(testMode ? 'test-rewards' : 'rewards');
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

    let claimTargetMode: 'legacy' | 'device' = 'legacy';
    if (!WEEKLY_FLAG) {
      records = await collection
        .find(
          no
            ? { miner_key: miner_key, no: no, status: 'claimable' }
            : { miner_key: miner_key, status: 'claimable' }
        )
        .toArray() as WithId<Reward>[];
      if (!records || records.length <= 0) {
        lockSet.delete(miner_key);
        res.status(404).json({ success: false, code: 'NO_REWARDS', message: 'No rewards available to claim' });
        return;
      }
      claimTargetMode = 'legacy';
    } else {
      // WEEKLY MODE: prefer device-rewards (weekly + daily) as source of truth
      const doc = await weeklyCollection.findOne({ miner_key });
      const weeklyClaimables = (doc?.weekly_rewards || []).filter((wr: any) => wr.status === 'claimable');
      const dailyClaimables = (doc?.daily_rewards || []).filter((dr: any) => dr.status === 'claimable');

      let weeklyTargets: any[] = [];
      let dailyTargets: any[] = [];

      if (typeof no === 'number') {
        weeklyTargets = weeklyClaimables.filter((wr: any) => wr.reward_number === no);
        if (weeklyTargets.length === 0) {
          dailyTargets = dailyClaimables.filter((dr: any) => dr.reward_number === no);
        }
        if (weeklyTargets.length === 0 && dailyTargets.length === 0) {
          // Final fallback: legacy specific
          const legacyTargets = await collection.find({ miner_key, no, status: 'claimable' }).toArray();
          if (!legacyTargets || legacyTargets.length === 0) {
            lockSet.delete(miner_key);
            res.status(404).json({ success: false, code: 'NO_REWARDS', message: 'No rewards available to claim' });
            return;
          }
          records = legacyTargets as any;
          claimTargetMode = 'legacy';
        } else {
          const deviceRecords: any[] = [];
          weeklyTargets.forEach((wr: any) => deviceRecords.push({ source: 'weekly', reward_number: wr.reward_number, asset_id: wr.asset_id, amount: wr.amount }));
          dailyTargets.forEach((dr: any) => deviceRecords.push({ source: 'daily', reward_number: dr.reward_number, asset_id: dr.asset_id, amount: dr.amount }));
          records = deviceRecords as any;
          claimTargetMode = 'device';
        }
      } else {
        if (weeklyClaimables.length === 0 && dailyClaimables.length === 0) {
          // Fallback to legacy device-level
          const legacyList = await collection.find({ miner_key, status: 'claimable' }).toArray();
          if (!legacyList || legacyList.length === 0) {
            lockSet.delete(miner_key);
            res.status(404).json({ success: false, code: 'NO_REWARDS', message: 'No rewards available to claim' });
            return;
          }
          records = legacyList as any;
          claimTargetMode = 'legacy';
        } else {
          const deviceRecords: any[] = [];
          weeklyClaimables.forEach((wr: any) => deviceRecords.push({ source: 'weekly', reward_number: wr.reward_number, asset_id: wr.asset_id, amount: wr.amount }));
          dailyClaimables.forEach((dr: any) => deviceRecords.push({ source: 'daily', reward_number: dr.reward_number, asset_id: dr.asset_id, amount: dr.amount }));
          records = deviceRecords as any;
          claimTargetMode = 'device';
        }
      }
    }

    let success = true;
    if (claimTargetMode === 'legacy') {
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
    }

    if (success === false) {
      lockSet.delete(miner_key);
      res.status(500).json({ success: false, code: 'NETWORK_ERROR', message: `Failed to set claimed status for miner ${miner_key}` });
      return;
    }

    step.id = 2;
    step.value = 'Updated status to "claimed" for selected rewards (pre-broadcast).';

    type Result = {
      asset_id: number;
      totalAmount: number;
      txId?: string; // Optional field
    };

    const sumByAssetId = records.reduce((acc, reward: any) => {
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

    // post-broadcast updates
    if (claimTargetMode === 'legacy') {
      // Legacy daily: set txId/claimedAt in legacy and mirror into device-rewards.daily_rewards
      let modifiedAny = false;
      for (let i = 0; i < records.length; i++) {
        const reward = records[i] as Reward;
        const updateResult = await collection.updateOne(
          { no: reward.no, miner_key: reward.miner_key, status: 'claimable' },
          {
            $set: {
              txId: tx.txid,
              claimedAt: new Date(),
            }
          }
        );
        if (updateResult.modifiedCount && updateResult.modifiedCount > 0) modifiedAny = true;

        // Mirror into device-rewards.daily_rewards
        const upd = await weeklyCollection.updateOne(
          { miner_key },
          {
            $set: {
              'daily_rewards.$[elem].status': 'claimed',
              'daily_rewards.$[elem].tx_id': tx.txid,
              'daily_rewards.$[elem].claimed_at': new Date()
            }
          },
          { arrayFilters: [{ 'elem.reward_number': reward.no, 'elem.status': 'claimable' }] }
        );
        if (upd.modifiedCount && upd.modifiedCount > 0) modifiedAny = true;
      }
      // Adjust totals: claimable -> claimed
      const sumClaimed = records.reduce((acc, r: any) => acc + r.amount, 0);
      await weeklyCollection.updateOne(
        { miner_key },
        { $inc: { total_claimable: -sumClaimed, total_claimed: sumClaimed } }
      );
      if (!modifiedAny) {
        lockSet.delete(miner_key);
        return res.status(409).json({
          success: false,
          code: 'ALREADY_TRANSITIONED',
          message: 'Nothing to claim — selected rewards are no longer claimable. Please refresh.'
        });
      }
    } else {
      // Device-based: mark selected weekly and/or daily entries as claimed and set tx_id
      const weeklyNos = (records as any[]).filter(r => r.source === 'weekly').map(r => r.reward_number);
      const dailyNos = (records as any[]).filter(r => r.source === 'daily').map(r => r.reward_number);
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
    console.error(miner_key + ':' + error);
    lockSet.delete(miner_key);

    if (step.id === 2) {
      try {
        const client = await clientPromise;
        const db = client.db('main');
        if (!WEEKLY_FLAG) {
          const collection = db.collection(testMode ? 'test-rewards' : 'rewards');
          let ok = true;
          for (let i = 0; i < records.length; i++) {
            const reward = records[i] as Reward;
            const updateResult = await collection.updateOne(
              { no: reward.no, miner_key: reward.miner_key },
              { $set: { status: 'claimable' } }
            );
            if (updateResult.matchedCount <= 0) ok = false;
          }
          if (!ok) {
            res.status(402).json({ success: false, message: `Failed to reset claimed status for miner ${miner_key}` });
            return;
          }
        } else {
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
        }
      } catch (e) {
        // fallthrough to generic error
      }
    }

    res.status(500).json({ success: false, code: 'NETWORK_ERROR', message: step.value });
    return;
  }
}
