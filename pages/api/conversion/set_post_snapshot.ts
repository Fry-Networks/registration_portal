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

const ENDPOINT = '/api/conversion/set_post_snapshot';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
    await wait(delayMs);
  }
  if (lastErr) throw lastErr;
  throw new Error('Transaction not found by indexer');
};

const resolveAxferPayload = (txn: any) =>
  txn['asset-transfer-transaction'] ??
  (txn as Record<string, any>)['asset_transfer_transaction'] ??
  (txn as Record<string, any>).assetTransferTransaction ??
  (txn as Record<string, any>).asset_transfer_transaction ??
  (txn as Record<string, any>).axfer;

const readAssetId = (axfer: Record<string, any>) =>
  axfer['asset-id'] ??
  axfer['asset_id'] ??
  axfer.assetId ??
  axfer.asset_id;

const readAmount = (axfer: Record<string, any>) =>
  axfer['amount'] ??
  axfer.amount ??
  axfer['amount-base'] ??
  axfer['amount_base'];

const readReceiver = (axfer: Record<string, any>) =>
  axfer['receiver'] ?? axfer.receiver;

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
        'Missing post-snapshot parameters',
        'Please include the wallet address and transaction ID.'
      )
    );
  }

  if (walletAddress !== address) {
    loggers.apiError(ENDPOINT, new Error('Wallet mismatch during set post snapshot'), {
      sessionAddress: walletAddress,
      address,
      issueType: 'POST_SNAPSHOT_WALLET_MISMATCH',
      part: 'set-post-snapshot.auth',
    });
    return res.status(401).json(CommonErrors.walletMismatch());
  }

  try {
    const response = await lookupWithRetry(txId);
    const txn = response.transaction ?? {};

    const senderAddr =
      txn['sender'] ??
      (txn as Record<string, any>).sender;

    if (senderAddr !== address) {
      return res.status(401).json(
        createApiError(
          ErrorCodes.WALLET_MISMATCH,
          'Transaction sender does not match your wallet',
          'Please submit the burn transaction from your signed-in wallet.'
        )
      );
    }

    const axfer = resolveAxferPayload(txn);

    if (!axfer) {
      return res.status(401).json(
        createApiError(
          ErrorCodes.INVALID_TRANSACTION,
          'Invalid transaction type',
          'Please submit an Algorand ASA transfer that burns FRY 1.0.'
        )
      );
    }

    const rawAssetId = readAssetId(axfer);
    if (normalizeAssetId(rawAssetId) !== normalizeAssetId(FRY_1.id)) {
      return res.status(401).json(
        createApiError(
          ErrorCodes.INVALID_TRANSACTION,
          'Invalid asset ID for burn transaction',
          'Please burn FRY 1.0 tokens for this conversion.'
        )
      );
    }

    const receiver = readReceiver(axfer);
    if (receiver !== BURN_WALLET) {
      return res.status(401).json(
        createApiError(
          ErrorCodes.INVALID_TRANSACTION,
          'Invalid burn wallet',
          'Please send the burn transaction to the official vault burn wallet.'
        )
      );
    }

    const amountRaw = readAmount(axfer);
    const amountMicro =
      typeof amountRaw === 'number'
        ? amountRaw
        : typeof amountRaw === 'bigint'
          ? Number(amountRaw)
          : Number(amountRaw ?? 0);

    if (!Number.isFinite(amountMicro) || amountMicro < 0) {
      return res.status(401).json(
        createApiError(
          ErrorCodes.INVALID_TRANSACTION,
          'Invalid burn amount',
          'The transaction amount could not be read.'
        )
      );
    }

    const eligible_fry1 = amountMicro / Math.pow(10, FRY_1.decimals);
    const eligible_tFRY = eligible_fry1 / 40;

    const client = await clientPromise;
    const db = client.db('main');
    const collection = db.collection('post-snapshot-conversions');

    await collection.updateOne(
      { address },
      {
        $set: {
          eligible_fry1,
          eligible_tFRY,
          burned: true,
          burn_txId: txId,
          updated_at: new Date()
        },
        $setOnInsert: {
          address,
          claimed: false,
          claim_txId: null,
          claimed_at: null,
          created_at: new Date()
        }
      },
      { upsert: true }
    );

    const postSnapshotDoc = await collection.findOne({ address });

    res.status(200).json({
      success: true,
      message: 'Post-snapshot burn verified. You can now claim your tFRY.',
      post_snapshot: postSnapshotDoc
        ? {
            eligible_fry1: postSnapshotDoc.eligible_fry1 ?? 0,
            eligible_tFRY: postSnapshotDoc.eligible_tFRY ?? 0,
            burned: postSnapshotDoc.burned ?? false,
            claimed: postSnapshotDoc.claimed ?? false,
            claim_txId: postSnapshotDoc.claim_txId ?? null,
            claimed_at: postSnapshotDoc.claimed_at ?? null
          }
        : null
    });
  } catch (error) {
    handleApiError(res, ENDPOINT, error, {
      response: createApiError(
        ErrorCodes.INTERNAL_ERROR,
        'Unable to process post-snapshot burn',
        'Please try again. If the problem persists, contact support.'
      ),
      walletAddress,
      issueType: 'POST_SNAPSHOT_ERROR',
      part: 'set-post-snapshot.handler',
      metadata: {
        address,
        txId
      }
    });
  }
}
