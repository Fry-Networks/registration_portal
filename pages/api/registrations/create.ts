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

const ENDPOINT = '/api/registrations/create';

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
        'Please start registrations from the dashboard.'
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

  const { miner_key, names, email, address, ...rest } = (req.body ?? {}) as {
    miner_key?: string;
    names?: { [key: string]: string };
    email?: string;
    address?: string;
    [key: string]: unknown;
  };

  if (!miner_key || !address || !names || typeof names !== 'object') {
    res.status(400).json(
      createApiError(
        ErrorCodes.INVALID_INPUT,
        'Missing registration details',
        'Please provide miner key, wallet address, and contact information.'
      )
    );
    return;
  }

  if (!email || typeof email !== 'string') {
    res.status(400).json(
      createApiError(
        ErrorCodes.INVALID_INPUT,
        'Email is required',
        'Please provide a valid contact email.'
      )
    );
    return;
  }

  const firstName = names.first_name;
  const lastName = names.last_name;

  if (sessionAddress !== address) {
    loggers.apiError(ENDPOINT, new Error('Wallet mismatch during registration create'), {
      miner_key,
      address,
      sessionAddress,
      issueType: 'REGISTRATION_WALLET_MISMATCH',
      part: 'registrations.create.auth',
    });
    res.status(401).json(CommonErrors.walletMismatch());
    return;
  }

  const body = {
    miner_key,
    names,
    email,
    address,
    ...rest,
  };

  const validationError = validateRegistrationPayload(body);
  if (validationError) {
    res.status(400).json(
      createApiError(
        ErrorCodes.INVALID_INPUT,
        validationError,
        'Please correct the highlighted fields and try again.'
      )
    );
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
    // F4 idempotent bind: auth already guarantees sessionAddress===address (the user's wallet).
    // Allow (re)bind when the device is unclaimed or already bound to THIS wallet.
    // RC1 (2026-09-22): the device-wallet carve-out this block used to apply (address ===
    // device_algo_address, the July premature binding) was satisfied by miner-key possession
    // ALONE, and install keys circulate in Discord support threads -- so any session holding a
    // clobbered device's key could take it. The rebind now additionally requires the session
    // wallet to equal creds.hardware.address, the wallet that registered the key at install
    // time, which the clobber never touched.
    let rebindSet: Record<string, unknown> = {};
    let mayRebind = false;
    {
      const existingAddr = (exists.address || '').trim();
      mayRebind = await mayRebindClobberedDevice(client, exists, boundKey, address);
      if (mayRebind) {
        // claim.ts pays device.reward_wallet, so a verified rebind has to move it too.
        rebindSet = { reward_wallet: address, ...rebindMetadata(existingAddr) };
      }
      // RC1 re-review (2026-09-22): this refusal used to be prefixed with
      // `exists.is_registered`, so a doc bound to ANOTHER wallet but left is_registered:false
      // fell straight through and this route rebound it with no ownership proof at all.
      // register.ts refuses on the bound address alone (:99) and is now matched here: a
      // non-empty bound address that is not the session wallet is a refusal unless
      // mayRebindClobberedDevice() proved the caller owns it. Devices owned by nobody are
      // untouched by this -- the `existingAddr &&` short-circuit still lets the 485 docs with
      // is_registered:true and no address, and the 4,891 with neither, be claimed (ARES00
      // census 2026-09-22; the 235 docs in the bound + is_registered:false shape are all
      // genuinely owned: none is in the clobber state, none has a creds.hardware record).
      if (existingAddr && existingAddr !== address && !mayRebind) {
        res.status(409).json(
          createApiError(
            ErrorCodes.ALREADY_REGISTERED,
            'Device linked to a different wallet',
            'This device is already linked to another wallet. Contact support if this is an error.'
          )
        );
        return;
      }
    }
    // RC1-FIX: a rebind is authorised against the clobbered pre-image, so it writes only
    // while that pre-image still stands. Otherwise a concurrent write is silently lost.
    const updateResult = await collection.updateOne(
      mayRebind ? { miner_key: boundKey, address: exists.address } : { miner_key: boundKey },
      {
        $set: {
          is_registered: true,
          names,
          email,
          address,
          ...rebindSet
        }
      }
    );

    if (mayRebind && (updateResult.matchedCount === 0 || updateResult.modifiedCount === 0)) {
      // The pre-image is gone: either another writer took the doc, or an earlier attempt of
      // this same rebind already landed and the client is retrying. Re-read and say which.
      const current = await collection.findOne({ miner_key: boundKey });
      if (!current) {
        res.status(404).json(CommonErrors.deviceNotFound());
        return;
      }
      if ((current.address || '').trim() !== address) {
        loggers.apiError(ENDPOINT, new Error('Clobber rebind lost a race with a concurrent write'), {
          miner_key: boundKey,
          address,
          issueType: 'DEVICE_REBIND_CONFLICT',
          part: 'registrations.create.rebind',
        });
        res.status(409).json(CommonErrors.deviceOwnerMismatch());
        return;
      }
      res.status(200).json({ message: 'ok' });
      return;
    }

    if (updateResult.matchedCount === 0) {
      res.status(404).json(CommonErrors.deviceNotFound());
      return;
    }

    loggers.dbOperation('registration_created', collection.collectionName, {
      miner_key,
      address,
      first_name: firstName,
      last_name: lastName,
      testMode,
    });

    res.status(200).json({ message: 'ok' });
  } catch (error) {
    handleApiError(res, ENDPOINT, error, {
      response: createApiError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to start registration',
        'Please try again or contact support.'
      ),
      minerKey: miner_key,
      walletAddress: sessionAddress,
      issueType: 'DEVICE_REGISTRATION_ERROR',
      part: 'registrations.create.handler',
      metadata: {
        miner_key,
        address,
        email,
        first_name: firstName,
        last_name: lastName,
        testMode,
      },
    });
  }
}

function validateRegistrationPayload(payload: {
  miner_key: string;
  names: { [key: string]: string };
  email: string;
  address: string;
  [key: string]: any;
}): string | null {
  for (const key of Object.keys(payload)) {
    if (key === 'names') {
      const firstName = payload.names?.first_name ?? '';
      const lastName = payload.names?.last_name ?? '';
      let error = validateInput('first_name', firstName);
      if (error) return error;
      error = validateInput('last_name', lastName);
      if (error) return error;
    } else if (key !== 'miner_key' && key !== 'address') {
      const error = validateInput(key, payload[key]);
      if (error) return error;
    }
  }
  return null;
}

const validateInput = (name: string, value: string) => {
  let regex;
  let error = '';
  switch (name) {
    case 'first_name':
    case 'last_name':
      regex = /^[a-zA-Z\ -]+$/;
      error = regex.test(value) ? '' : 'Only alphabets are allowed.';
      break;
    case 'email':
      regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      error = regex.test(value) ? '' : 'Invalid email format.';
      break;
    default:
      error = 'Invalid input';
      break;
  }
  return error;
};
