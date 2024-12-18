import { NextApiRequest, NextApiResponse } from 'next';
import axios from 'axios';
import { getServerSession } from 'next-auth';
import { authOptions } from './auth/[...nextauth]';
import algosdk from 'algosdk';
import clientPromise from '../../lib/mongoclient';
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
    console.log(`no session`);
    res.status(401).json({ message: 'Unauthorized 1' });
    return;
  }

  const data: {
    miner_key: string;
    address: string;
  } = req.body;

  const { miner_key, address } = data;
  if (session.user.address !== address || !address) {
    console.log(
      `miner type session.user.address: ${session.user.address}, address: ${address} SPOOF`
    );
    res.status(401).json({ message: 'Unauthorized 2' });
    return;
  }
  try {
    const miner_type = miner_key.split('-')[0];
    const client = await clientPromise;
    const db = client.db('main');
    const collection = db.collection('products');
    const test = await collection.findOne({ key: miner_type });
    if (!test) {
      res.status(404).json({ message: 'Product Not found' });
      return;
    }
    const exists = await db
      .collection(testMode ? 'test-devices' : 'devices')
      .findOne({ miner_key: miner_key });
    if (!exists) {
      res.status(400).json({ message: 'Not found' });
      return;
    }
    if (exists.is_registered) {
      res.status(400).json({ message: 'Already registered' });
      return;
    }

    res.status(200).json({ message: 'ok', name: test.name, type: test.type });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: 'error' });
  }
}
