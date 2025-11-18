'use server';

import type { NextApiRequest, NextApiResponse } from 'next';
import type { Transaction } from 'algosdk';
import type { UpdateFilter } from 'mongodb';

import clientPromise from '../../../lib/mongoclient';
import { withDeviceActionLock } from '../../../lib/api/deviceAction';
import { createApiError, ErrorCodes } from '../../../lib/api-errors';
import { loggers } from '../../../lib/logger';
import { Device, Product } from '../../../lib/types';
import { verifyTransaction } from '../algorand/verify-txn';
import { VERIFY_RESULT } from '../../../lib/algorand/verification';
// Modern wallet infrastructure imports for consistent network handling
import { getAlgodClient, getIndexerClient } from '../../../lib/wallet/clients';
import { buildAssetTransferTxn } from '../../../lib/wallet/transactions';
import {
  decodeUnsignedTransaction,
  loadMnemonicAccountPair,
  signAndSubmitCustodialTransactions
} from '../../../lib/algorand/admin';
import { tFRY } from '../../../lib/utils';
import { enforceWalletApiSecurity } from '../../../lib/api/enforceWalletSecurity';
import { monitorWalletHealth } from '../../../lib/monitoring/walletHealth';
import { monitorTransaction } from '../../../lib/monitoring/transactionMonitor';
import { ensureWalletAssetOptIn } from '../../../lib/algorand/optIn';

const TEST_MODE = process.env.NEXT_PUBLIC_TEST_MODE === 'true';

