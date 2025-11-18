'use server';

import type { NextApiRequest, NextApiResponse } from 'next';
import type { Transaction } from 'algosdk';
import type { UpdateFilter } from 'mongodb';

import clientPromise from '../../../lib/mongoclient';
import { withDeviceActionLock } from '../../../lib/api/deviceAction';
import { createApiError, ErrorCodes } from '../../../lib/api-errors';
import { loggers } from '../../../lib/logger';
import { Device, Product } from '../../../lib/types';
import { VERIFY_RESULT } from '../../../lib/algorand/verification';
import { verifyTransaction } from '../algorand/verify-txn';
// Modern wallet infrastructure imports
import { getAlgodClient } from '../../../lib/wallet/clients';
import { buildAssetTransferTxn } from '../../../lib/wallet/transactions';
import {
  decodeUnsignedTransaction,
  loadMnemonicAccountPair,
  signAndSubmitCustodialTransactions
} from '../../../lib/algorand/admin';
import { getLegacyStakeAssetId, isLegacyVerificationStake } from '../../../lib/legacyStake';
import { enforceWalletApiSecurity } from '../../../lib/api/enforceWalletSecurity';
import { monitorWalletHealth } from '../../../lib/monitoring/walletHealth';
import { monitorTransaction } from '../../../lib/monitoring/transactionMonitor';
import { ensureWalletAssetOptIn } from '../../../lib/algorand/optIn';

const TEST_MODE = process.env.NEXT_PUBLIC_TEST_MODE === 'true';
const DEV_MODE = process.env.NEXT_PUBLIC_DEV_MODE === 'true';

