import { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import clientPromise from '../../../lib/mongoclient';
import logger from '../../../lib/logger';
import {
  CommonErrors,
  createApiError,
  ErrorCodes,
  handleApiError,
} from '../../../lib/api-errors';
import { Product } from '../../../lib/types';

const DB_NAME = process.env.MONGO_CREDS_DB ?? 'creds';
const WEATHER_COLLECTION = process.env.MONGO_WEATHER_COLLECTION ?? 'weather';
const ENERGY_COLLECTION =  process.env.MONGO_ENERGY_COLLECTION ?? 'energy';
const HARDWARE_COLLECTION = process.env.MONGO_HARDWARE_COLLECTION ?? 'hardware';
const AIR_COLLECTION = process.env.MONGO_AIR_COLLECTION ?? 'air';
const RADIATION_COLLECTION = process.env.MONGO_RADIATION_COLLECTION ?? 'radiation';
const CAMERA_COLLECTION = process.env.MONGO_CAMERA_COLLECTION ?? 'camera';
const WATER_COLLECTION = process.env.MONGO_WATER_COLLECTION ?? 'water';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json(
      createApiError(
        ErrorCodes.INVALID_INPUT,
        'That request is not available.',
        'Please retry this action from the dashboard.'
      )
    );
  }

  const session = await getServerSession(req, res, authOptions);

  if (!session || !session.user) {
    return res.status(401).json(CommonErrors.noSession());
  }

  const { miner_key, address } = req.body;

  try {
    const client = await clientPromise;
    const db = client.db('main');
    const collection = db.collection('devices');
    const exists = await collection.findOne({ miner_key: miner_key });

    if (!exists) {
      return res.status(404).json(
        createApiError(
          ErrorCodes.DEVICE_NOT_FOUND,
          'Miner key not found',
          'Please verify the miner key and try again.'
        )
      );
    }

    if (!exists.is_registered) {
      return res.status(400).json(
        createApiError(
          ErrorCodes.DEVICE_NOT_REGISTERED,
          'This device is not registered',
          'Refresh the page to confirm its status.'
        )
      );
    }

    if (exists.address && exists.address !== session.user.address) {
      return res.status(401).json(CommonErrors.walletMismatch());
    }

    const credentialDb = client.db(DB_NAME);
    const weatherCollection = credentialDb.collection(WEATHER_COLLECTION);
    const energyCollection = credentialDb.collection(ENERGY_COLLECTION);
    const hardwareCollection = credentialDb.collection(HARDWARE_COLLECTION);
    const airCollection = credentialDb.collection(AIR_COLLECTION);
    const radiationCollection = credentialDb.collection(RADIATION_COLLECTION);
    const cameraCollection = credentialDb.collection(CAMERA_COLLECTION);
    const waterCollection = credentialDb.collection(WATER_COLLECTION);

    // Remove any stored portal credentials for this miner across creds DB
    await Promise.all([
      weatherCollection.deleteMany({ miner_key, owner_address: session.user.address }),
      energyCollection.deleteMany({ miner_key, owner_address: session.user.address }),
      hardwareCollection.deleteMany({ miner_key, address: session.user.address }),
      airCollection.deleteMany({ miner_key, owner_address: session.user.address }),
      radiationCollection.deleteMany({ miner_key, owner_address: session.user.address }),
      cameraCollection.deleteMany({ miner_key, owner_address: session.user.address }),
      waterCollection.deleteMany({ miner_key, owner_address: session.user.address })
    ]);

    const product = (await db
      .collection('products')
      .findOne({ key: miner_key.split('-')[0] })) as Product;
    if (!product) {
      return res.status(404).json(
        createApiError(
          ErrorCodes.PRODUCT_NOT_FOUND,
          'Product configuration not found',
          'Please contact support for assistance.'
        )
      );
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
    handleApiError(res, '/api/devices/delete', error, {
      response: createApiError(
        ErrorCodes.INTERNAL_ERROR,
        'Unable to delete device',
        'Please try again. If the problem persists, contact support.'
      ),
      minerKey: miner_key,
      walletAddress: address,
      issueType: 'DEVICE_DELETE_ERROR',
      part: 'devices.delete.handler',
      metadata: {
        miner_key,
        address,
      },
    });
  }
}