type RequestBody = {
  address?: string;
  miner_key?: string;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Keep the POST-only contract of the legacy implementation.
  if (req.method !== 'POST') {
    res.status(405).json(createApiError(ErrorCodes.INVALID_INPUT, 'Unsupported method.'));
    return;
  }

  // Validate payload fields expected by the existing front-end.
  const { address, miner_key: miner }: RequestBody = req.body ?? {};
  if (!miner || typeof miner !== 'string') {
    res.status(400).json(createApiError(ErrorCodes.INVALID_INPUT, 'Missing miner key for registration stake withdrawal.'));
    return;
  }

  const security = await enforceWalletApiSecurity(req, res, {
    endpoint: '/api/stake/r-withdraw',
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

  void monitorWalletHealth(session.user.address, { minerKey: miner, operation: 'withdraw:registration' });

  // Guard the critical section with the shared lock/journal helper.
  await withDeviceActionLock(req, res, {
    action: 'withdraw:registration',
    miner_key: miner,
    address,
    metadata: { stage: 'init' }
  }, async () => {
    // Step 1: load the device & product records exactly as before.
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

    if (!device.registration) {
      throw {
        status: 401,
        response: createApiError(ErrorCodes.UNAUTHORIZED, 'Registration stake not found for this device.')
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

    const amount = device.registration.amount;
    if (!amount) {
      throw {
        status: 400,
        response: createApiError(ErrorCodes.INVALID_INPUT, 'No registration stake is currently locked for this device.')
      };
    }

    const assetId = device.registration.asset_id ?? product.reward.tokens?.register ?? tFRY.id;

    // Step 2: broadcast the same Algorand withdrawal transaction as before.
    // Guard: require registration wallet opt-in before we send the asset back.
    await ensureWalletAssetOptIn(address, assetId, 'receiving registration stake withdrawal');

    const txId = await withdraw(miner, address, amount, assetId);
    if (!txId) {
      throw {
        status: 500,
        response: createApiError(
          ErrorCodes.TRANSACTION_FAILED,
          'Unable to withdraw registration stake',
          'Please try again. If this persists, contact support.'
        )
      };
    }

    // Step 3: persist withdrawal history / clear active stake fields.
    const withdrawalRecord = {
      amount,
      txId,
      time: new Date(),
      asset_id: assetId
    };

    const previousStakeRecord =
      device.registration.time && device.registration.txId
        ? {
            amount,
            txId: device.registration.txId,
            time: new Date(device.registration.time),
            asset_id: device.registration.asset_id
          }
        : null;

    const updateOps: UpdateFilter<Device> = {
      $set: {
        'registration.amount': null,
        'registration.txId': null,
        'registration.time': null,
        'registration.asset_id': null,
        'registration.lastWithdrawal': withdrawalRecord
      },
      $push: {
        'registration.withdrawals': withdrawalRecord
      }
    };

    if (previousStakeRecord) {
      updateOps.$push = {
        ...updateOps.$push,
        'registration.history': previousStakeRecord
      } as NonNullable<UpdateFilter<Device>['$push']>;
    }

    await devicesCollection.updateOne({ miner_key: miner }, updateOps);

    loggers.stakeOperation('registration_withdraw_completed', miner, {
      txId,
      amount,
      assetId
    });

    void monitorTransaction(txId, {
      minerKey: miner,
      walletAddress: address,
      operation: 'withdraw:registration',
      amount,
      assetId,
      preconfirmed: true
    });

    return {
      response: { message: 'ok', txId },
      journal: {
        txId,
        metadata: {
          amount,
          assetId
        }
      }
    };
  });
}

/**
 * Modern registration withdrawal helper using centralized wallet infrastructure.
 * 
 * This modernizes the legacy algosdk patterns with our lib/wallet/ approach:
 * - Uses getAlgodClient() and getIndexerClient() for consistent network configuration  
 * - Uses buildAssetTransferTxn() for standardized transaction building
 * - Maintains the same verification flow: confirm + verify + indexer lookup
 * - Includes comprehensive Discord error logging via loggers.apiError
 * - Preserves the exact amount conversion logic (amount * 1_000_000)
 */
export async function withdraw(
  miner_key: string,
  address: string,
  amount: number,
  asset_id: string
) {
  try {
    // Use modern wallet infrastructure for consistent network configuration
    const algodClient = getAlgodClient();
    const indexer = getIndexerClient();
    // Resolve the staking vault + signer once so every withdrawal shares logic.
    const { account } = loadMnemonicAccountPair({
      mnemonicEnv: 'STAKE_MNEMONIC',
      rekeyEnv: 'STAKE_REKEY',
      label: 'registration stake withdraw'
    });

    const from = account.addr.toString();
    const assetId = asset_id === 'none' ? 0 : Number(asset_id);

    // Build transaction note with operation context for registration withdrawal
    const noteInformation = {
      miner_key: `${miner_key.split('-')[0]}-${miner_key.split('-')[1].slice(0, 6)}`,
      asset_id,
      from,
      to: address,
      amount,
      operation: 'registration_stake_withdrawal',
      timestamp: new Date().toISOString()
    };

    const note = new TextEncoder().encode(JSON.stringify(noteInformation));

    // Use modern transaction builder with consistent decimal handling
    const encodedTxn = await buildAssetTransferTxn({
      sender: from,
      receiver: address,
      assetId,
      amount: TEST_MODE ? 0 : amount, // buildAssetTransferTxn handles decimal conversion properly
      note,
      useRawAmount: TEST_MODE, // In test mode, send raw amount without conversion  
      decimals: 6 // fNODE and other staking tokens use 6 decimals
    });

    // Sign with the rekey account via shared helper (maintains existing security model)
    const transaction: Transaction = decodeUnsignedTransaction(encodedTxn);
    // Submit the single withdrawal via the unified custodial signing helper.
    const { txId } = await signAndSubmitCustodialTransactions({
      mnemonicEnv: 'STAKE_MNEMONIC',
      rekeyEnv: 'STAKE_REKEY',
      label: 'registration stake withdraw',
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

    // Additional indexer lookup for transaction finalization (legacy behavior preserved)
    await indexer.lookupTransactionByID(txId).do().catch(() => undefined);
    
    return txId;
  } catch (error) {
    // Comprehensive error logging with Discord webhook notification
    loggers.apiError('/api/stake/r-withdraw#withdraw', error, {
      miner_key,
      walletAddress: address,
      asset_id,
      amount,
      issueType: 'REGISTRATION_STAKE_WITHDRAW_ERROR',
      part: 'withdraw.modernBroadcast',
      metadata: {
        testMode: TEST_MODE,
        errorType: error instanceof Error ? error.constructor.name : 'Unknown'
      }
    });
    return null;
  }
}
