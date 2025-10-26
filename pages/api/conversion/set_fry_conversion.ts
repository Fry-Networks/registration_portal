import { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import clientPromise from '../../../lib/mongoclient';
import {
  indexerClient,
  BURN_WALLET,
  FRY_1,
  normalizeAssetId,
} from '../../../lib/utils';
import { loggers } from '../../../lib/logger';
import {
  CommonErrors,
  createApiError,
  ErrorCodes,
  handleApiError,
} from '../../../lib/api-errors';

const testMode =
  process.env.NEXT_PUBLIC_TEST_MODE &&
  process.env.NEXT_PUBLIC_TEST_MODE === 'true';

const stringifyBigInts = (value: any): any => {
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (Array.isArray(value)) {
    return value.map((item) => stringifyBigInts(item));
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value).map(([k, v]) => [k, stringifyBigInts(v)]);
    return Object.fromEntries(entries);
  }
  return value;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json(
      createApiError(
        ErrorCodes.INVALID_INPUT,
        'That request is not available.',
        'Please retry this action from the dashboard.'
      )
    );
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session || !session.user) {
    return res.status(401).json(CommonErrors.noSession());
  }
  const walletAddress = session.user.address;

  const { address, id } = (req.body ?? {}) as {
    address?: string;
    id?: string;
  };

  if (!address || typeof address !== 'string' || !id || typeof id !== 'string') {
    return res.status(400).json(
      createApiError(
        ErrorCodes.INVALID_INPUT,
        'Missing conversion parameters',
        'Please include the wallet address and transaction ID.'
      )
    );
  }

  if (walletAddress !== address) {
    loggers.apiError('/api/conversion/set_fry_conversion', new Error('Wallet mismatch during set conversion'), {
      sessionAddress: walletAddress,
      address,
      issueType: 'FRY_CONVERSION_WALLET_MISMATCH',
      part: 'set-conversion.auth',
    });
    return res.status(401).json(CommonErrors.walletMismatch());
  }

  try {
    const client = await clientPromise;
    const db = client.db('main');
    const collection = db.collection('fry-conversions');
    const user = await collection.findOne({ address });
    if (!user) {
      return res.status(401).json(
        createApiError(
          ErrorCodes.DEVICE_NOT_FOUND,
          'No conversion account found for this wallet',
          'Please verify the address and try again.'
        )
      );
    }

    if (user.amount === 0) {
      return res.status(401).json(
        createApiError(
          ErrorCodes.INVALID_INPUT,
          'No balance available for conversion.'
        )
      );
    }

    if (user.status === 'pending') {
      return res.status(401).json(
        createApiError(
          ErrorCodes.OPERATION_IN_PROGRESS,
          'Conversion has already started',
          'Please wait for the current conversion to finish.'
        )
      );
    }

    // Retry lookup in case indexer lags behind confirmation
    const lookupWithRetry = async (
      txId: string,
      maxAttempts = 8,
      delayMs = 1000
    ): Promise<any> => {
      let lastErr: any = null;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          const lookupRes = await indexerClient.lookupTransactionByID(txId).do();
          if (lookupRes && lookupRes.transaction) return lookupRes;
        } catch (error) {
          lastErr = error;
        }
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      if (lastErr) throw lastErr;
      throw new Error('Transaction not found by indexer');
    };

    const response = await lookupWithRetry(id);
    const txn = response.transaction ?? {};

    const senderAddr =
      (txn['sender'] as string | undefined) ??
      (txn.sender as string | undefined) ??
      (txn?.transaction?.sender as string | undefined);

    if (senderAddr !== address) {
      return res.status(401).json(
        createApiError(
          ErrorCodes.WALLET_MISMATCH,
          'Transaction sender does not match your wallet',
          'Please submit the burn transaction from your signed-in wallet.'
        )
      );
    }

    const assetTransfer =
      txn['asset-transfer-transaction'] ||
      (txn as Record<string, any>)?.assetTransferTransaction ||
      txn['assetTransferTransaction'] ||
      txn['axfer'] ||
      (txn['transaction'] &&
        (txn['transaction']['asset-transfer-transaction'] ??
          (txn['transaction'] as Record<string, any>)?.assetTransferTransaction ??
          txn['transaction']['assetTransferTransaction'])) ||
      (txn as Record<string, any>)?.transaction?.axfer;

    // Check if the transaction is an Algorand asset transfer (expected)    
      if (!assetTransfer) {
      loggers.apiError('/api/conversion/set_fry_conversion', new Error('Missing asset-transfer-transaction'), {
        address,
        txId: id,
        keys: Object.keys(txn || {}),
        txType: txn['tx-type'] || txn['type'] || txn?.transaction?.txType,
        innerTxns: stringifyBigInts(txn['inner-txns'] || txn.innerTxns || []),
        raw: stringifyBigInts(response),
        issueType: 'FRY_CONVERSION_INVALID_TX',
        part: 'set-conversion.assetTransferMissing',
      });
      return res.status(401).json(
        createApiError(
          ErrorCodes.INVALID_TRANSACTION,
          'Invalid transaction type',
          'Please submit an Algorand ASA transfer that burns FRY 1.0.'
        )
      );
    }
      // Ensure the ASA matches FRY 1.0
    const assetIdCandidate =
      assetTransfer['asset-id'] ??
      assetTransfer['assetId'] ??
      assetTransfer.assetId ??
      (typeof assetTransfer.getAssetId === 'function'
        ? assetTransfer.getAssetId()
        : undefined);

    if (normalizeAssetId(assetIdCandidate) !== normalizeAssetId(FRY_1.id)) {
      return res.status(401).json(
        createApiError(
          ErrorCodes.INVALID_TRANSACTION,
          'Invalid asset ID for burn transaction',
          'Please burn FRY 1.0 tokens for this conversion.'
        )
      );
    }

    const receiverAddr =
      assetTransfer['receiver'] ??
      assetTransfer['receiverAddr'] ??
      assetTransfer.receiver;

    if (receiverAddr !== BURN_WALLET) {
      return res.status(401).json(
        createApiError(
          ErrorCodes.INVALID_TRANSACTION,
          'Invalid burn wallet',
          'Please send the burn transaction to the official vault burn wallet.'
        )
      );
    }

    const baseAmount =
      typeof user.amount === 'number' ? user.amount : parseFloat(user.amount);
    const expectedAmount = testMode ? 0 : Math.floor(baseAmount * Math.pow(10, FRY_1.decimals));

    const amountCandidate =
      assetTransfer['amount'] ??
      assetTransfer['amountRaw'] ??
      assetTransfer.amount;

    const amountNum =
      typeof amountCandidate === 'string'
        ? Number(amountCandidate)
        : typeof amountCandidate === 'bigint'
          ? Number(amountCandidate)
          : Number(amountCandidate ?? 0);

    if (amountNum !== expectedAmount) {
      return res.status(401).json(
        createApiError(
          ErrorCodes.AMOUNT_MISMATCH,
          'Burn amount does not match your conversion balance',
          'Please submit the exact FRY 1.0 amount shown in the dashboard.'
        )
      );
    }

    const updateResult = await collection.updateOne(
      { address },
      {
        $set: {
          status: 'pending',
          claimableAmount: 0,
          pendingAmount: user.amount,
          claimableMonths: 0,
          claimedMonths: 0,
          isProcessing: false,
        },
        $unset: {
          processingStartedAt: '',
        },
      }
    );

    if (updateResult.matchedCount <= 0) {
      return res.status(402).json(
        createApiError(
          ErrorCodes.UPDATE_FAILED,
          `Failed to start conversion for ${address}`,
          'Please try again or contact support.'
        )
      );
    }

    const updated = await collection.findOne({ address });

    res.status(200).json({
      success: true,
      message: '🔥 FRY1.0 burn complete! Your vaulted amount is unlocked and ready to claim.',
      user: updated,
    });
  } catch (error) {
    handleApiError(res, '/api/conversion/set_fry_conversion', error, {
      response: createApiError(
        ErrorCodes.INTERNAL_ERROR,
        'Unable to process FRY 1.0 conversion',
        'Please try again. If the problem persists, contact support.'
      ),
      walletAddress,
      issueType: 'FRY_CONVERSION_ERROR',
      part: 'set-conversion.handler',
      metadata: {
        address,
        txId: id,
      },
    });
  }
}
