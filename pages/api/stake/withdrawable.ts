import type { NextApiRequest, NextApiResponse } from 'next';

import clientPromise from '../../../lib/mongoclient';
import { withDeviceActionLock } from '../../../lib/api/deviceAction';
import { createApiError, ErrorCodes } from '../../../lib/api-errors';
import { Device, Product } from '../../../lib/types';
import { enforceWalletApiSecurity } from '../../../lib/api/enforceWalletSecurity';
import { monitorWalletHealth } from '../../../lib/monitoring/walletHealth';
import { isLegacyVerificationStake } from '../../../lib/legacyStake';

const TEST_MODE = process.env.NEXT_PUBLIC_TEST_MODE === 'true';
const DEV_MODE = process.env.NEXT_PUBLIC_DEV_MODE === 'true';

type RequestBody = {
  address?: string;
  miner_key?: string;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.status(405).json(createApiError(ErrorCodes.INVALID_INPUT, 'Unsupported method.'));
    return;
  }

  const { address, miner_key: miner }: RequestBody = req.body ?? {};
  if (!miner || typeof miner !== 'string') {
    res.status(400).json(createApiError(ErrorCodes.INVALID_INPUT, 'Missing miner key for withdraw availability check.'));
    return;
  }

  const security = await enforceWalletApiSecurity(req, res, {
    endpoint: '/api/stake/withdrawable',
    minerKey: miner
  });
  if (!security) {
    return;
  }

  const { session } = security;

  if (!address || address !== session.user.address) {
    res.status(401).json(createApiError(ErrorCodes.WALLET_MISMATCH, 'Wallet mismatch detected.'));
    return;
  }

  void monitorWalletHealth(session.user.address, { minerKey: miner, operation: 'withdraw:verification_check' });

  await withDeviceActionLock(req, res, {
    action: 'withdraw:verification_check',
    miner_key: miner,
    address,
    metadata: { stage: 'check' }
  }, async () => {
    const client = await clientPromise;
    const db = client.db('main');
    const devicesCollection = db.collection<Device>(TEST_MODE ? 'test-devices' : 'devices');

    const device = await devicesCollection.findOne({ miner_key: miner });
    if (!device) {
      throw {
        status: 404,
        response: createApiError(ErrorCodes.DEVICE_NOT_FOUND, 'Device not found', 'Verify the miner key and try again.')
      };
    }

    if (!device.staked) {
      throw {
        status: 401,
        response: createApiError(ErrorCodes.UNAUTHORIZED, 'Verification stake not found for this device.')
      };
    }

    if (!device.address || device.address !== session.user.address) {
      throw {
        status: 401,
        response: createApiError(ErrorCodes.WALLET_MISMATCH, 'Wallet mismatch detected.')
      };
    }

    const product = (await db
      .collection('products')
      .findOne({ key: device.miner_key.split('-')[0] })) as Product | null;
    if (!product) {
      throw {
        status: 404,
        response: createApiError(ErrorCodes.PRODUCT_NOT_FOUND, 'Product configuration not found for this device.')
      };
    }

    const stakeTime = device.staked.time ? new Date(device.staked.time).getTime() : 0;
    const now = Date.now();
    const oneDayMs = 24 * 60 * 60 * 1000;
    const sixMonthsMs = 180 * oneDayMs;

    const dayCheck = stakeTime ? now - stakeTime > oneDayMs : false;
    const sixMonthsCheck = stakeTime ? now - stakeTime > sixMonthsMs : false;

    const available =
      DEV_MODE || device.staked.asset_id !== product.reward.tokens?.stake
        ? true
        : device.staked.type === 'one'
          ? dayCheck
          : sixMonthsCheck;

    const availableIn = device.staked.type === 'one'
      ? stakeTime + oneDayMs
      : stakeTime + sixMonthsMs;

    const legacyStake = isLegacyVerificationStake(device);
    const payload = legacyStake
      ? {
          available: true,
          availableIn: Date.now(),
          legacy: true
        }
      : {
          available,
          availableIn,
          legacy: false
        };

    return {
      response: { message: 'ok', data: payload },
      journal: {
        metadata: payload,
        status: 'confirmed'
      }
    };
  });
}
