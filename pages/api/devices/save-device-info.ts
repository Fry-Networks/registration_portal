import { NextApiRequest, NextApiResponse } from 'next';
import axios from 'axios';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import algosdk from 'algosdk';
import clientPromise from '../../../lib/mongoclient';

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
    miner_key: string;
    names: { [key: string]: string };
    email: string;
    address: string;
    nickname: string;
    [key: string]: any; // Add index signature
  } = req.body;

  const { miner_key, names, email, address, nickname } = data;
  if (session.user.address !== address || !address) {
    // console.log(
    //   `session.user.address: ${session.user.address}, address: ${address} SPOOF`
    // );
    res.status(401).json({ message: 'Unauthorized 2' });
    return;
  }

  try {
    const client = await clientPromise;
    const db = client.db('main');
    const collection = db.collection(testMode ? 'test-devices' : 'devices');
    const exists = await collection.findOne({ miner_key });

    if (!exists) {
      res.status(400).json({ message: 'Not found' });
      return;
    }

    if (!exists.address || exists.address !== session.user.address) {
      res.status(401).json({ message: 'Unauthorized 2' });
      return;
    }

    const result = await collection.updateOne(
      { miner_key: miner_key },
      {
        $set: {
          names: names,
          email: email,
          nickname: nickname
        }
      }
    );

    if (result.matchedCount <= 0) {
      res.status(400).json({ message: 'Failed to registered' });
      return;
    }

    // console.log(`Registered ${miner_key}`);

    res.status(200).json({ message: 'ok' });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: 'error' });
  }
}
