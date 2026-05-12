import type { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions, MySession } from '../auth/[...nextauth]';
import clientPromise from '../../../lib/mongoclient';
import { MongoServerError } from 'mongodb';
import { describeMacIssue, validateMacAddress } from '../../../lib/validators/macAddressValidator';
import { loggers } from '../../../lib/logger';
import {
  CommonErrors,
  createApiError,
  ErrorCodes,
  handleApiError,
} from '../../../lib/api-errors';

const HARDWARE_DB_NAME = process.env.MONGO_CREDS_DB ?? 'creds';
const PORTAL_CREDS_COLLECTION = process.env.MONGO_PORTAL_CREDS_COLLECTION ?? 'portal_creds';
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
    res.status(405).json(
      createApiError(
        ErrorCodes.INVALID_INPUT,
        'That request is not available.',
        'Please manage hardware credentials from the dashboard.'
      ) as ErrorResponse
    );
    return;
  }

  let session: MySession | null = null;

  try {
    session = await getServerSession(req, res, authOptions);

    if (!session || !session.user || !session.user.address) {
      if (req.method === 'GET') {
        res.status(200).json({ miner_mac: null });
        return;
      }

      res.status(401).json(CommonErrors.noSession() as ErrorResponse);
      return;
    }

  const client = await clientPromise;
  const db = client.db(HARDWARE_DB_NAME);
  const portalCollection = db.collection(PORTAL_CREDS_COLLECTION);
  // alias for backward compatibility with earlier code that referenced `collection`
  const collection = portalCollection;

    if (req.method === 'GET') {
      const { miner_key } = req.query;

      if (!miner_key || typeof miner_key !== 'string') {
        res.status(400).json(
          createApiError(
            ErrorCodes.INVALID_INPUT,
            'Missing miner key',
            'Provide the miner key to load hardware details.'
          ) as ErrorResponse
        );
        return;
      }

  const existingMiner = await portalCollection.findOne({ miner_key });

      if (!existingMiner) {
        res
          .status(404)
          .json(
            createApiError(
              ErrorCodes.DEVICE_NOT_FOUND,
              'No registration found for miner key',
              'Verify the miner key and try again.'
            ) as ErrorResponse
          );
        return;
      }

      if (
        existingMiner.address &&
        existingMiner.address !== session.user.address
      ) {
        res.status(403).json(CommonErrors.deviceOwnerMismatch() as ErrorResponse);
        return;
      }

      res.status(200).json({ miner_mac: existingMiner.miner_mac ?? null });
      return;
    }

    if (req.method === 'POST') {
      res.status(410).json({ message: "This endpoint is deprecated. Hardware registration is no longer available." });
      return;
    }

   const { miner_key: deleteMinerKey } = req.body ?? {};

    if (!deleteMinerKey || typeof deleteMinerKey !== 'string') {
      res.status(400).json(
        createApiError(
          ErrorCodes.INVALID_INPUT,
          'Missing miner key',
          'Provide the miner key to remove hardware credentials.'
        ) as ErrorResponse
      );
      return;
    }

    const existingMiner = await portalCollection.findOne({
      miner_key: deleteMinerKey
    });

    if (!existingMiner) {
      res.status(404).json(
        createApiError(
          ErrorCodes.DEVICE_NOT_FOUND,
          'No registration found for miner key',
          'Verify the miner key and try again.'
        ) as ErrorResponse
      );
      return;
    }

    if (
      existingMiner.address &&
      existingMiner.address !== session.user.address
    ) {
      res.status(403).json(CommonErrors.deviceOwnerMismatch() as ErrorResponse);
      return;
    }

    const testMode =
      process.env.NEXT_PUBLIC_TEST_MODE &&
      process.env.NEXT_PUBLIC_TEST_MODE === 'true';

    const devicesCollection = client
      .db('main')
      .collection(testMode ? 'test-devices' : 'devices');

    const linkedDevice = await devicesCollection.findOne({
      miner_key: deleteMinerKey
    });

    if (
      linkedDevice?.address &&
      linkedDevice.address !== session.user.address
    ) {
      res.status(403).json({ message: 'Forbidden' });
      return;
    }

    await devicesCollection.updateOne(
      { miner_key: deleteMinerKey },
      { $unset: { registered_portal_model: '' } }
    );

    // Remove temporary portal credential
    await portalCollection.deleteOne({ miner_key: deleteMinerKey });

    res.status(200).json({ message: 'Hardware credentials deleted.' });
  } catch (error) {
    if (error instanceof MongoServerError && error.code === 13) {
      handleApiError(res, '/api/hardware/register', error, {
        response: createApiError(
          ErrorCodes.INTERNAL_ERROR,
          'Not authorized to access hardware credentials',
          'Check permissions.'
        ),
        walletAddress: req.body?.address ?? null,
        issueType: 'HARDWARE_REGISTER_DB_PERMISSION_ERROR',
        part: 'hardware.register.mongoAuth',
      });
      return;
    }

    handleApiError(res, '/api/hardware/register', error, {
      response: createApiError(
        ErrorCodes.INTERNAL_ERROR,
        'Unexpected hardware credential error',
        'Please try again. If the problem persists, contact support.'
      ),
      walletAddress: session?.user?.address ?? undefined,
      issueType: 'HARDWARE_REGISTER_ERROR',
      part: `hardware.register.${req.method?.toLowerCase()}`,
      metadata: {
        method: req.method,
        miner_key: req.body?.miner_key,
      },
    });
  }
}
