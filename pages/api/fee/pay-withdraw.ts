import { NextApiRequest, NextApiResponse } from 'next';
import algosdk, { waitForConfirmation } from 'algosdk';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import clientPromise from '../../../lib/mongoclient';
import { verifyTransaction } from '../algorand/verify-txn';
import { VERIFY_RESULT } from '../../../lib/txn';
import {
  CommonErrors,
  createApiError,
  ErrorCodes,
  handleApiError,
} from '../../../lib/api-errors';
import { loggers } from '../../../lib/logger';

// Algorand client setup
const token = '';
const server = 'https://xna-mainnet-api.algonode.cloud/';
const tokenToSend = { 'X-API-Key': token };
const port = 443;
const algodClient = new algosdk.Algodv2(tokenToSend, server, port);

const testMode =
  process.env.NEXT_PUBLIC_TEST_MODE &&
  process.env.NEXT_PUBLIC_TEST_MODE === 'true';

const lockSet: Set<string> = new Set();

const ENDPOINT = '/api/fee/pay-withdraw';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json(
      createApiError(
        ErrorCodes.INVALID_INPUT,
        'Unsupported request method',
        'Please use POST to trigger a fee withdrawal.'
      )
    );
  }

  const session = await getServerSession(req, res, authOptions);
  // Check if user is authenticated
  if (!session || !session.user?.address) {
    return res.status(401).json(CommonErrors.noSession());
  }

  const walletAddress = session.user.address;

  const {
    miner_key,
    asset_id,
    from: requestedFrom,
    to,
    amount,
  } = (req.body ?? {}) as {
    miner_key?: string;
    asset_id?: string;
    from?: string;
    to?: string;
    amount?: number;
  };

  if (
    !miner_key ||
    !asset_id ||
    !to ||
    typeof amount !== 'number' ||
    Number.isNaN(amount)
  ) {
    return res.status(400).json(
      createApiError(
        ErrorCodes.INVALID_INPUT,
        'Missing withdrawal parameters',
        'Please supply miner key, asset id, destination address, and amount.'
      )
    );
  }

  if (amount <= 0) {
    return res.status(400).json(
      createApiError(
        ErrorCodes.INVALID_INPUT,
        'Withdrawal amount must be greater than zero',
        'Adjust the amount and try again.'
      )
    );
  }

  if (requestedFrom && requestedFrom !== session.user.address) {
    loggers.apiError(ENDPOINT, new Error('Wallet mismatch during fee withdrawal'), {
      sessionAddress: session.user.address,
      requestedFrom,
      miner_key,
      issueType: 'FEE_WITHDRAW_WALLET_MISMATCH',
      part: 'fee.pay-withdraw.auth',
    });
    return res.status(401).json(CommonErrors.walletMismatch());
  }

  if (lockSet.has(miner_key)) {
    return res.status(429).json(
      createApiError(
        ErrorCodes.OPERATION_IN_PROGRESS,
        'Another withdrawal is already in progress',
        'Please wait a moment and try again.'
      )
    );
  }
  lockSet.add(miner_key);

  try {
    // Convert mnemonic to secret key
    const account = algosdk.mnemonicToSecretKey(
      process.env.NEXT_PUBLIC_ALGORAND_DEV_MNEMONIC!
    );

    const sender = account.addr.toString();
    const assetIndex: number = asset_id === 'none' ? 0 : Number(asset_id);

    // Fetch transaction parameters from the Algorand network
    const suggestedParams = await algodClient.getTransactionParams().do();

    const noteInfo = {
      miner_key:
        miner_key.split('-')[0] + '-' + miner_key.split('-')[1].slice(0, 6),
      asset_id: asset_id,
      from: sender,
      to: to,
      amount: amount,
      date: new Date(Date.now())
    };

    const enc = new TextEncoder();
    const note = enc.encode(JSON.stringify(noteInfo));

    // Create a transaction to send FRY
    const txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      sender: sender,
      receiver: to,
      amount: testMode ? 0 : amount * 1_000_000,
      assetIndex,
      note,
      suggestedParams
    });

    // Sign the transaction with the account secret key
    const signedTxn = txn.signTxn(account.sk);

    // Send the signed transaction to the network
    const tx = await algodClient.sendRawTransaction(signedTxn).do();
    const checking = await verifyTransaction(sender, tx.txid);
    const client = await clientPromise;
    const db = client.db('main');
    if (checking === VERIFY_RESULT.OK) {
      const collection = db.collection(testMode ? 'test-devices' : 'devices');
      await collection.updateOne(
        { miner_key: miner_key, address: session.user.address },
        {
          $set: {
            'staked.withdraw_boost': true
          }
        }
      );
      lockSet.delete(miner_key);
      loggers.txnLog('fee_withdraw_success', tx.txid, {
        miner_key,
        asset_id,
        to,
        amount,
        testMode,
      });
      return res.status(200).json({ txId: tx.txid });
    } else {
      lockSet.delete(miner_key);
      return res.status(500).json(
        createApiError(
          ErrorCodes.TRANSACTION_FAILED,
          'Failed to verify withdrawal transaction',
          'Please try again.'
        )
      );
    }
  } catch (error) {
    lockSet.delete(miner_key);
    handleApiError(res, ENDPOINT, error, {
      response: createApiError(
        ErrorCodes.INTERNAL_ERROR,
        'Unable to process withdrawal transaction',
        'Please try again. If the problem persists, contact support.'
      ),
      minerKey: miner_key,
      walletAddress,
      issueType: 'FEE_WITHDRAW_ERROR',
      part: 'fee.pay-withdraw.handler',
      metadata: {
        miner_key,
        asset_id,
        from: requestedFrom ?? walletAddress,
        to,
        amount,
      },
    });
    return;
  }
}
