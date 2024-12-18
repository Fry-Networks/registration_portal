import { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import clientPromise from '../../../lib/mongoclient';
import { FryToken } from '../../../lib/types';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const testMode =
    process.env.NEXT_PUBLIC_TEST_MODE &&
    process.env.NEXT_PUBLIC_TEST_MODE === 'true';

  const session = await getServerSession(req, res, authOptions);

  if (!session || !session.user) {
    res.status(401).json({ message: 'No session' });
    return;
  }

  try {
    const client = await clientPromise;
    const db = client.db('main');
    const collection = db.collection('tokens');
    const exists = (await collection.find({}).toArray()) as FryToken[];

    if (!exists) {
      res.status(400).json({ message: 'No token information' });
      return;
    }

    if (exists.length > 0) {
      res.status(200).json({ result: 'ok', tokens: exists });
    } else {
      res.status(200).json({
        result: 'fail',
        message: 'Failed to get all token information'
      });
    }
  } catch (error) {
    res.status(500).json({
      message: `There's an error during deleting the device. Please check internet status and try again. If error occured again let us know`
    });
  }
}