type RequestBody = {
  address?: string;
  miner_key?: string;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Enforce POST-only behaviour exactly as before.
  if (req.method !== 'POST') {
    res.status(405).json(createApiError(ErrorCodes.INVALID_INPUT, 'Unsupported method.'));
    return;
  }

  // Validate the request body – the legacy endpoint expected just miner/address.
  const { address, miner_key: miner }: RequestBody = req.body ?? {};

  if (!miner || typeof miner !== 'string') {
    res.status(400).json(createApiError(ErrorCodes.INVALID_INPUT, 'Missing miner key for verification stake withdrawal.'));
    return;
  }

  const security = await enforceWalletApiSecurity(req, res, {
    endpoint: '/api/stake/stake-withdraw',
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

  void monitorWalletHealth(session.user.address, { minerKey: miner, operation: 'withdraw:verification' });

  // Acquire a durable lock so concurrent withdraw requests idempotently resolve.
  await withDeviceActionLock(req, res, {
    action: 'withdraw:verification',
    miner_key: miner,
    address,
    metadata: { stage: 'init' }
  }, async () => {
    // Fetch device/product and reuse the exact checks from the prior implementation.
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
        response: createApiError(ErrorCodes.UNAUTHORIZED, 'Stake record not found for this device.')
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

    const type = device.staked.type;
    const legacyStake = isLegacyVerificationStake(device);
    let assetId = device.staked.asset_id;
    const amount = device.staked.amount;

    if ((!assetId || assetId === 'none') && legacyStake) {
      const legacyAssetId = getLegacyStakeAssetId(device);
      if (legacyAssetId) {
        assetId = legacyAssetId;
      }
    }

    if (!assetId || !amount) {
      throw {
        status: 400,
        response: createApiError(ErrorCodes.INVALID_INPUT, 'Stake record is incomplete or already withdrawn.')
      };
    }

    const lockExpired =
      DEV_MODE ||
      legacyStake ||
      assetId !== product.reward.tokens?.stake ||
      (device.staked.time && type === 'one'
        ? (Date.now() - new Date(device.staked.time).getTime()) / (1000 * 60 * 60 * 24) > 1
        : device.staked.time && (Date.now() - new Date(device.staked.time).getTime()) / (1000 * 60 * 60 * 24) > 180);

    if (!lockExpired) {
      throw {
        status: 401,
        response: createApiError(ErrorCodes.UNAUTHORIZED, 'Stake lock period has not elapsed.')
      };
    }

    // Guard: refuse to broadcast the withdrawal if the user wallet cannot receive the asset yet.
    await ensureWalletAssetOptIn(address, assetId, 'receiving verification stake withdrawal');

    const txId = await withdraw(miner, address, amount, assetId);
    if (!txId) {
      throw new Error('Unable to broadcast withdrawal transaction.');
    }

    const withdrawalRecord = {
      amount,
      txId,
      time: new Date(),
      asset_id: assetId,
      type
    };

    const previousStakeRecord =
      device.staked.time && device.staked.txId
        ? {
            amount,
            txId: device.staked.txId,
            time: new Date(device.staked.time),
            asset_id: assetId,
            type
          }
        : null;

    const updateOps: UpdateFilter<Device> = {
      $set: {
        'staked.amount': null,
        'staked.txId': null,
        'staked.time': null,
        'staked.type': null,
        'staked.asset_id': null,
        'staked.lastWithdrawal': withdrawalRecord,
        verified: false
      },
      $push: {
        'staked.withdrawals': withdrawalRecord
      }
    };

    if (previousStakeRecord) {
      updateOps.$push = {
        ...updateOps.$push,
        'staked.history': previousStakeRecord
      } as NonNullable<UpdateFilter<Device>['$push']>;
    }

    updateOps.$set = {
      ...updateOps.$set,
      legacy_stake_unlocked: false
    };

    await devicesCollection.updateOne({ miner_key: miner }, updateOps);

    loggers.stakeOperation('stake_withdraw_completed', miner, {
      txId,
      amount,
      assetId,
      type
    });

    void monitorTransaction(txId, {
      minerKey: miner,
      walletAddress: address,
      operation: 'stake_withdraw',
      amount,
      assetId,
      preconfirmed: true
    });

    // Surface the txId both in the response payload and the journal metadata.
    return {
      response: { message: 'ok', txId },
      journal: {
        txId,
        metadata: {
          amount,
          assetId,
          type
        }
      }
    };
  });
}

/**
 * Modern withdrawal helper using centralized wallet infrastructure.
 * 
 * This replaces the legacy algosdk patterns with our modern lib/wallet/ approach:
 * - Uses getAlgodClient() for consistent network configuration  
 * - Uses buildAssetTransferTxn() for standardized transaction building
 * - Maintains the same verification and error handling as before
 * - Includes comprehensive Discord error logging via loggers.apiError
 */
export async function withdraw(
  miner_key: string,
  address: string,
  amount: number,
  asset_id: string
) {
  try {
    // Use modern wallet infrastructure for network clients
    const algodClient = getAlgodClient();
    // Load the verification staking vault + signer via the shared helper.
    const { account } = loadMnemonicAccountPair({
      mnemonicEnv: 'STAKE_MNEMONIC',
      rekeyEnv: 'STAKE_REKEY',
      label: 'verification stake withdraw'
    });

    const from = account.addr.toString();
    const assetId = asset_id === 'none' ? 0 : Number(asset_id);

    // Build transaction note with operation context
    const noteInformation = {
      miner_key: `${miner_key.split('-')[0]}-${miner_key.split('-')[1].slice(0, 6)}`,
      asset_id,
      from,
      to: address,
      amount,
      operation: 'verification_stake_withdrawal',
      timestamp: new Date().toISOString()
    };

    const note = new TextEncoder().encode(JSON.stringify(noteInformation));

    // Use modern transaction builder for consistent handling
    const encodedTxn = await buildAssetTransferTxn({
      sender: from,
      receiver: address,
      assetId,
      amount: TEST_MODE ? 0 : amount, // buildAssetTransferTxn handles decimal conversion
      note,
      useRawAmount: TEST_MODE, // In test mode, send raw amount without conversion
      decimals: 6 // FRY tokens use 6 decimals
    });

    // Sign with the rekey account via shared helper (maintains existing security model)
    const transaction: Transaction = decodeUnsignedTransaction(encodedTxn);
    // Broadcast with the shared custodial flow so retries stay idempotent.
    const { txId } = await signAndSubmitCustodialTransactions({
      mnemonicEnv: 'STAKE_MNEMONIC',
      rekeyEnv: 'STAKE_REKEY',
      label: 'verification stake withdraw',
      algod: algodClient,
      transactions: [transaction],
      assignGroupId: false,
      waitRounds: 4
    });
    
    // Double-check transaction success via existing verification logic
    const verified = await verifyTransaction(address, txId);
    if (verified !== VERIFY_RESULT.OK) {
      throw new Error('Transaction verification failed after blockchain confirmation');
    }

    return txId;
  } catch (error) {
    // Comprehensive error logging with Discord webhook notification
    loggers.apiError('/api/stake/verification-withdraw', error, {
      miner_key,
      walletAddress: address,
      asset_id,
      amount,
      issueType: 'VERIFICATION_STAKE_WITHDRAW_ERROR',
      part: 'withdraw.modernBroadcast',
      metadata: {
        testMode: TEST_MODE,
        errorType: error instanceof Error ? error.constructor.name : 'Unknown'
      }
    });
    return null;
  }
}
