import { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import clientPromise from '../../../lib/mongoclient';
import { verifyTransaction } from '../algorand/verify-txn';
import { VERIFY_RESULT } from '../../../lib/algorand/verification';
import {
  FRY_2,
  fNODE,
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
import { Document } from 'mongodb';
import { ensureWalletAssetOptIn } from '../../../lib/algorand/optIn';
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

  const { address, convertType } = (req.body ?? {}) as {
    address?: string;
    convertType?: string;
  };

  if (!address || typeof address !== 'string' || !convertType) {
    return res.status(400).json(
      createApiError(
        ErrorCodes.INVALID_INPUT,
        'Missing conversion parameters',
        'Please include the wallet address and conversion type.'
      )
    );
  }

  if (walletAddress !== address) {
    loggers.apiError('/api/conversion/transfer_reward', new Error('Wallet mismatch during conversion transfer'), {
      sessionAddress: walletAddress,
      address,
      issueType: 'FRY_CONVERSION_WALLET_MISMATCH',
      part: 'transfer-reward.auth',
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

    const assetId = convertType === FRY_2.id ? FRY_2.id : fNODE.id;
    // Guard: require the conversion wallet to be opted into the payout asset before sending custodial funds.
    await ensureWalletAssetOptIn(address, assetId, 'claiming FRY conversion rewards');
    const claimableAmount = Number(user.claimableAmount ?? 0);

    const vaultBalance = await getFRYAssetBalances(assetId);
    if (vaultBalance < claimableAmount) {
      return res.status(402).json(
        createApiError(
          ErrorCodes.UPDATE_FAILED,
          'Conversion failed: insufficient vault balance',
          'Please contact support so we can top up the conversion vault.',
          {
            vaultBalance,
            claimableAmount: Number(claimableAmount.toFixed(5)),
          }
        )
      );
    }

    const claimableMonths = Number(user.claimableMonths ?? 0);
    const claimedMonths = Number(user.claimedMonths ?? 0);
    const pendingAmount = Number(user.pendingAmount ?? 0);

    if (claimableAmount <= 0 || claimableMonths <= 0) {
      return res.status(400).json(
        createApiError(
          ErrorCodes.INVALID_INPUT,
          'No claimable conversion amount available yet',
          'Refresh to check your vesting schedule and try again next month.'
        )
      );
    }

    const ratio = Array.isArray(user.ratio) && user.ratio.length >= 2 ? user.ratio : [80, 40];
    const tokenLabel = convertType === FRY_2.id ? 'FRY 2.0' : 'fNODE';

    const fryPortion =
      convertType === FRY_2.id ? claimableAmount * ratio[0] : claimableAmount * ratio[1];

    const pendingAfter = Math.max(0, Number((pendingAmount - fryPortion).toFixed(8)));

    const lockFilter: Record<string, any> = {
      address,
      claimableAmount,
      claimableMonths,
      claimedMonths,
      isProcessing: { $ne: true },
    };

    const now = new Date();

    const lockResult = await collection.updateOne(lockFilter, {
      $set: {
        isProcessing: true,
        processingStartedAt: now,
        lastConversionAttemptAt: now,
      },
    });

    if (lockResult.modifiedCount <= 0) {
      return res.status(409).json(
        createApiError(
          ErrorCodes.OPERATION_IN_PROGRESS,
          'Another conversion is already in progress',
          'Please wait a moment and try again.'
        )
      );
    }

    let shouldReleaseLock = true;

    try {
      const algodClient = getAlgodClient();
      const accountInfo = await algodClient.accountInformation(address).do();
      const normalizedTarget = normalizeAssetId(assetId);
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
            `Please opt in to the ${tokenLabel} asset`,
            'Open your Algorand wallet and opt in before retrying.'
          )
        );
      }

      const suggestedParams = await algodClient.getTransactionParams().do();
      // Rewards vault is rekeyed, so load signer info via the shared helper.
      const { account } = loadMnemonicAccountPair({
        mnemonicEnv: 'REWARD_MNEMONIC',
        rekeyEnv: 'REWARD_REKEY',
        label: 'reward conversion'
      });

      const from = account.addr.toString();

      const noteInfo = {
        title: 'FRY 1.0 Conversion',
        asset_id: assetId,
        amount: claimableAmount,
        date: now,
      };

      const enc = new TextEncoder();
      const note = enc.encode(JSON.stringify(noteInfo));

      const rawAmount = testMode
        ? 0
        : Math.round(claimableAmount * Math.pow(10, FRY_2.decimals || 0));

      // Conversion payouts stay in microunits so downstream accounting remains exact.
      const encodedTxn = await buildAssetTransferTxn({
        sender: from,
        receiver: address,
        assetId: Number(assetId),
        amount: rawAmount,
        note,
        useRawAmount: true,
        suggestedParams
      });
      const txn = decodeUnsignedTransaction(encodedTxn);
      // Send the payout using the centralized custodial pipeline (single group).
      const { txId } = await signAndSubmitCustodialTransactions({
        mnemonicEnv: 'REWARD_MNEMONIC',
        rekeyEnv: 'REWARD_REKEY',
        label: 'reward conversion',
        algod: algodClient,
        transactions: [txn]
      });
      if (!txId) {
        return res.status(402).json(
          createApiError(
            ErrorCodes.TRANSACTION_FAILED,
            'Failed to submit conversion transaction',
            'Please try again shortly.'
          )
        );
      }

      const result = await verifyTransaction(account.addr.toString(), txId);
      if (result !== VERIFY_RESULT.OK) {
        return res.status(402).json(
          createApiError(
            ErrorCodes.TRANSACTION_FAILED,
            'Failed to verify conversion transaction',
            'Please wait a moment and try again.'
          )
        );
      }

      const finalUpdate = await collection.updateOne(
        { address },
        {
          $set: {
            claimableAmount: 0,
            claimedMonths: claimedMonths + claimableMonths,
            claimableMonths: 0,
            pendingAmount: pendingAfter,
            isProcessing: false,
            lastConversionAt: now,
            lastConversionTxId: txId,
          },
          $unset: {
            processingStartedAt: '',
          },
          $push: {
            history: {
              amount: claimableAmount,
              tokenType: tokenLabel,
              date: new Date(),
            },
          } as Document,
        }
      );

      if (finalUpdate.matchedCount <= 0) {
        throw new Error(`Failed to persist conversion state for ${address}`);
      }

      shouldReleaseLock = false;

      let completionSuffix = '';
      if (claimedMonths + claimableMonths >= 12) {
        completionSuffix = ' You have successfully completed your vesting schedule—no further claims remain.';
      } else {
        completionSuffix = ' Check back next month for your next claim!';
      }

      return res.status(200).json({
        success: true,
        message: `You have received "${claimableMonths}/12" month’s ${tokenLabel} from your vesting schedule.${completionSuffix}`,
        txId,
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
          loggers.apiError('/api/conversion/transfer_reward', unlockError, {
            address,
            issueType: 'FRY_CONVERSION_UNLOCK_ERROR',
            part: 'transfer-reward.unlock',
          });
        }
      }
    }
  } catch (error) {
    // Bubble up standardized API errors (e.g., wallet not opted in) so the UI can show actionable guidance.
    if (error && typeof error === 'object' && 'response' in (error as any)) {
      const typed = error as { status?: number; response?: any };
      const apiError = typed.response ?? createApiError(
        ErrorCodes.INTERNAL_ERROR,
        'Unable to process FRY conversion claim',
        'Please try again. If the problem persists, contact support.'
      );
      return handleApiError(res, '/api/conversion/transfer_reward', new Error(apiError.message ?? 'Conversion failed'), {
        status: typed.status ?? 400,
        response: apiError,
        walletAddress,
        issueType: 'FRY_CONVERSION_TRANSFER_ERROR',
        part: 'transfer-reward.handler',
        metadata: {
          address,
          convertType,
        },
      });
    }

    const parsed = parseAlgodError(error);
    const userMessage =
      parsed?.userMessage ||
      (error instanceof Error ? error.message : 'Unable to process FRY conversion claim');
    const rawMessage = parsed?.rawMessage || (error instanceof Error ? error.message : String(error));

    handleApiError(res, '/api/conversion/transfer_reward', new Error(userMessage), {
      response: createApiError(
        ErrorCodes.INTERNAL_ERROR,
        userMessage,
        'Please try again. If the problem persists, contact support.'
      ),
      walletAddress,
      issueType: 'FRY_CONVERSION_TRANSFER_ERROR',
      part: 'transfer-reward.handler',
      metadata: {
        address,
        convertType,
        rawError: rawMessage,
      },
    });
  }
}
