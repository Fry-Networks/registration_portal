import { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import clientPromise from '../../../lib/mongoclient';
import { Reward } from '../../../lib/types';

const testMode =
  process.env.NEXT_PUBLIC_TEST_MODE &&
  process.env.NEXT_PUBLIC_TEST_MODE === 'true';

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
    const collection = db.collection(testMode ? 'test-rewards' : 'rewards');

    const records = await collection
      .find(
        no
          ? { miner_key: miner_key, no: no, status: 'pending' }
          : { miner_key: miner_key, status: 'pending' }
      )
      .toArray();
    if (!records || records.length <= 0) {
      res.status(402).json({ message: 'No rewards data' });
      return;
    }

    let success = true;
    for (let i = 0; i < records.length; i++) {
      const reward = records[i] as Reward;
      const boostedAmount = Math.round((reward.amount * 100 * 70) / 100) / 100;
      console.log(boostedAmount);
      const updateResult = await collection.updateOne(
        { no: reward.no, miner_key: reward.miner_key },
        {
          $set: {
            status: 'claimable',
            amount: boostedAmount
          }
        }
      );

      if (updateResult.matchedCount <= 0) {
        success = false;
      }
    }

    if (success === false) {
      res.status(200).json({
        success: false,
        message: `Failed to boost rewards for miner ${miner_key}`
      });
      return;
    }

    res
      .status(200)
      .json({ success: true, message: `Boost success for ${miner_key}` });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: 'Internal server error' });
    return;
  }
}
