import { NextApiRequest, NextApiResponse } from 'next';
import axios from 'axios';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import algosdk from 'algosdk';
import clientPromise from '../../../lib/mongoclient';
import { getFRYPrice } from '../../../lib/price';
import mongoose from 'mongoose';

import { Product } from '../../../lib/types';

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
    res.status(401).json({ message: 'Unauthorized 1' });
    return;
  }

  const data: {
    txId: string;
    type: string;
    address: string;
    miner_key: string;
    amount: number;
    asset_id: string;
  } = req.body;
  const { miner_key: miner, txId, address, asset_id, amount, type } = data;
  try {
    if (session.user.address !== address || !address) {
      console.log(
        `stake session.user.address: ${session.user.address}, address: ${address} SPOOF`
      );
      res.status(401).json({ message: 'Unauthorized 2' });
      return;
    }
    console.log('TxId: ' + txId);
    const client = await clientPromise;
    const db = client.db('main');
    const product = (await db
      .collection('products')
      .findOne({ key: miner.split('-')[0] })) as Product;
    if (!product) {
      res.status(404).json({ message: 'product not found' });
      return;
    }

    const miner_data = await db
      .collection(testMode ? 'test-devices' : 'devices')
      .findOne({ miner_key: miner });
    if (!miner_data) {
      res.status(404).json({ message: 'miner not found' });
      return;
    }
    const collection = db.collection(testMode ? 'test-devices' : 'devices');
    const result = await collection.updateOne(
      { miner_key: miner },
      {
        $set: {
          verified: true,
          'staked.type': type,
          'staked.amount': amount,
          'staked.txId': txId,
          'staked.asset_id': asset_id,
          'staked.time': new Date(Date.now())
        }
      }
    );

    if (result.matchedCount > 0) {
      console.log('success');
    } else {
      console.log('failed');
      res.status(200).json({ success: false, message: 'failed' });
    }

    res.status(200).json({ success: true, message: 'ok' });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: 'error' });
  }
}
