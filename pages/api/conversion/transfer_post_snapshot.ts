import { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import clientPromise from '../../../lib/mongoclient';
import {
  FRY_1,
  tFRY,
  getFRYAssetBalances,
  normalizeAssetId,
} from '../../../lib/utils';
import { loggers } from '../../../lib/logger';
import {
  CommonErrors,
  createApiError,
  ErrorCodes,
  handleApiError,
} from '../../../lib/api-errors';
import { getAlgodClient } from '../../../lib/wallet/clients';
import { buildAssetTransferTxn } from '../../../lib/wallet/transactions';
import {
  decodeUnsignedTransaction,
  loadMnemonicAccountPair,
  signAndSubmitCustodialTransactions,
} from '../../../lib/algorand/admin';
import { verifyTransaction } from '../algorand/verify-txn';
import { VERIFY_RESULT } from '../../../lib/algorand/verification';
import { parseAlgodError } from '../../../lib/algorand/errorParser';

const testMode =
  process.env.NEXT_PUBLIC_TEST_MODE &&
  process.env.NEXT_PUBLIC_TEST_MODE === 'true';

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

  const { address } = (req.body ?? {}) as {
    address?: string;
  };

  if (!address || typeof address !== 'string') {
    return res.status(400).json(
      createApiError(
        ErrorCodes.INVALID_INPUT,
        'Missing post-snapshot claim parameters',
        'Please include the wallet address.'
      )
    );
  }

  if (walletAddress !== address) {
    loggers.apiError('/api/conversion/transfer_post_snapshot', new Error('Wallet mismatch during post-snapshot claim'), {
      sessionAddress: walletAddress,
      address,
      issueType: 'POST_SNAPSHOT_CLAIM_WALLET_MISMATCH',
      part: 'transfer-post-snapshot.auth',
    });
    return res.status(401).json(CommonErrors.walletMismatch());
  }

  try {
    const client = await clientPromise;
    const db = client.db('main');
    const collection = db.collection('post-snapshot-conversions');
    const record = await collection.findOne({ address });

    if (!record || !record.burned) {
      return res.status(400).json(
        createApiError(
          ErrorCodes.INVALID_INPUT,
          'No post-snapshot burn found',
          'You must burn your post-snapshot FRY 1.0 before claiming tFRY.'
        )
      );
    }

    if (record.claimed) {
      return res.status(400).json(
        createApiError(
          ErrorCodes.OPERATION_IN_PROGRESS,
          'tFRY already claimed',
          'This wallet has already claimed its post-snapshot tFRY.'
        )
      );
    }

    // Recompute eligibility
    const fryConversions = db.collection('fry-conversions');
    const snapshotUser = await fryConversions.findOne({ address });
    const snapshotAmount = snapshotUser?.amount ?? 0;

    const algodClient = getAlgodClient();
    let userFry1Balance = 0;
    try {
      const accountInfo = await algodClient.accountInformation(address).do();
      const assets = (accountInfo.assets ?? []) as Array<{
        ['asset-id']?: number | string | bigint;
        assetId?: number | string | bigint;
        amount?: number | string | bigint;
      }>;
      const fry1Asset = assets.find((a) => {
        const id = a['asset-id'] ?? a.assetId ?? null;
        return String(id) === FRY_1.id;
      });
      if (fry1Asset) {
        userFry1Balance = Number(fry1Asset.amount) / Math.pow(10, FRY_1.decimals);
      }
    } catch (err) {
      console.warn('[transfer_post_snapshot] failed to query user FRY 1.0 balance', err);
    }

    const eligible_fry1 = Math.max(0, Number((userFry1Balance - snapshotAmount).toFixed(6)));
    const eligible_tFRY = eligible_fry1 > 0 ? Number((eligible_fry1 / 40).toFixed(6)) : 0;

    if (eligible_tFRY <= 0) {
      return res.status(400).json(
        createApiError(
          ErrorCodes.INVALID_INPUT,
          'No tFRY available to claim',
          'Your post-snapshot FRY 1.0 balance is zero or negative after subtracting the snapshot amount.'
        )
      );
    }

    // Ensure user opted into tFRY
    const normalizedTarget = normalizeAssetId(tFRY.id);
    const accountInfo = await algodClient.accountInformation(address).do();
    const assets = (accountInfo.assets ?? []) as Array<{
      ['asset-id']?: number | string | bigint;
      assetId?: number | string | bigint;
    }>;
    const isOptedIn = assets.some((a) => {
      const candidate =
        a['asset-id'] ?? a.assetId ?? null;
      return normalizeAssetId(candidate) === normalizedTarget;
    });

    if (!isOptedIn) {
      return res.status(402).json(
        createApiError(
          ErrorCodes.INVALID_INPUT,
          'Please opt in to the tFRY asset',
          'Open your Algorand wallet and opt in to tFRY before retrying.'
        )
      );
    }

    // Check vault tFRY balance
    const vaultBalance = await getFRYAssetBalances(tFRY.id);
    if (vaultBalance < eligible_tFRY) {
      return res.status(402).json(
        createApiError(
          ErrorCodes.UPDATE_FAILED,
          'Post-snapshot claim failed: insufficient vault balance',
          'Please contact support so we can top up the tFRY vault.',
          {
            vaultBalance,
            eligible_tFRY: Number(eligible_tFRY.toFixed(5)),
          }
        )
      );
    }

    // Lock record
    const now = new Date();
    const lockResult = await collection.updateOne(
      { address, claimed: false },
      {
        $set: {
          isProcessing: true,
          processingStartedAt: now,
        },
      }
    );

    if (lockResult.modifiedCount <= 0) {
      return res.status(409).json(
        createApiError(
          ErrorCodes.OPERATION_IN_PROGRESS,
          'Another post-snapshot claim is already in progress',
          'Please wait a moment and try again.'
        )
      );
    }

    let shouldReleaseLock = true;

    try {
      const suggestedParams = await algodClient.getTransactionParams().do();
      const { account } = loadMnemonicAccountPair({
        mnemonicEnv: 'REWARD_MNEMONIC',
        rekeyEnv: 'REWARD_REKEY',
        label: 'post-snapshot tFRY claim',
      });

      const from = account.addr.toString();

      const noteInfo = {
        title: 'Post-Snapshot FRY 1.0 → tFRY',
        asset_id: tFRY.id,
        amount: eligible_tFRY,
        date: now,
      };

      const enc = new TextEncoder();
      const note = enc.encode(JSON.stringify(noteInfo));

      const rawAmount = testMode
        ? 0
        : Math.round(eligible_tFRY * Math.pow(10, tFRY.decimals || 0));

      const encodedTxn = await buildAssetTransferTxn({
        sender: from,
        receiver: address,
        assetId: Number(tFRY.id),
        amount: rawAmount,
        note,
        useRawAmount: true,
        suggestedParams,
      });

      const txn = decodeUnsignedTransaction(encodedTxn);
      const { txId } = await signAndSubmitCustodialTransactions({
        mnemonicEnv: 'REWARD_MNEMONIC',
        rekeyEnv: 'REWARD_REKEY',
        label: 'post-snapshot tFRY claim',
        algod: algodClient,
        transactions: [txn],
      });

      if (!txId) {
        return res.status(402).json(
          createApiError(
            ErrorCodes.TRANSACTION_FAILED,
            'Failed to submit tFRY claim transaction',
            'Please try again shortly.'
          )
        );
      }

      const verifyResult = await verifyTransaction(account.addr.toString(), txId);
      if (verifyResult !== VERIFY_RESULT.OK) {
        return res.status(402).json(
          createApiError(
            ErrorCodes.TRANSACTION_FAILED,
            'Failed to verify tFRY claim transaction',
            'Please wait a moment and try again.'
          )
        );
      }

      // Persist claim
      const finalUpdate = await collection.updateOne(
        { address },
        {
          $set: {
            claimed: true,
            claim_txId: txId,
            claimed_at: now,
            isProcessing: false,
          },
          $unset: {
            processingStartedAt: '',
          },
        }
      );

      if (finalUpdate.matchedCount <= 0) {
        throw new Error(`Failed to persist post-snapshot claim for ${address}`);
      }

      shouldReleaseLock = false;

      return res.status(200).json({
        success: true,
        message: `You have successfully claimed ${eligible_tFRY.toFixed(5)} tFRY from your post-snapshot conversion.`,
        txId,
        post_snapshot: {
          eligible_fry1,
          eligible_tFRY,
          burned: true,
          claimed: true,
          claim_txId: txId,
          claimed_at: now,
        },
      });
    } finally {
      if (shouldReleaseLock) {
        try {
          await collection.updateOne(
            { address },
            {
              $set: { isProcessing: false },
              $unset: { processingStartedAt: '' },
            }
          );
        } catch (unlockError) {
          loggers.apiError('/api/conversion/transfer_post_snapshot', unlockError, {
            address,
            issueType: 'POST_SNAPSHOT_CLAIM_UNLOCK_ERROR',
            part: 'transfer-post-snapshot.unlock',
          });
        }
      }
    }
  } catch (error) {
    const parsed = parseAlgodError(error);
    const userMessage =
      parsed?.userMessage ||
      (error instanceof Error ? error.message : 'Unable to process post-snapshot tFRY claim');
    const rawMessage = parsed?.rawMessage || (error instanceof Error ? error.message : String(error));

    handleApiError(res, '/api/conversion/transfer_post_snapshot', new Error(userMessage), {
      response: createApiError(
        ErrorCodes.INTERNAL_ERROR,
        userMessage,
        'Please try again. If the problem persists, contact support.'
      ),
      walletAddress,
      issueType: 'POST_SNAPSHOT_CLAIM_ERROR',
      part: 'transfer-post-snapshot.handler',
      metadata: {
        address,
        rawError: rawMessage,
      },
    });
  }
}
