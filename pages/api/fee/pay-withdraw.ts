import type { NextApiRequest, NextApiResponse } from 'next';

import clientPromise from '../../../lib/mongoclient';
import { verifyTransaction } from '../algorand/verify-txn';
import { VERIFY_RESULT } from '../../../lib/algorand/verification';
import { withDeviceActionLock } from '../../../lib/api/deviceAction';
import { CommonErrors, createApiError, ErrorCodes } from '../../../lib/api-errors';
import { loggers } from '../../../lib/logger';
import { getAlgodClient } from '../../../lib/wallet/clients';
import { buildAssetTransferTxn } from '../../../lib/wallet/transactions';
import {
  decodeUnsignedTransaction,
  loadMnemonicAccountPair,
  signAndSubmitCustodialTransactions
} from '../../../lib/algorand/admin';
import { enforceWalletApiSecurity } from '../../../lib/api/enforceWalletSecurity';
import { monitorWalletHealth } from '../../../lib/monitoring/walletHealth';
import { monitorTransaction } from '../../../lib/monitoring/transactionMonitor';
import { ensureWalletAssetOptIn } from '../../../lib/algorand/optIn';

const TEST_MODE = process.env.NEXT_PUBLIC_TEST_MODE === 'true';

type RequestBody = {
  miner_key?: string;
  asset_id?: string;
  from?: string;
  to?: string;
  amount?: number;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json(createApiError(ErrorCodes.INVALID_INPUT, 'That request is not available.'));
    return;
  }

  const { miner_key, asset_id, from: requestedFrom, to, amount }: RequestBody = req.body ?? {};
  const minerKey = miner_key;

  if (!miner_key || !asset_id || !to || typeof amount !== 'number' || Number.isNaN(amount)) {
    res.status(400).json(
      createApiError(
        ErrorCodes.INVALID_INPUT,
        'Missing withdrawal parameters',
        'Please supply miner key, asset id, destination address, and amount.'
      )
    );
    return;
  }

  if (amount <= 0) {
    res.status(400).json(
      createApiError(
        ErrorCodes.INVALID_INPUT,
        'Withdrawal amount must be greater than zero',
        'Adjust the amount and try again.'
      )
    );
    return;
  }

  const security = await enforceWalletApiSecurity(req, res, {
    endpoint: '/api/fee/pay-withdraw',
    minerKey
  });
  if (!security) {
    return;
  }

  const { session } = security;
  const walletAddress = session.user.address;

  if (requestedFrom && requestedFrom !== walletAddress) {
    loggers.apiError('/api/fee/pay-withdraw', new Error('Wallet mismatch during fee withdrawal'), {
      sessionAddress: walletAddress,
      requestedFrom,
      miner_key,
      issueType: 'FEE_WITHDRAW_WALLET_MISMATCH',
      part: 'fee.pay-withdraw.auth'
    });
    res.status(401).json(CommonErrors.walletMismatch());
    return;
  }

  // Guard: refuse to reimburse fees until the destination wallet opts into the asset.
  await ensureWalletAssetOptIn(to, asset_id, 'receiving fee reimbursement');

  void monitorWalletHealth(walletAddress, { minerKey, operation: 'fee:withdraw' });

  // Guard the fee-withdraw flow so duplicate clicks reuse the same idempotent entry and emit telemetry.
  await withDeviceActionLock(req, res, {
    action: 'fee:withdraw',
    miner_key,
    address: walletAddress,
    metadata: { asset_id, to, amount }
  }, async () => {
    const algodClient = getAlgodClient();
    // Determine the dev custodial account handling fee reimbursements.
    const { account } = loadMnemonicAccountPair({
      mnemonicEnv: 'NEXT_PUBLIC_ALGORAND_DEV_MNEMONIC',
      label: 'dev fee withdraw'
    });
    const sender = account.addr.toString();
    const assetIndex = asset_id === 'none' ? 0 : Number(asset_id);
    const minerKey = miner_key
    const note = new TextEncoder().encode(JSON.stringify({
      miner_key: `${miner_key.split('-')[0]}-${miner_key.split('-')[1].slice(0, 6)}`,
      asset_id,
      from: sender,
      to,
      amount,
      date: new Date()
    }));

    // Build the withdrawal in microunits so the custodial account signs exactly what we broadcast.
    const encodedTxn = await buildAssetTransferTxn({
      sender,
      receiver: to!,
      assetId: assetIndex,
      amount: TEST_MODE ? 0 : amount,
      note,
      useRawAmount: TEST_MODE,
      decimals: 6
    });

    const txn = decodeUnsignedTransaction(encodedTxn);
    // Submit the withdrawal through the shared custodial signing helper (wait for confirmation).
    const { txId } = await signAndSubmitCustodialTransactions({
      mnemonicEnv: 'NEXT_PUBLIC_ALGORAND_DEV_MNEMONIC',
      label: 'dev fee withdraw',
      algod: algodClient,
      transactions: [txn],
      waitRounds: 4
    });

    const verified = await verifyTransaction(sender, txId);
    if (verified !== VERIFY_RESULT.OK) {
      throw {
        status: 500,
        response: createApiError(
          ErrorCodes.TRANSACTION_FAILED,
          'Failed to verify withdrawal transaction',
          'Please try again.'
        )
      };
    }

    const client = await clientPromise;
    const db = client.db('main');
    const devicesCollection = db.collection(TEST_MODE ? 'test-devices' : 'devices');
    await devicesCollection.updateOne(
      { miner_key, address: walletAddress },
      {
        $set: {
          'staked.withdraw_boost': true
        }
      }
    );

    loggers.txnLog('fee_withdraw_success', txId, {
      miner_key,
      asset_id,
      to,
      amount,
      testMode: TEST_MODE
    });

    void monitorTransaction(txId, {
      minerKey,
      walletAddress,
      operation: 'fee_withdraw',
      amount,
      assetId: asset_id,
      preconfirmed: true
    });

    return {
      response: { txId },
      journal: {
        txId,
        metadata: { asset_id, to, amount }
      }
    };
  });
}
