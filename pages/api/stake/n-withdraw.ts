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
import { fNODE } from '../../../lib/utils';
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
  if (req.method !== 'POST') {
    res.status(405).json(createApiError(ErrorCodes.INVALID_INPUT, 'Unsupported method.'));
    return;
  }

  const { address, miner_key: miner }: RequestBody = req.body ?? {};
  if (!miner || typeof miner !== 'string') {
    res.status(400).json(createApiError(ErrorCodes.INVALID_INPUT, 'Missing miner key for node stake withdrawal.'));
    return;
  }

  const security = await enforceWalletApiSecurity(req, res, {
    endpoint: '/api/stake/n-withdraw',
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

  void monitorWalletHealth(session.user.address, { minerKey: miner, operation: 'withdraw:node' });

  await withDeviceActionLock(req, res, {
    action: 'withdraw:node',
    miner_key: miner,
    address,
    metadata: { stage: 'init' }
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

    if (!device.node) {
      throw {
        status: 401,
        response: createApiError(ErrorCodes.UNAUTHORIZED, 'Node stake not found for this device.')
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

    const amount = device.node.amount;
    if (!amount) {
      throw {
        status: 400,
        response: createApiError(ErrorCodes.INVALID_INPUT, 'No node stake is currently locked for this device.')
      };
    }

    const assetId = device.node.asset_id ?? product.reward.tokens?.node ?? fNODE.id;
    // Guard: ensure the wallet can actually receive the node stake asset before sending.
    await ensureWalletAssetOptIn(address, assetId, 'receiving node stake withdrawal');

    const txId = await withdraw(miner, address, amount, assetId);
    if (!txId) {
      throw {
        status: 500,
        response: createApiError(
          ErrorCodes.TRANSACTION_FAILED,
          'Unable to withdraw node stake',
          'Please try again. If this persists, contact support.'
        )
      };
    }

    const withdrawalRecord = {
      amount,
      txId,
      time: new Date(),
      asset_id: assetId
    };

    const previousStakeRecord =
      device.node.time && device.node.txId
        ? {
            amount,
            txId: device.node.txId,
            time: new Date(device.node.time),
            asset_id: device.node.asset_id
          }
        : null;

    const updateOps: UpdateFilter<Device> = {
      $set: {
        'node.amount': null,
        'node.txId': null,
        'node.time': null,
        'node.asset_id': null,
        'node.lastWithdrawal': withdrawalRecord
      },
      $push: {
        'node.withdrawals': withdrawalRecord
      }
    };

    if (previousStakeRecord) {
      updateOps.$push = {
        ...updateOps.$push,
        'node.history': previousStakeRecord
      } as NonNullable<UpdateFilter<Device>['$push']>;
    }

    await devicesCollection.updateOne({ miner_key: miner }, updateOps);

    loggers.stakeOperation('node_withdraw_completed', miner, {
      txId,
      amount,
      assetId
    });

    void monitorTransaction(txId, {
      minerKey: miner,
      walletAddress: address,
      operation: 'withdraw:node',
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
 * Modern node withdrawal helper using centralized wallet infrastructure.
 * 
 * This modernizes the legacy algosdk patterns with our lib/wallet/ approach:
 * - Uses getAlgodClient() and getIndexerClient() for consistent network configuration  
 * - Uses buildAssetTransferTxn() for standardized transaction building (no manual assetIndex/suggestedParams)
 * - Maintains the same verification flow: confirm + verify + indexer lookup
 * - Includes comprehensive Discord error logging via loggers.apiError
 * - Preserves the exact amount conversion logic and security model
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
    // Resolve staking vault/signing pair for node withdrawals.
    const { account } = loadMnemonicAccountPair({
      mnemonicEnv: 'STAKE_MNEMONIC',
      rekeyEnv: 'STAKE_REKEY',
      label: 'node stake withdraw'
    });

    const from = account.addr.toString();
    const assetId = asset_id === 'none' ? 0 : Number(asset_id);

    // Build transaction note with operation context for node withdrawal
    const noteInformation = {
      miner_key: `${miner_key.split('-')[0]}-${miner_key.split('-')[1].slice(0, 6)}`,
      asset_id,
      from,
      to: address,
      amount,
      operation: 'node_stake_withdrawal',
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
      decimals: 6 // fNODE and other node staking tokens use 6 decimals
    });

    // Sign with the rekey account via shared helper (maintains existing security model)
    const transaction: Transaction = decodeUnsignedTransaction(encodedTxn);
    const { txId } = await signAndSubmitCustodialTransactions({
    // Reuse shared custodial pipeline for the broadcast + confirmation wait.
      mnemonicEnv: 'STAKE_MNEMONIC',
      rekeyEnv: 'STAKE_REKEY',
      label: 'node stake withdraw',
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
    loggers.apiError('/api/stake/n-withdraw#withdraw', error, {
      miner_key,
      walletAddress: address,
      asset_id,
      amount,
      issueType: 'NODE_STAKE_WITHDRAW_ERROR',
      part: 'withdraw.modernBroadcast',
      metadata: {
        testMode: TEST_MODE,
        errorType: error instanceof Error ? error.constructor.name : 'Unknown'
      }
    });
    return null;
  }
}
