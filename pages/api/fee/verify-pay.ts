import type { NextApiRequest, NextApiResponse } from 'next';

import clientPromise from '../../../lib/mongoclient';
import { verifyTransaction } from '../algorand/verify-txn';
import { VERIFY_RESULT } from '../../../lib/algorand/verification';
import { withDeviceActionLock } from '../../../lib/api/deviceAction';
import { CommonErrors, createApiError, ErrorCodes } from '../../../lib/api-errors';
import { loggers } from '../../../lib/logger';
import { enforceWalletApiSecurity } from '../../../lib/api/enforceWalletSecurity';
import { monitorWalletHealth } from '../../../lib/monitoring/walletHealth';

const TEST_MODE = process.env.NEXT_PUBLIC_TEST_MODE === 'true';

type RequestBody = {
  miner_key?: string;
  txId?: string;
  address?: string;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json(createApiError(ErrorCodes.INVALID_INPUT, 'That request is not available.'));
    return;
  }

  const { miner_key, txId, address }: RequestBody = req.body ?? {};

  if (!miner_key || !txId || !address) {
    res.status(400).json(
      createApiError(
        ErrorCodes.INVALID_INPUT,
        'Missing verification parameters',
        'Please include miner key, wallet address, and transaction id.'
      )
    );
    return;
  }

  const security = await enforceWalletApiSecurity(req, res, {
    endpoint: '/api/fee/verify-pay',
    minerKey: miner_key
  });
  if (!security) {
    return;
  }

  const { session } = security;

  if (address !== session.user.address) {
    loggers.apiError('/api/fee/verify-pay', new Error('Wallet mismatch during fee verify'), {
      sessionAddress: session.user.address,
      address,
      miner_key,
      issueType: 'FEE_VERIFY_WALLET_MISMATCH',
      part: 'fee.verify-pay.auth'
    });
    res.status(401).json(CommonErrors.walletMismatch());
    return;
  }

  void monitorWalletHealth(session.user.address, { minerKey: miner_key, operation: 'fee:verify' });

  await withDeviceActionLock(req, res, {
    action: 'fee:verify',
    miner_key,
    address,
    metadata: { txId }
  }, async () => {
    const checking = await verifyTransaction(address, txId);

    if (checking !== VERIFY_RESULT.OK) {
      throw {
        status: 500,
        response: createApiError(
          ErrorCodes.TRANSACTION_FAILED,
          'Failed to verify withdrawal transaction',
          'Please wait a moment and try again.'
        )
      };
    }

    const client = await clientPromise;
    const db = client.db('main');
    const devicesCollection = db.collection(TEST_MODE ? 'test-devices' : 'devices');
    await devicesCollection.updateOne(
      { miner_key, address: session.user.address },
      {
        $set: {
          'staked.withdraw_boost': true
        }
      }
    );

    return {
      response: { message: 'ok' },
      journal: {
        status: 'confirmed',
        metadata: { txId }
      }
    };
  });
}
