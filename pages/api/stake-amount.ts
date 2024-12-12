import { NextApiRequest, NextApiResponse } from 'next';
import axios from 'axios';
import { getServerSession } from 'next-auth';
import { authOptions } from './auth/[...nextauth]';
import algosdk from 'algosdk';
import clientPromise from '../../lib/mongoclient';
import { getFRYPrice } from '../../lib/price';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const session = await getServerSession(req, res, authOptions);
  // Check if user is authenticated
  if (!session || !session.user) {
    console.log(`no session`);
    res.status(401).json({ message: 'Unauthorized 1' });
    return;
  }

  const data: {
    address: string;
    key: string;
  } = req.body;

  const { address, key } = data;
  console.log(req.body);
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
    const collection = db.collection('products');
    const product = await collection.findOne({ key: key });
    if (!product) {
      res.status(404).json({ message: 'not found' });
      return;
    }
    /*let price = await getFRYPrice();
        if (!price) return 1;
        const USD = product.reward.stake ?? 0;
        price = Math.floor((USD / price)) 
        */
    let price = product.reward.stake ?? { stake_one: 0, stake_two: 0 };

    const data = {
      stake: price
    };

    res.status(200).json({ message: 'ok', data });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: 'error' });
  }
}
