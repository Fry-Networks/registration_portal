import { NextApiRequest, NextApiResponse } from 'next';
import axios from 'axios';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import algosdk from 'algosdk';
import { latLngToCell } from 'h3-js';
import { collectionFor } from '../credentials/utils';
import clientPromise from '../../../lib/mongoclient';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const testMode =
    process.env.NEXT_PUBLIC_TEST_MODE &&
    process.env.NEXT_PUBLIC_TEST_MODE === 'true';

  const session = await getServerSession(req, res, authOptions);
  // Check if user is authenticated
  if (!session || !session.user) {
    res.status(401).json({ message: 'Unauthorized 1' });
    return;
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
    res.status(401).json({ message: 'Unauthorized 2' });
    return;
  }

  try {
    const client = await clientPromise;
    const CREDS_DB_NAME = process.env.MONGO_CREDS_DB ?? 'creds';

    const db = client.db(CREDS_DB_NAME);
    const collectionName = collectionFor({ miner_key });
    const collection = db.collection(collectionName);

    // compute H3 resolution 7 cell for this position and store it with position
    const latNum = Number(position.lat);
    const lngNum = Number(position.lng);
    const res7 = latLngToCell(latNum, lngNum, 7);

    // Upsert a credential doc keyed by miner_key + address so map info lives
    // in the same collection as credentials. This mirrors save-credentials which
    // upserts by miner_key + address.
    const filter = { miner_key, address: session.user.address };
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
    console.error(miner_key + ':' + error);
    res.status(500).json({ message: 'error' });
  }
}
