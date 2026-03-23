import { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import clientPromise from '../../../lib/mongoclient';
import { verifyTransaction } from '../algorand/verify-txn';
import { VERIFY_RESULT } from '../../../lib/algorand/verification';
import {
  tFRY,
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
import { ensureWalletAssetOptIn } from '../../../lib/algorand/optIn';
import { parseAlgodError } from '../../../lib/algorand/errorParser';

const testMode =
  process.env.NEXT_PUBLIC_TEST_MODE &&
  process.env.NEXT_PUBLIC_TEST_MODE === 'true';

const ENDPOINT = '/api/conversion/transfer_post_snapshot';

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
        'Missing wallet address',
        'Please include your wallet address.'
      )
    );
  }

  if (walletAddress !== address) {
    loggers.apiError(ENDPOINT, new Error('Wallet mismatch during post-snapshot transfer'), {
      sessionAddress: walletAddress,
      address,
      issueType: 'POST_SNAPSHOT_WALLET_MISMATCH',
      part: 'transfer-post-snapshot.auth',
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

    // Verify burn was completed
    if (!user.post_burn_txId) {
      return res.status(400).json(
        createApiError(
          ErrorCodes.INVALID_INPUT,
          'Post-snapshot burn not completed',
          'Please burn your post-snapshot FRY 1.0 first before claiming tFRY.'
        )
      );
    }

    // Check not already claimed
    if (user.post_claimed) {
      return res.status(400).json(
        createApiError(
          ErrorCodes.OPERATION_IN_PROGRESS,
          'Post-snapshot tFRY already claimed',
          `You have already claimed your post-snapshot tFRY. TxId: ${user.post_claim_txId}`
        )
      );
    }

    const postSnapshotAmount = user.post_snapshot_amount || 0;
    const tFRYAmount = postSnapshotAmount / 40;

    if (tFRYAmount <= 0) {
      return res.status(400).json(
        createApiError(
          ErrorCodes.INVALID_INPUT,
          'No tFRY available to claim',
          'Your post-snapshot tFRY amount is zero.'
        )
      );
    }

    // Ensure wallet is opted into tFRY (asset 2681521901)
    await ensureWalletAssetOptIn(address, tFRY.id, 'claiming post-snapshot tFRY');

    // Lock with isProcessing
    const now = new Date();
    const lockFilter: Record<string, any> = {
      address,
      post_burn_txId: user.post_burn_txId,
      post_claimed: { $ne: true },
      isProcessing: { $ne: true },
    };

    const lockResult = await collection.updateOne(lockFilter, {
      $set: {
        isProcessing: true,
        processingStartedAt: now,
      },
    });

    if (lockResult.modifiedCount <= 0) {
      return res.status(409).json(
        createApiError(
          ErrorCodes.OPERATION_IN_PROGRESS,
          'Another claim is already in progress',
          'Please wait a moment and try again.'
        )
      );
    }

    let shouldReleaseLock = true;

    try {
      const algodClient = getAlgodClient();
      
      // Verify wallet is opted into tFRY
      const accountInfo = await algodClient.accountInformation(address).do();
      const normalizedTarget = normalizeAssetId(tFRY.id);
      const assets = (accountInfo.assets ?? []) as Array<{
        ['asset-id']?: number | string | bigint;
        assetId?: number | string | bigint;
        asset_id?: number | string | bigint;
      }>;
      const isOptedIn = assets.some((a) => {
        const candidate =
          a['asset-id'] ?? a.assetId ?? (a as Record<string, unknown>)?.asset_id ?? null;
        return normalizeAssetId(candidate) === normalizedTarget;
      });

      if (!isOptedIn) {
        return res.status(402).json(
          createApiError(
            ErrorCodes.INVALID_INPUT,
            'Please opt in to the tFRY asset',
            `Open your Algorand wallet and opt in to tFRY (ASA ${tFRY.id}) before retrying.`
          )
        );
      }

      const suggestedParams = await algodClient.getTransactionParams().do();
      
      // Load reward wallet credentials
      const { account } = loadMnemonicAccountPair({
        mnemonicEnv: 'REWARD_MNEMONIC',
        rekeyEnv: 'REWARD_REKEY',
        label: 'post-snapshot tFRY claim'
      });

      const from = account.addr.toString();

      const noteInfo = {
        title: 'FIP-010 Post-Snapshot Conversion',
        asset_id: tFRY.id,
        amount: tFRYAmount,
        fry1_burned: postSnapshotAmount,
        date: now,
      };

      const enc = new TextEncoder();
      const note = enc.encode(JSON.stringify(noteInfo));

      const rawAmount = testMode
        ? 0
        : Math.round(tFRYAmount * Math.pow(10, tFRY.decimals || 6));

      const encodedTxn = await buildAssetTransferTxn({
        sender: from,
        receiver: address,
        assetId: Number(tFRY.id),
        amount: rawAmount,
        note,
        useRawAmount: true,
        suggestedParams
      });
      
      const txn = decodeUnsignedTransaction(encodedTxn);
      
      // Send the tFRY using custodial pipeline
      const { txId } = await signAndSubmitCustodialTransactions({
        mnemonicEnv: 'REWARD_MNEMONIC',
        rekeyEnv: 'REWARD_REKEY',
        label: 'post-snapshot tFRY claim',
        algod: algodClient,
        transactions: [txn]
      });
      
      if (!txId) {
        return res.status(402).json(
          createApiError(
            ErrorCodes.TRANSACTION_FAILED,
            'Failed to submit tFRY transfer transaction',
            'Please try again shortly.'
          )
        );
      }

      const result = await verifyTransaction(account.addr.toString(), txId);
      if (result !== VERIFY_RESULT.OK) {
        return res.status(402).json(
          createApiError(
            ErrorCodes.TRANSACTION_FAILED,
            'Failed to verify tFRY transfer transaction',
            'Please wait a moment and try again.'
          )
        );
      }

      // Update: mark as claimed
      const finalUpdate = await collection.updateOne(
        { address },
        {
          $set: {
            post_claimed: true,
            post_claim_txId: txId,
            post_claimed_at: now,
            isProcessing: false,
          },
          $unset: {
            processingStartedAt: '',
          },
        }
      );

      if (finalUpdate.matchedCount <= 0) {
        throw new Error(`Failed to persist post-snapshot claim state for ${address}`);
      }

      shouldReleaseLock = false;

      return res.status(200).json({
        success: true,
        message: `🎉 You have received ${tFRYAmount.toFixed(5)} tFRY from your post-snapshot conversion!`,
        txId,
        post_snapshot: {
          eligible_fry1: postSnapshotAmount,
          eligible_tFRY: tFRYAmount,
          burned: true,
          claimed: true,
          claim_txId: txId,
          claimed_at: now
        }
      });
    } finally {
      if (shouldReleaseLock) {
        try {
          await collection.updateOne(
            { address },
            {
              $set: {
                isProcessing: false,
              },
              $unset: {
                processingStartedAt: '',
              },
            }
          );
        } catch (unlockError) {
          loggers.apiError(ENDPOINT, unlockError, {
            address,
            issueType: 'POST_SNAPSHOT_UNLOCK_ERROR',
            part: 'transfer-post-snapshot.unlock',
          });
        }
      }
    }
  } catch (error) {
    // Bubble up standardized API errors
    if (error && typeof error === 'object' && 'response' in (error as any)) {
      const typed = error as { status?: number; response?: any };
      const apiError = typed.response ?? createApiError(
        ErrorCodes.INTERNAL_ERROR,
        'Unable to process post-snapshot tFRY claim',
        'Please try again. If the problem persists, contact support.'
      );
      return handleApiError(res, ENDPOINT, new Error(apiError.message ?? 'Post-snapshot claim failed'), {
        status: typed.status ?? 400,
        response: apiError,
        walletAddress,
        issueType: 'POST_SNAPSHOT_TRANSFER_ERROR',
        part: 'transfer-post-snapshot.handler',
        metadata: {
          address,
        },
      });
    }

    const parsed = parseAlgodError(error);
    const userMessage =
      parsed?.userMessage ||
      (error instanceof Error ? error.message : 'Unable to process post-snapshot tFRY claim');
    const rawMessage = parsed?.rawMessage || (error instanceof Error ? error.message : String(error));

    handleApiError(res, ENDPOINT, new Error(userMessage), {
      response: createApiError(
        ErrorCodes.INTERNAL_ERROR,
        userMessage,
        'Please try again. If the problem persists, contact support.'
      ),
      walletAddress,
      issueType: 'POST_SNAPSHOT_TRANSFER_ERROR',
      part: 'transfer-post-snapshot.handler',
      metadata: {
        address,
        rawError: rawMessage,
      },
    });
  }
}
