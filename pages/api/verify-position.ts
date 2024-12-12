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
    res.status(401).json({ message: 'Unauthorized 1' });
    return;
  }

  const data: {
    latitude: number;
    longitude: number;
    address: string;
    miner: string;
  } = req.body;
  const { miner, latitude, longitude, address } = data;
  try {
    if (session.user.address !== address || !address) {
      console.log(
        `position session.user.address: ${session.user.address}, address: ${address} SPOOF`
      );
      res.status(401).json({ message: 'Unauthorized 2' });
      return;
    }
    if (!miner || !latitude || !longitude) {
      res.status(400).json({ message: 'Missing parameters' });
      return;
    }
    const client = await clientPromise;
    const db = client.db('main');
    const collection = db.collection(testMode ? 'test-devices' : 'devices');
    await collection.updateOne(
      { miner_key: miner, address: session.user.address },
      {
        $set: {
          position: {
            lat: latitude,
            lng: longitude
          }
        }
      }
    );

    res.status(200).json({ message: 'ok' });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: 'error' });
  }
}
