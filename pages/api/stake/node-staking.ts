import type { NextApiRequest, NextApiResponse } from 'next';
import type { UpdateFilter } from 'mongodb';

import clientPromise from '../../../lib/mongoclient';
import { withDeviceActionLock } from '../../../lib/api/deviceAction';
import { createApiError, ErrorCodes, CommonErrors } from '../../../lib/api-errors';
import { loggers } from '../../../lib/logger';
import type { Device, Product } from '../../../lib/types';
import { enforceWalletApiSecurity } from '../../../lib/api/enforceWalletSecurity';
import { ensureWalletAssetOptIn } from '../../../lib/algorand/optIn';
import { monitorWalletHealth } from '../../../lib/monitoring/walletHealth';

const TEST_MODE = process.env.NEXT_PUBLIC_TEST_MODE === 'true';

type RequestBody = {
  txId?: string;
  address?: string;
  miner_key?: string;
  amount?: number;
  asset_id?: string;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Enforce the same method contract as before – only POST is allowed.
  if (req.method !== 'POST') {
    res.status(405).json(createApiError(ErrorCodes.INVALID_INPUT, 'Unsupported method.'));
    return;
  }

  // Validate request body fields exactly as the legacy code required.
  const { txId, address, miner_key: miner, amount, asset_id }: RequestBody = req.body ?? {};

  if (!miner || typeof miner !== 'string') {
    res.status(400).json(createApiError(ErrorCodes.INVALID_INPUT, 'Missing miner key for node stake update.'));
    return;
  }

  const security = await enforceWalletApiSecurity(req, res, {
    endpoint: '/api/stake/node-staking',
    minerKey: miner
  });
  if (!security) {
    return;
  }

  const { session } = security;

  if (!address || session.user.address !== address) {
    res.status(401).json(CommonErrors.walletMismatch());
    return;
  }

  if (typeof txId !== 'string' || txId.length === 0 || typeof asset_id !== 'string' || typeof amount !== 'number') {
    res.status(400).json(createApiError(ErrorCodes.INVALID_INPUT, 'Incomplete node stake payload.'));
    return;
  }

  // Guard: make sure the wallet is opted into the node staking asset before we record it.
  await ensureWalletAssetOptIn(session.user.address, asset_id, 'submitting node stake');

  void monitorWalletHealth(session.user.address, { minerKey: miner, operation: 'stake:node' });

  // Use the shared lock/journal helper so concurrent updates stay idempotent.
  await withDeviceActionLock(req, res, {
    action: 'stake:node',
    miner_key: miner,
    address,
    metadata: { txId, asset_id, amount }
  }, async () => {
    // Fetch product + device and perform the same Mongo update the old handler did.
    const client = await clientPromise;
    const db = client.db('main');

    const product = (await db
      .collection('products')
      .findOne({ key: miner.split('-')[0] })) as Product | null;
    if (!product) {
      throw {
        status: 404,
        response: CommonErrors.productNotFound()
      };
    }

    const devicesCollection = db.collection<Device>(TEST_MODE ? 'test-devices' : 'devices');
    const device = await devicesCollection.findOne({ miner_key: miner });
    if (!device) {
      throw {
        status: 404,
        response: CommonErrors.deviceNotFound()
      };
    }

    const existingWithdrawals = Array.isArray(device.node?.withdrawals)
      ? device.node.withdrawals
      : [];

    const updateOps: UpdateFilter<Device> = {
      $set: {
        'node.amount': amount,
        'node.txId': txId,
        'node.asset_id': asset_id,
        'node.time': new Date(),
        'node.lastWithdrawal': null,
        'node.withdrawals': existingWithdrawals
      }
    };

    if (device.node?.time && device.node?.txId) {
      const previousStakeRecord = {
        amount: device.node.amount ?? 0,
        txId: device.node.txId,
        time: new Date(device.node.time),
        asset_id: device.node.asset_id
      };
      updateOps.$push = {
        'node.history': previousStakeRecord
      } as NonNullable<UpdateFilter<Device>['$push']>;
    }

    const result = await devicesCollection.updateOne({ miner_key: miner }, updateOps);
    if (result.matchedCount === 0) {
      loggers.apiError('/api/stake/node-staking', new Error('Node stake update failed'), {
        miner_key: miner,
        matchedCount: result.matchedCount,
        address,
        txId,
        asset_id,
        amount,
        issueType: 'NODE_STAKE_UPDATE_FAILED',
        part: 'node.dbUpdate'
      });
      throw {
        status: 400,
        response: createApiError(
          ErrorCodes.UPDATE_FAILED,
          'Failed to update node operation stake',
          'Please try again. If the problem persists, contact support.',
          { miner_key: miner }
        )
      };
    }

    loggers.stakeOperation('node_stake_updated', miner, {
      amount,
      txId,
      asset_id,
      matchedCount: result.matchedCount
    });

    // Bubble the metadata back to the journal/response for downstream consumers.
    return {
      response: { success: true, message: 'ok' },
      journal: {
        metadata: {
          amount,
          asset_id,
          txId
        }
      }
    };
  });
}
