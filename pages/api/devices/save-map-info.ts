import { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import { latLngToCell } from 'h3-js';
import { collectionFor } from '../../../lib/credentials-utils';
import clientPromise from '../../../lib/mongoclient';
import { loggers } from '../../../lib/logger';
import {
  CommonErrors,
  createApiError,
  ErrorCodes,
  handleApiError,
} from '../../../lib/api-errors';

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

  const testMode =
    process.env.NEXT_PUBLIC_TEST_MODE &&
    process.env.NEXT_PUBLIC_TEST_MODE === 'true';

  const session = await getServerSession(req, res, authOptions);
  // Check if user is authenticated
  if (!session || !session.user) {
    return res.status(401).json(CommonErrors.noSession());
  }

  const data: {
    miner_key: string;
    position: {
      lat: string;
      lng: string;
    };
    address: string;
  } = req.body;

  const { miner_key, position, address } = data;
  if (session.user.address !== address || !address) {
    loggers.apiError('/api/devices/save-map-info', new Error('Wallet mismatch updating map info'), {
      sessionAddress: session.user.address,
      address,
      miner_key,
      issueType: 'DEVICE_LOCATION_WALLET_MISMATCH',
      part: 'devices.save-map-info.auth',
    });
    return res.status(401).json(CommonErrors.walletMismatch());
  }

  try {
    const client = await clientPromise;
    const CREDS_DB_NAME = process.env.MONGO_CREDS_DB ?? 'creds';

    const mainDb = client.db('main');
    const devicesCollection = mainDb.collection(
      testMode ? 'test-devices' : 'devices'
    );
    const deviceRecord = await devicesCollection.findOne({ miner_key });

    if (!deviceRecord) {
      return res.status(404).json(
        createApiError(
          ErrorCodes.DEVICE_NOT_FOUND,
          'Device not found',
          'Please verify the miner key and try again.'
        )
      );
    }

    if (
      deviceRecord.address &&
      deviceRecord.address !== session.user.address
    ) {
      return res.status(401).json(CommonErrors.walletMismatch());
    }

    const db = client.db(CREDS_DB_NAME);
    const collectionName = collectionFor({ miner_key });
    const collection = db.collection(collectionName);

    // compute H3 resolution 7 cell for this position and store it with position
    const latNum = Number(position.lat);
    const lngNum = Number(position.lng);
    const res7 = latLngToCell(latNum, lngNum, 7);

    const existingDocs = await collection.find({ miner_key }).toArray();
    const matchingDoc = existingDocs.find(
      (doc) => doc.address === session.user.address
    );
    const conflictingDoc = existingDocs.find(
      (doc) => doc.address && doc.address !== session.user.address
    );

    if (!matchingDoc && conflictingDoc) {
      return res.status(401).json(CommonErrors.walletMismatch());
    }

    // Upsert a credential doc keyed by miner_key + address so map info lives
    // in the same collection as credentials. This mirrors save-credentials which
    // upserts by miner_key + address.
    const filter = matchingDoc
      ? { _id: matchingDoc._id }
      : { miner_key, address: session.user.address };
    const update = {
      $set: {
        miner_key,
        address: session.user.address,
        position: {
          lat: latNum,
          lng: lngNum,
          hexId: res7,
        },
        // record a timestamp of when position saved to aid debugging
        position_saved_at: new Date(),
      },
    };
    await collection.updateOne(filter, update, { upsert: true });

    res.status(200).json({ message: 'ok' });
  } catch (error) {
    handleApiError(res, '/api/devices/save-map-info', error, {
      response: createApiError(
        ErrorCodes.INTERNAL_ERROR,
        'Unable to update device location',
        'Please try again. If the problem persists, contact support.'
      ),
      minerKey: miner_key,
      walletAddress: address,
      issueType: 'DEVICE_LOCATION_UPDATE_ERROR',
      part: 'devices.save-map-info.handler',
      metadata: {
        miner_key,
        address,
        position,
      },
    });
  }
}
