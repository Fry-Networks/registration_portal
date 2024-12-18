import { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import clientPromise from '../../../lib/mongoclient';

interface GetRewardAmountData {
  miner_key: string;
  status: string;
  date?: Date;
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
    res.status(401).json({ message: 'Unauthorized 1' });
    return;
  }

  const { miner_key, status, date } = req.body as GetRewardAmountData;

  console.log(`Miner Key: ${miner_key} Status: ${status}`);

  const client = await clientPromise;

  try {
    const db = client.db('main');
    const collection = testMode
      ? db.collection('test-rewards')
      : db.collection('rewards');

    const targetRecords = date
      ? await collection
          .find({
            miner_key: miner_key,
            status: status,
            createdAt: date
          })
          .toArray()
      : await collection
          .find({ miner_key: miner_key, status: status })
          .toArray();

    if (targetRecords && targetRecords.length >= 0) {
      res.status(200).json({ success: true, records: targetRecords });
    } else {
      res.status(200).json({ success: false });
    }
  } catch (error) {
    console.error(`Reward Amount: error`);
    res.status(500).json({ message: 'Internal server error' });
  }
}
