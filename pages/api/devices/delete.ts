import { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import clientPromise from '../../../lib/mongoclient';
import { getFRYPrice } from '../../../lib/price';
import { Product } from '../stake/verify-stake';
import { getTokenBalance } from '../stake/get-token-balance';
import { withdraw } from '../stake/stake-withdraw';

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

  const { miner_key, address } = req.body;

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

    const product = (await db
      .collection('products')
      .findOne({ key: miner_key.split('-')[0] })) as Product;
    if (!product) {
      res.status(404).json({ message: 'Product not found' });
      return;
    }

    if (exists.registration !== undefined) {
      const asset_id = exists.registration.asset_id;
      const amount = exists.registration.amount;

      const result = await withdraw(miner_key, address, amount, asset_id);
      if (!result) {
        res.status(500).json({ message: 'error' });
        return;
      }

      console.log(result);

      const updateResult = await collection.updateOne(
        { miner_key },
        {
          $unset: {
            registration: ''
          }
        }
      );

      if (updateResult.matchedCount <= 0) {
        res.status(200).json({
          result: 'fail',
          message:
            'Failed to delete registration staking information. Please check miner key and try again. If failed again please contact us.'
        });
      }
    }

    if (exists.node !== undefined) {
      const asset_id = exists.node.asset_id;
      const amount = exists.node.amount;

      const result = await withdraw(miner_key, address, amount, asset_id);
      if (!result) {
        res.status(500).json({ message: 'error' });
        return;
      }

      console.log(result);

      const updateResult = await collection.updateOne(
        { miner_key },
        {
          $unset: {
            node: ''
          }
        }
      );

      if (updateResult.matchedCount <= 0) {
        res.status(200).json({
          result: 'fail',
          message:
            'Failed to delete node staking information. Please check miner key and try again. If failed again please contact us.'
        });
      }
    }

    const result = await collection.updateOne(
      { miner_key: miner_key },
      {
        $set: {
          is_registered: false
        },
        $unset: {
          staked: '',
          verified: '',
          reward_wallet: '',
          connectivity_wallet: '',
          names: '',
          position: '',
          address: '',
          email: '',
          nickname: ''
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
