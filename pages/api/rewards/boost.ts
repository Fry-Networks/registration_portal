import { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import clientPromise from '../../../lib/mongoclient';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const session = await getServerSession(req, res, authOptions);

  if (!session || !session.user) {
    res.status(401).json({ message: 'Unauthroized' });
    return;
  }

  const data: {
    miner_key: string;
    no: number;
  } = req.body;

  const { miner_key, no } = data;

  try {
    const client = await clientPromise;
    const db = client.db('main');
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: 'Internal server error' });
    return;
  }
}
