import { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import clientPromise from '../../../lib/mongoclient';
import { FryToken } from '../../../lib/types';

interface FryTokenData {
  name: string;
  asset_id: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const testMode =
    process.env.NEXT_PUBLIC_TEST_MODE &&
    process.env.NEXT_PUBLIC_TEST_MODE === 'true';

  const session = await getServerSession(req, res, authOptions);

  if (!session || !session.user) {
    console.log('No session');
    res.status(401).json({ message: 'No session' });
    return;
  }

  const { name, asset_id } = req.body as FryTokenData;

  console.log(name, asset_id);

  try {
    const client = await clientPromise;
    const db = client.db('main');
    const collection = db.collection('tokens');
    const token =
      name && asset_id
        ? await collection.findOne({ name: name, asset_id: asset_id })
        : name
          ? await collection.findOne({ name: name })
          : await collection.findOne({ asset_id: asset_id });
    if (!token) {
      res.status(400).json({ message: 'Token is not found' });
      return;
    }

    res.status(200).json({ result: 'ok', token: token });
  } catch (error) {
    res.status(500).json({
      message: `There's an error during deleting the device. Please check internet status and try again. If error occured again let us know`
    });
  }
}
