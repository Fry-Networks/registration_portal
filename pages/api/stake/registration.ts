import type { NextApiRequest, NextApiResponse } from 'next';
import type { UpdateFilter } from 'mongodb';

import clientPromise from '../../../lib/mongoclient';
import { loggers } from '../../../lib/logger';
import { withDeviceActionLock } from '../../../lib/api/deviceAction';
import { createApiError, ErrorCodes, CommonErrors } from '../../../lib/api-errors';
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
  // FIP-013: USD amount at stake time for dynamic peg
  original_usd_amount?: number;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Guard against unsupported verbs – the original handler only accepted POST.
  if (req.method !== 'POST') {
    res.status(405).json(createApiError(ErrorCodes.INVALID_INPUT, 'Unsupported method.'));
    return;
  }

  // Step 2: validate the incoming payload matches what the pre-existing code expected.
  const { txId, address, miner_key: miner, amount, asset_id, original_usd_amount }: RequestBody = req.body ?? {};

  if (!miner || typeof miner !== 'string') {
    res.status(400).json(createApiError(ErrorCodes.INVALID_INPUT, 'Missing miner key for registration stake update.'));
    return;
  }

  const security = await enforceWalletApiSecurity(req, res, {
    endpoint: '/api/stake/registration',
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
    res.status(400).json(createApiError(ErrorCodes.INVALID_INPUT, 'Incomplete registration stake payload.'));
    return;
  }

  // Guard: force the wallet to opt into the registration staking asset before continuing.
  await ensureWalletAssetOptIn(session.user.address, asset_id, 'submitting registration stake');

  void monitorWalletHealth(session.user.address, { minerKey: miner, operation: 'stake:registration' });

  // Step 3: acquire a durable lock + journal entry so duplicate requests safely replay.
  await withDeviceActionLock(req, res, {
    action: 'stake:registration',
    miner_key: miner,
    address,
    metadata: { txId, asset_id, amount, original_usd_amount }
  }, async () => {
    // Step 4: perform the identical lookups + updates that lived in the legacy handler.
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

    const existingWithdrawals = Array.isArray(device.registration?.withdrawals)
      ? device.registration?.withdrawals
      : [];

    // FIP-013: Determine USD amount to store for dynamic peg
    // Priority: request body > product config
    let usdAmountToStore: number | null = null;
    if (typeof original_usd_amount === 'number' && original_usd_amount > 0) {
      usdAmountToStore = original_usd_amount;
    } else if (typeof product.reward?.stake?.register === 'number' && product.reward.stake.register > 0) {
      // Use product's register USD config
      usdAmountToStore = product.reward.stake.register;
      // Apply BYOD discount if applicable
      if (device.byod && device.byod.length > 0) {
        usdAmountToStore = Math.round((usdAmountToStore / 2) * 100) / 100;
      }
    }

    const updateOps: UpdateFilter<Device> = {
      $set: {
        'registration.amount': amount,
        'registration.txId': txId,
        'registration.asset_id': asset_id,
        'registration.time': new Date(),
        'registration.lastWithdrawal': null,
        'registration.withdrawals': existingWithdrawals,
        // FIP-013: Store USD amount for dynamic peg recalculation on withdrawal
        'registration.original_usd_amount': usdAmountToStore
      }
    };

    if (device.registration?.time && device.registration?.txId) {
      const previousStakeRecord = {
        amount: device.registration.amount ?? 0,
        txId: device.registration.txId,
        time: new Date(device.registration.time),
        asset_id: device.registration.asset_id
      };
      updateOps.$push = {
        'registration.history': previousStakeRecord
      } as NonNullable<UpdateFilter<Device>['$push']>;
    }

    const result = await devicesCollection.updateOne({ miner_key: miner }, updateOps);
    if (result.matchedCount === 0) {
      loggers.apiError('/api/stake/registration', new Error('Registration update failed'), {
        miner_key: miner,
        matchedCount: result.matchedCount,
        address,
        txId,
        asset_id,
        amount,
        original_usd_amount: usdAmountToStore,
        issueType: 'REGISTRATION_STAKE_UPDATE_FAILED',
        part: 'registration.dbUpdate'
      });
      throw {
        status: 400,
        response: createApiError(
          ErrorCodes.UPDATE_FAILED,
          'Failed to update registration stake',
          'Please try again. If the problem persists, contact support.',
          { miner_key: miner }
        )
      };
    }

    loggers.stakeOperation('registration_updated', miner, {
      amount,
      txId,
      asset_id,
      original_usd_amount: usdAmountToStore,
      matchedCount: result.matchedCount
    });

    console.log(`[REGISTRATION] ${miner} - ${usdAmountToStore ? `USD peg: $${usdAmountToStore}` : 'legacy FRY'} - amount: ${amount}`);

    // Step 5: respond and annotate the journal with the same metadata observers rely on.
    return {
      response: { success: true, message: 'ok' },
      journal: {
        metadata: {
          amount,
          asset_id,
          txId,
          original_usd_amount: usdAmountToStore
        }
      }
    };
  });
}
