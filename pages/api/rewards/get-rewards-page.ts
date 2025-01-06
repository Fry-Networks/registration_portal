import { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import clientPromise from '../../../lib/mongoclient';

interface GetPageRewardData {
  miner_key: string;
  page: number;
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

  const { miner_key, page } = req.body as GetPageRewardData;

  // console.log(`Miner Key: ${miner_key} Status: ${page}`);

  const client = await clientPromise;

  try {
    const db = client.db('main');

    const exists = await db
      .collection(testMode ? 'test-devices' : 'devices')
      .findOne({ miner_key });

    if (!exists) {
      res.status(400).json({ message: 'Not found' });
      return;
    }

    if (exists.address && exists.address !== session.user.address) {
      res.status(401).json({ message: 'Unauthorized 2' });
      return;
    }

    const collection = testMode
      ? db.collection('test-rewards')
      : db.collection('rewards');

    const pageSize = 20;
    const skip = (Number(page) - 1) * Number(pageSize);

    const items = await collection
      .find({ miner_key: miner_key })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(pageSize))
      .toArray();

    const totalItems = await collection.countDocuments({
      miner_key: miner_key
    });
    const totalPages = Math.ceil(totalItems / Number(pageSize));

    if (items && items.length >= 0) {
      res.status(200).json({ success: true, items, totalPages });
    } else {
      res.status(200).json({ success: false });
    }
  } catch (error) {
    console.error(`Page Rewards Error: ${error}`);
    res.status(500).json({ message: 'Internal server error' });
  }
}
