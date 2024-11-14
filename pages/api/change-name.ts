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
  const testMode = process.env.TEST_MODE && process.env.TEST_MODE === 'true';

  const session = await getServerSession(req, res, authOptions);
  // Check if user is authenticated
  if (!session || !session.user) {
    console.log(`no session`);
    res.status(401).json({ message: 'Unauthorized 1' });
    return;
  }

  const data: {
    address: string;
    name: string;
    miner_key: string;
  } = req.body;

  const { address, name, miner_key } = data;
  if (session.user.address !== address || !address) {
    console.log(
      `changename session.user.address: ${session.user.address}, address: ${address} SPOOF`
    );
    res.status(401).json({ message: 'Unauthorized 2' });
    return;
  }
  try {
    const client = await clientPromise;
    const db = client.db('main');
    const collection = db.collection(testMode ? 'test-devices' : 'devices');
    const device = await collection.findOne({ miner_key, address });
    if (!device) {
      res.status(404).json({ message: 'Not found' });
      return;
    }
    await collection.updateOne(
      { miner_key, address },
      { $set: { nickname: name } }
    );

    res.status(200).json({ message: 'ok' });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: 'error' });
  }
}
