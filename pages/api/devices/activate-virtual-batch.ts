import { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import clientPromise from '../../../lib/mongoclient';
import { loggers } from '../../../lib/logger';
import {
  CommonErrors,
  createApiError,
  ErrorCodes,
  handleApiError,
} from '../../../lib/api-errors';

const ENDPOINT = '/api/devices/activate-virtual-batch';
const MAX_BATCH_SIZE = 50;

type ActivationResult = {
  miner_key: string;
  success: boolean;
  error?: string;
  activated_at?: string;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json(
      createApiError(
        ErrorCodes.INVALID_INPUT,
        'Method not allowed.',
        'Please use POST to activate virtual devices.'
      )
    );
  }

  const testMode =
    process.env.NEXT_PUBLIC_TEST_MODE &&
    process.env.NEXT_PUBLIC_TEST_MODE === 'true';

  const session = await getServerSession(req, res, authOptions);
  if (!session || !session.user?.address) {
    return res.status(401).json(CommonErrors.noSession());
  }

  const sessionAddress = session.user.address.trim();
  const sessionEmail = session.user.email?.trim().toLowerCase();

  const { miner_keys } = (req.body ?? {}) as { miner_keys?: string[] };

  if (!Array.isArray(miner_keys) || miner_keys.length === 0) {
    return res.status(400).json(
      createApiError(
        ErrorCodes.INVALID_INPUT,
        'Missing miner keys',
        'Please include an array of miner keys to activate.'
      )
    );
  }

  if (miner_keys.length > MAX_BATCH_SIZE) {
    return res.status(400).json(
      createApiError(
        ErrorCodes.INVALID_INPUT,
        `Batch too large (max ${MAX_BATCH_SIZE})`,
        `Please activate no more than ${MAX_BATCH_SIZE} devices at once.`
      )
    );
  }

  try {
    const client = await clientPromise;
    const db = client.db('main');
    const collection = db.collection(testMode ? 'test-devices' : 'devices');
    const now = new Date();

    const results: ActivationResult[] = [];

    for (const miner_key of miner_keys) {
      if (!miner_key || typeof miner_key !== 'string') {
        results.push({ miner_key: miner_key ?? '', success: false, error: 'Invalid miner key' });
        continue;
      }

      const device = await collection.findOne({ miner_key, virtual: true });

      if (!device) {
        results.push({ miner_key, success: false, error: 'Device not found' });
        continue;
      }

      if (device.activated) {
        results.push({ miner_key, success: false, error: 'Already activated' });
        continue;
      }

      const deviceEmail = (device.email || '').trim().toLowerCase();
      const emailMatch = sessionEmail && deviceEmail && sessionEmail === deviceEmail;
      const isUnclaimed = !device.address;

      if (!emailMatch && !isUnclaimed) {
        results.push({ miner_key, success: false, error: 'Ownership mismatch' });
        continue;
      }

      const updateResult = await collection.updateOne(
        { miner_key, virtual: true, activated: false },
        {
          $set: {
            address: sessionAddress,
            activated: true,
            activated_at: now,
            reward_wallet: sessionAddress,
          }
        }
      );

      if (updateResult.modifiedCount === 1) {
        results.push({ miner_key, success: true, activated_at: now.toISOString() });
      } else {
        results.push({ miner_key, success: false, error: 'Update failed (race condition)' });
      }
    }

    const successCount = results.filter(r => r.success).length;

    loggers.dbOperation('virtual_batch_activation', collection.collectionName, {
      address: sessionAddress,
      total: miner_keys.length,
      succeeded: successCount,
      failed: miner_keys.length - successCount,
      testMode,
    });

    return res.status(200).json({ success: true, results, activated: successCount });
  } catch (error) {
    handleApiError(res, ENDPOINT, error, {
      response: createApiError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to activate virtual devices',
        'Please try again or contact support.'
      ),
      walletAddress: sessionAddress,
      issueType: 'VIRTUAL_BATCH_ACTIVATION_ERROR',
      part: 'devices.activate-virtual-batch.handler',
      metadata: { count: miner_keys?.length, address: sessionAddress, testMode },
    });
  }
}
