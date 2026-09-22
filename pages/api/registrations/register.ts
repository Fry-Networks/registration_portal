import { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import { loggers } from '../../../lib/logger';
import clientPromise from '../../../lib/mongoclient';
import { mayRebindClobberedDevice, rebindMetadata } from '../../../lib/rebindOwnership';
import {
  CommonErrors,
  createApiError,
  ErrorCodes,
  handleApiError,
} from '../../../lib/api-errors';

const ENDPOINT = '/api/registrations/register';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json(
      createApiError(
        ErrorCodes.INVALID_INPUT,
        'That request is not available.',
        'Please complete registrations from the dashboard.'
      )
    );
    return;
  }

  const testMode =
    process.env.NEXT_PUBLIC_TEST_MODE &&
    process.env.NEXT_PUBLIC_TEST_MODE === 'true';

  const session = await getServerSession(req, res, authOptions);
  // Check if user is authenticated
  if (!session || !session.user?.address) {
    res.status(401).json(CommonErrors.noSession());
    return;
  }

  const sessionAddress = session.user.address.trim();

  const { miner_key, address } = (req.body ?? {}) as {
    miner_key?: string;
    address?: string;
  };

  if (!miner_key || !address) {
    res.status(400).json(
      createApiError(
        ErrorCodes.INVALID_INPUT,
        'Missing registration fields',
        'Please include the miner key and wallet address.'
      )
    );
    return;
  }

  if (sessionAddress !== address) {
    loggers.apiError(ENDPOINT, new Error('Wallet mismatch during registration finalization'), {
      miner_key,
      address,
      sessionAddress,
      issueType: 'REGISTRATION_WALLET_MISMATCH',
      part: 'registrations.register.auth',
    });
    res.status(401).json(CommonErrors.walletMismatch());
    return;
  }

  try {
    const client = await clientPromise;
    const db = client.db('main');
    const collection = db.collection(testMode ? 'test-devices' : 'devices');
    let exists = await collection.findOne({ miner_key });
    if (!exists && /^FEM-[A-Za-z0-9]{32}$/.test(miner_key)) {
      // FEM 0.2.x clients generated lowercase-hex keys while the app displayed
      // them uppercased; accept a case-insensitive match and bind the STORED key.
      exists = await collection.findOne({ miner_key: { $regex: `^${miner_key}$`, $options: 'i' } });
    }
    const boundKey = exists ? exists.miner_key : miner_key;

    if (!exists) {
      res.status(404).json(CommonErrors.deviceNotFound());
      return;
    }

    // RC1 (2026-09-22): the July premature binding clobbered address === reward_wallet ===
    // device_algo_address on 22 of 20,049 devices, so the rightful owner can neither see the
    // device (pages/devices.tsx lists by {address: session wallet}) nor re-register it. Let the
    // owner recover it -- but NEVER on miner-key possession alone, because install keys
    // circulate in Discord support threads. The proof is creds.hardware.address: the wallet
    // that registered this key at install time, which the clobber never touched.
    const clobberedAddress = (exists.address || '').trim();
    const mayRebind = await mayRebindClobberedDevice(client, exists, boundKey, address);

    if (!mayRebind && exists.address && exists.address !== address) {
      res.status(409).json(CommonErrors.deviceOwnerMismatch());
      return;
    }

    // A device flagged is_registered but carrying no address is owned by nobody: the
    // owner-mismatch gate above short-circuits on the falsy address, so refusing here
    // left it permanently unclaimable (485 such devices measured 2026-09-14).
    if (!mayRebind && exists.is_registered && exists.address) {
      res.status(400).json(
        createApiError(
          ErrorCodes.ALREADY_REGISTERED,
          'Device already registered',
          'No further action is required.'
        )
      );
      return;
    }

    const updateResult = await collection.updateOne(
      { miner_key: boundKey },
      {
        $set: {
          is_registered: true,
          address: address,
          // claim.ts pays device.reward_wallet, so a verified rebind has to move it too.
          ...(mayRebind ? { reward_wallet: address, ...rebindMetadata(clobberedAddress) } : {})
        }
      }
    );

    if (updateResult.matchedCount === 0) {
      res.status(404).json(CommonErrors.deviceNotFound());
      return;
    }

    loggers.dbOperation('registration_confirmed', collection.collectionName, {
      miner_key,
      address,
      testMode,
    });

    res.status(200).json({ message: 'ok' });
  } catch (error) {
    handleApiError(res, ENDPOINT, error, {
      response: createApiError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to complete registration',
        'Please try again or contact support.'
      ),
      minerKey: miner_key,
      walletAddress: sessionAddress,
      issueType: 'DEVICE_REGISTRATION_ERROR',
      part: 'registrations.register.handler',
      metadata: {
        miner_key,
        address,
        testMode,
      },
    });
  }
}
