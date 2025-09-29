import { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import clientPromise from '../../../lib/mongoclient';
import { getFRYPrice } from '../../../lib/price';
import { withdraw } from '../stake/stake-withdraw';
import { Product } from '../../../lib/types';

const WEATHER_DB_NAME = process.env.MONGO_CREDS_DB ?? 'creds';
const WEATHER_COLLECTION =
  process.env.MONGO_WEATHER_COLLECTION ??
  (process.env.NEXT_PUBLIC_TEST_MODE === 'true' ? 'test-weather' : 'weather');
const ENERGY_COLLECTION =
  process.env.MONGO_ENERGY_COLLECTION ??
  (process.env.NEXT_PUBLIC_TEST_MODE === 'true' ? 'test-energy' : 'energy');

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

    if (exists.address && exists.address !== session.user.address) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }

    const credentialDb = client.db(WEATHER_DB_NAME);
    const weatherCollection = credentialDb.collection(WEATHER_COLLECTION);
    const energyCollection = credentialDb.collection(ENERGY_COLLECTION);

    await Promise.all([
      weatherCollection.deleteMany({
        miner_key,
        owner_address: session.user.address
      }),
      energyCollection.deleteMany({
        miner_key,
        owner_address: session.user.address
      })
    ]);

    const product = (await db
      .collection('products')
      .findOne({ key: miner_key.split('-')[0] })) as Product;
    if (!product) {
      res.status(404).json({ message: 'Product not found' });
      return;
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
          nickname: '',
          registration: '',
          node: '',
          note: '',
          registered_portal_model: ''
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
    console.error(miner_key + ':' + error);
    res.status(500).json({
      message: `There's an error during deleting the device. Please check internet status and try again. If error occured again let us know`
    });
  }
}
