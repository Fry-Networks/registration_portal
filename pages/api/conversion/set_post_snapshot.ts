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

const ENDPOINT = '/api/conversion/set_post_snapshot';

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

  const { address, txId } = (req.body ?? {}) as {
    address?: string;
    txId?: string;
  };

  if (!address || typeof address !== 'string' || !txId || typeof txId !== 'string') {
    return res.status(400).json(
      createApiError(
        ErrorCodes.INVALID_INPUT,
        'Missing conversion parameters',
        'Please include the wallet address and transaction ID.'
      )
    );
  }

  if (walletAddress !== address) {
    loggers.apiError(ENDPOINT, new Error('Wallet mismatch during post-snapshot burn'), {
      sessionAddress: walletAddress,
      address,
      issueType: 'POST_SNAPSHOT_WALLET_MISMATCH',
      part: 'set-post-snapshot.auth',
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

    // Check post_snapshot_amount > 0
    const postSnapshotAmount = user.post_snapshot_amount || 0;
    if (postSnapshotAmount <= 0) {
      return res.status(400).json(
        createApiError(
          ErrorCodes.INVALID_INPUT,
          'No post-snapshot balance available for conversion.',
          'You do not have any FRY 1.0 eligible for post-snapshot conversion.'
        )
      );
    }

    // Check not already burned
    if (user.post_burn_txId) {
      return res.status(400).json(
        createApiError(
          ErrorCodes.OPERATION_IN_PROGRESS,
          'Post-snapshot burn already completed',
          'You have already burned your post-snapshot FRY 1.0. Proceed to claim your tFRY.'
        )
      );
    }

    // Retry lookup in case indexer lags behind confirmation
    const lookupWithRetry = async (
      txIdToLookup: string,
      maxAttempts = 8,
      delayMs = 1000
    ): Promise<any> => {
      let lastErr: any = null;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          const lookupRes = await indexerClient.lookupTransactionByID(txIdToLookup).do();
          if (lookupRes && lookupRes.transaction) return lookupRes;
        } catch (error) {
          lastErr = error;
        }
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      if (lastErr) throw lastErr;
      throw new Error('Transaction not found by indexer');
    };

    const response = await lookupWithRetry(txId);
    const txn = response.transaction ?? {};

    // Verify sender matches wallet
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

    if (!assetTransfer) {
      loggers.apiError(ENDPOINT, new Error('Missing asset-transfer-transaction'), {
        address,
        txId,
        keys: Object.keys(txn || {}),
        txType: txn['tx-type'] || txn['type'] || txn?.transaction?.txType,
        innerTxns: stringifyBigInts(txn['inner-txns'] || txn.innerTxns || []),
        raw: stringifyBigInts(response),
        issueType: 'POST_SNAPSHOT_INVALID_TX',
        part: 'set-post-snapshot.assetTransferMissing',
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

    // Verify receiver is BURN_WALLET
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

    // Verify amount matches post_snapshot_amount
    const expectedAmount = testMode ? 0 : Math.floor(postSnapshotAmount * Math.pow(10, FRY_1.decimals));

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
          'Burn amount does not match your post-snapshot balance',
          `Please submit the exact FRY 1.0 amount: ${postSnapshotAmount.toLocaleString()}`
        )
      );
    }

    // Update: record the burn transaction
    const updateResult = await collection.updateOne(
      { address },
      {
        $set: {
          post_burn_txId: txId
        }
      }
    );

    if (updateResult.matchedCount <= 0) {
      return res.status(402).json(
        createApiError(
          ErrorCodes.UPDATE_FAILED,
          `Failed to record post-snapshot burn for ${address}`,
          'Please try again or contact support.'
        )
      );
    }

    const updated = await collection.findOne({ address });
    const tFRYAmount = postSnapshotAmount / 40;

    res.status(200).json({
      success: true,
      message: `🔥 Post-snapshot FRY 1.0 burn complete! You can now claim ${tFRYAmount.toFixed(5)} tFRY.`,
      user: updated,
      post_snapshot: {
        eligible_fry1: postSnapshotAmount,
        eligible_tFRY: tFRYAmount,
        burned: true,
        claimed: false,
        claim_txId: null,
        claimed_at: null
      }
    });
  } catch (error) {
    handleApiError(res, ENDPOINT, error, {
      response: createApiError(
        ErrorCodes.INTERNAL_ERROR,
        'Unable to process post-snapshot burn verification',
        'Please try again. If the problem persists, contact support.'
      ),
      walletAddress,
      issueType: 'POST_SNAPSHOT_BURN_ERROR',
      part: 'set-post-snapshot.handler',
      metadata: {
        address,
        txId,
      },
    });
  }
}
