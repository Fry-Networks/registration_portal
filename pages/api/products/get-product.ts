import { NextApiRequest, NextApiResponse } from 'next';
import axios from 'axios';
import { getServerSession } from 'next-auth';
import algosdk from 'algosdk';
import { authOptions } from '../auth/[...nextauth]';
import clientPromise from '../../../lib/mongoclient';
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const session = await getServerSession(req, res, authOptions);
  // Check if user is authenticated
  if (!session || !session.user) {
    res.status(401).json({ success: false, code: 'UNAUTHORIZED', message: 'Unauthorized' });
    return;
  }

  const data: {
    miner_key: string;
  } = req.body;

  const { miner_key } = data;
  const productType = miner_key.split('-')[0];

  try {
    const client = await clientPromise;
    const db = client.db('main');
    const collection = db.collection('products');
    const products = await collection.find({}).toArray();
    const data = products.filter((product) => {
      return product.key === productType;
    });

    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, code: 'NETWORK_ERROR', message: 'Internal server error' });
  }
}
