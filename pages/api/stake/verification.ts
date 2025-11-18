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
  type?: string;
  address?: string;
  miner_key?: string;
  amount?: number;
  asset_id?: string;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Maintain the POST-only contract of the previous implementation.
  if (req.method !== 'POST') {
    res.status(405).json(createApiError(ErrorCodes.INVALID_INPUT, 'Unsupported method.'));
    return;
  }

  // Ensure the request payload still supplies the same staking fields.
  const { txId, address, miner_key: miner, amount, asset_id, type }: RequestBody = req.body ?? {};

  if (!miner || typeof miner !== 'string') {
    res.status(400).json(createApiError(ErrorCodes.INVALID_INPUT, 'Missing miner key for verification stake update.'));
    return;
  }

  const security = await enforceWalletApiSecurity(req, res, {
    endpoint: '/api/stake/verification',
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

  if (
    typeof txId !== 'string' || txId.length === 0 ||
    typeof type !== 'string' || type.length === 0 ||
    typeof asset_id !== 'string' ||
    typeof amount !== 'number'
  ) {
    res.status(400).json(createApiError(ErrorCodes.INVALID_INPUT, 'Incomplete verification stake payload.'));
    return;
  }

  // Guard: refuse to process staking if the wallet has not opted into the staking asset.
  await ensureWalletAssetOptIn(session.user.address, asset_id, 'submitting verification stake');

  void monitorWalletHealth(session.user.address, { minerKey: miner, operation: 'stake:verification' });

  // Lock + journal the operation so duplicate POSTs remain safe.
  await withDeviceActionLock(req, res, {
    action: 'stake:verification',
    miner_key: miner,
    address,
    metadata: { txId, asset_id, amount, type }
  }, async () => {
    // Carry out the same product/device lookups that previously lived in-line.
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

    const existingWithdrawals = Array.isArray(device.staked?.withdrawals)
      ? device.staked.withdrawals
      : [];

    const updateOps: UpdateFilter<Device> = {
      $set: {
        verified: true,
        'staked.type': type,
        'staked.amount': amount,
        'staked.txId': txId,
        'staked.asset_id': asset_id,
        'staked.time': new Date(),
        'staked.lastWithdrawal': null,
        'staked.withdrawals': existingWithdrawals,
        legacy_stake_unlocked: false
      }
    };

    if (device.staked?.time && device.staked?.txId) {
      const previousStakeRecord = {
        amount: device.staked.amount ?? 0,
        txId: device.staked.txId,
        time: new Date(device.staked.time),
        asset_id: device.staked.asset_id,
        type: device.staked.type
      };
      updateOps.$push = {
        'staked.history': previousStakeRecord
      } as NonNullable<UpdateFilter<Device>['$push']>;
    }

    const result = await devicesCollection.updateOne({ miner_key: miner }, updateOps);
    if (result.matchedCount === 0) {
      loggers.apiError('/api/stake/verification', new Error('Stake verification update failed'), {
        miner_key: miner,
        matchedCount: result.matchedCount,
        address,
        txId,
        asset_id,
        amount,
        type,
        issueType: 'VERIFICATION_STAKE_UPDATE_FAILED',
        part: 'verification.dbUpdate'
      });
      throw {
        status: 400,
        response: createApiError(
          ErrorCodes.UPDATE_FAILED,
          'Failed to update stake verification',
          'Please try again. If the problem persists, contact support.',
          { miner_key: miner }
        )
      };
    }

    loggers.stakeOperation('stake_verification_completed', miner, {
      txId,
      amount,
      asset_id,
      type,
      matchedCount: result.matchedCount
    });

    // Return both the API response and the metadata recorded in the journal.
    return {
      response: { success: true, message: 'ok' },
      journal: {
        metadata: {
          amount,
          asset_id,
          txId,
          type
        }
      }
    };
  });
}
