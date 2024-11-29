import { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import clientPromise from '../../../lib/mongoclient';

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

  const { miner_key } = req.body;

  try {
    const client = await clientPromise;
    const db = client.db('main');
    const collection = db.collection(testMode ? 'test-devices' : 'devices');
    const exists = await collection.findOne({ miner_key: miner_key });

    if (!exists) {
      res.status(400).json({ message: 'Miner key is not found' });
      return;
    }

    if (!exists.is_registered) {
      res.status(400).json({ message: 'Miner is not registered' });
      return;
    }

    const result = await collection.updateOne(
      { miner_key: miner_key },
      {
        $set: {
          is_registered: false
        },
        $unset: {
          'staked.type': '',
          'staked.amount': '',
          'staked.time': '',
          'staked.txid': '',
          verified: '',
          reward_wallet: '',
          names: '',
          position: '',
          address: ''
        }
      }
    );

    if (result.matchedCount >= 1) {
      res
        .status(200)
        .json({ result: 'ok', message: 'Deleted the device successfully' });
    } else {
      res.status(200).json({
        result: 'fail',
        message:
          'Failed to delete device. Please check miner key and try again. If failed again please contact us.'
      });
    }
  } catch (error) {
    res.status(500).json({
      message: `There's an error during deleting the device. Please check internet status and try again. If error occured again let us know`
    });
  }
}
