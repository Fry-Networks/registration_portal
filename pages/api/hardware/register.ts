import type { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import clientPromise from '../../../lib/mongoclient';
import { MongoServerError } from 'mongodb';

const MAC_ADDRESS_REGEX = /^(?:[0-9A-F]{2}[:-]){5}[0-9A-F]{2}$/i;
const HARDWARE_DB_NAME = process.env.MONGO_CREDS_DB ?? 'creds';
const HARDWARE_COLLECTION = process.env.MONGO_CREDS_COLLECTION ?? 'hardware';

const LINKED_MINER_TYPES: Record<string, string[]> = {
  ISM: ['OSM'],
  OSM: ['ISM'],
  IDM: ['ODM'],
  ODM: ['IDM']
};

type SuccessResponse = { message: string };
type ConflictResponse = {
  message: string;
  existingMac?: string;
  conflictMinerKey?: string;
};
type ErrorResponse = { message: string };
type GetResponse = { miner_mac: string | null };

type ApiResponse =
  | SuccessResponse
  | ConflictResponse
  | ErrorResponse
  | GetResponse;

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse>
) {
  if (!['GET', 'POST', 'DELETE'].includes(req.method ?? '')) {
    res.setHeader('Allow', ['GET', 'POST', 'DELETE']);
    res.status(405).end('Method Not Allowed');
    return;
  }

  try {
    const session = await getServerSession(req, res, authOptions);

    if (!session || !session.user || !session.user.address) {
      if (req.method === 'GET') {
        res.status(200).json({ miner_mac: null });
        return;
      }

      res.status(401).json({ message: 'Unauthorized' });
      return;
    }

    const client = await clientPromise;
    const db = client.db(HARDWARE_DB_NAME);
    const collection = db.collection(HARDWARE_COLLECTION);

    if (req.method === 'GET') {
      const { miner_key } = req.query;

      if (!miner_key || typeof miner_key !== 'string') {
        res.status(400).json({ message: 'Missing miner_key' });
        return;
      }

      const existingMiner = await collection.findOne({ miner_key });

      if (!existingMiner) {
        res
          .status(404)
          .json({ message: 'No registration found for miner_key' });
        return;
      }

      if (
        existingMiner.address &&
        existingMiner.address !== session.user.address
      ) {
        res.status(403).json({ message: 'Forbidden' });
        return;
      }

      res.status(200).json({ miner_mac: existingMiner.miner_mac ?? null });
      return;
    }

    if (req.method === 'POST') {
      const { miner_key, miner_mac } = req.body ?? {};

      if (!miner_key || typeof miner_key !== 'string') {
        res.status(400).json({ message: 'Missing miner_key' });
        return;
      }

      if (!miner_mac || typeof miner_mac !== 'string') {
        res.status(400).json({ message: 'Missing miner_mac' });
        return;
      }

      const trimmedMac = miner_mac.trim();

      if (!MAC_ADDRESS_REGEX.test(trimmedMac)) {
        res.status(400).json({ message: 'Invalid MAC address format' });
        return;
      }

      const normalizedMac = trimmedMac.toUpperCase();
      const [minerType = ''] = miner_key.split('-');

      const existingMiner = await collection.findOne({ miner_key });

      if (
        existingMiner &&
        existingMiner.address &&
        existingMiner.address !== session.user.address
      ) {
        res.status(403).json({ message: 'Forbidden' });
        return;
      }

      const linkedTypes = LINKED_MINER_TYPES[minerType] ?? [];
      if (linkedTypes.length > 0) {
        const minerKeySuffix = miner_key.slice(minerType.length);
        const linkedMinerKeys = linkedTypes
          .map((linkedType) => `${linkedType}${minerKeySuffix}`)
          .filter((key) => key !== miner_key);

        if (linkedMinerKeys.length > 0) {
          const linkedMiners = await collection
            .find({ miner_key: { $in: linkedMinerKeys } })
            .toArray();

          for (const linkedMiner of linkedMiners) {
            const linkedMac =
              typeof linkedMiner.miner_mac === 'string'
                ? linkedMiner.miner_mac.toUpperCase()
                : '';

            if (linkedMac && linkedMac !== normalizedMac) {
              res.status(409).json({
                message: 'MAC address conflicts with linked miner registration.',
                conflictMinerKey: linkedMiner.miner_key
              });
              return;
            }
          }
        }
      }
      const conflictingMac = await collection.findOne({
        miner_type: minerType,
        miner_mac: { $regex: `^${normalizedMac}$`, $options: 'i' },
        miner_key: { $ne: miner_key }
      });

      if (conflictingMac) {
        res.status(409).json({
          message: 'MAC address is already registered to another miner',
          conflictMinerKey: conflictingMac.miner_key
        });
        return;
      }

      if (existingMiner) {
        const existingNormalized =
          typeof existingMiner.miner_mac === 'string'
            ? existingMiner.miner_mac.toUpperCase()
            : '';

        if (existingNormalized === normalizedMac) {
          res.status(200).json({ message: 'MAC address unchanged.' });
          return;
        }

        await collection.updateOne(
          { miner_key },
          {
            $set: {
              miner_mac: normalizedMac,
              miner_type: minerType,
              address: session.user.address
            }
          }
        );

        res.status(200).json({ message: 'Hardware credentials updated.' });
        return;
      }

      await collection.insertOne({
        miner_key,
        miner_type: minerType,
        miner_mac: normalizedMac,
        address: session.user.address
      });

      res.status(200).json({ message: 'Hardware credentials saved.' });
      return;
    }

    const { miner_key: deleteMinerKey } = req.body ?? {};

    if (!deleteMinerKey || typeof deleteMinerKey !== 'string') {
      res.status(400).json({ message: 'Missing miner_key' });
      return;
    }

    const existingMiner = await collection.findOne({
      miner_key: deleteMinerKey
    });

    if (!existingMiner) {
      res.status(404).json({ message: 'No registration found for miner_key' });
      return;
    }

    if (
      existingMiner.address &&
      existingMiner.address !== session.user.address
    ) {
      res.status(403).json({ message: 'Forbidden' });
      return;
    }

    await collection.deleteOne({ miner_key: deleteMinerKey });

    res.status(200).json({ message: 'Hardware credentials deleted.' });
  } catch (error) {
    console.error('[hardware/register] error', error);
    if (error instanceof MongoServerError && error.code === 13) {
      res.status(500).json({
        message:
          'Database user is not authorized to access the hardware credentials collection. Update Mongo permissions or set MONGO_CREDS_DB / MONGO_CREDS_COLLECTION.'
      });
      return;
    }

    const message =
      error instanceof Error ? error.message : 'Internal server error';
    res.status(500).json({ message });
  }
}


