import { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import algosdk, { mnemonicToSecretKey } from 'algosdk';
import { authOptions } from '../auth/[...nextauth]';
import clientPromise from '../../../lib/mongoclient';
import { verifyTransaction } from '../algorand/verify-txn';
import { VERIFY_RESULT } from '../../../lib/txn';
import {
  FRY_2,
  fNODE,
  getFRYAssetBalances,
  normalizeAssetId
} from '../../../lib/utils';

const testMode =
  process.env.NEXT_PUBLIC_TEST_MODE &&
  process.env.NEXT_PUBLIC_TEST_MODE === 'true';

const token = '';
const server = 'https://xna-mainnet-api.algonode.cloud/';
const tokenToSend = { 'X-API-Key': token };
const port = 443;
const algodClient = new algosdk.Algodv2(tokenToSend, server, port);

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const session = await getServerSession(req, res, authOptions);
  // Check if user is authenticated
  if (!session || !session.user) {
    res.status(401).json({ message: 'Unauthorized 1' });
    return;
  }

  const data: {
    address: string;
    convertType: string;
  } = req.body;

  const { address, convertType } = data;
  if (session.user.address !== address || !address) {
    console.log(
      `Fry_Conversion session.user.address: ${session.user.address}, address: ${address} SPOOF`
    );
    res.status(401).json({ message: 'Unauthorized 2' });
    return;
  }

  try {
    const client = await clientPromise;
    const db = client.db('main');
    const collection = db.collection('fry-conversions');
    const user = await collection.findOne({ address });
    if (!user) {
      res.status(401).json({
        success: false,
        message: 'Not Existed Account For Conversion.'
      });
      return;
    }

    const assetId = convertType === FRY_2.id ? FRY_2.id : fNODE.id;
    const claimableAmount = Number(user.claimableAmount ?? 0);

    const vaultBalance = await getFRYAssetBalances(assetId);
    if (vaultBalance < claimableAmount) {
      res.status(402).json({
        message: `Conversion failed: Insufficient funds available in the rewards vault to process your claim. Vault Balance: ${vaultBalance}, Your Claimable Amount: ${claimableAmount.toFixed(5)} Please contact support to resolve this.`
      });
      return;
    }

    const claimableMonths = Number(user.claimableMonths ?? 0);
    const claimedMonths = Number(user.claimedMonths ?? 0);
    const pendingAmount = Number(user.pendingAmount ?? 0);

    if (claimableAmount <= 0 || claimableMonths <= 0) {
      res.status(400).json({
        success: false,
        message: 'No claimable conversion amount available yet. Refresh to check your vesting schedule.'
      });
      return;
    }

    const ratio = Array.isArray(user.ratio) && user.ratio.length >= 2 ? user.ratio : [80, 40];

    const tokenLabel = convertType === FRY_2.id ? 'FRY 2.0' : 'fNODE';

    const fryPortion = convertType === FRY_2.id
      ? claimableAmount * ratio[0]
      : claimableAmount * ratio[1];

    const pendingAfter = Math.max(0, Number((pendingAmount - fryPortion).toFixed(8)));

    const lockFilter: Record<string, any> = {
      address,
      claimableAmount,
      claimableMonths,
      claimedMonths,
      isProcessing: { $ne: true }
    };

    const now = new Date();

    const lockResult = await collection.updateOne(lockFilter, {
      $set: {
        isProcessing: true,
        processingStartedAt: now,
        lastConversionAttemptAt: now
      }
    });

    if (lockResult.modifiedCount <= 0) {
      res.status(409).json({
        success: false,
        message: 'Another conversion is already in progress. Please wait a moment and try again.'
      });
      return;
    }

    let shouldReleaseLock = true;

    try {
      const accountInfo = await algodClient.accountInformation(address).do();
      // Keep comparisons stable even when indexer returns bigint ids.
      const normalizedTarget = normalizeAssetId(assetId);
      const assets = (accountInfo.assets ?? []) as Array<{
        ['asset-id']?: number | string | bigint;
        assetId?: number | string | bigint;
        asset_id?: number | string | bigint;
      }>;
      const isOptedIn = assets.some((a) => {
        const candidate =
          a['asset-id'] ?? a.assetId ?? (a as Record<string, unknown>)?.asset_id ??
          null;
        return normalizeAssetId(candidate) === normalizedTarget;
      });

      if (!isOptedIn) {
        res.status(402).json({
          message: `Please opt-in the ${tokenLabel} asset to your account.`
        });
        return;
      }

      const suggestedParams = await algodClient.getTransactionParams().do();
      const account = mnemonicToSecretKey(process.env.REWARD_MNEMONIC!);
      const rekey = mnemonicToSecretKey(process.env.REWARD_REKEY!);

      const from = account.addr;

      const noteInfo = {
        title: 'FRY 1.0 Conversion',
        asset_id: assetId,
        amount: claimableAmount,
        date: now
      };

      const enc = new TextEncoder();
      const note = enc.encode(JSON.stringify(noteInfo));

      const decimals = FRY_2.decimals;

      const txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
        sender: from,
        receiver: address,
        amount: testMode
          ? 0
          : BigInt(Math.floor(claimableAmount * Math.pow(10, decimals || 0))),
        assetIndex: Number(assetId),
        note,
        suggestedParams,
      });

      const signedTxn = txn.signTxn(rekey.sk);
      const tx = await algodClient.sendRawTransaction(signedTxn).do();
      if (!tx) {
        res.status(402).json({
          message: 'Failed to make claiming transaction for conversion'
        });
        return;
      }

      const result = await verifyTransaction(account.addr.toString(), tx.txid);
      if (result !== VERIFY_RESULT.OK) {
        res
          .status(402)
          .json({ message: 'Failed to verify claim transaction' });
        return;
      }

      const finalUpdate = await collection.updateOne(
        { address },
        {
          $set: {
            claimableAmount: 0,
            claimedMonths: claimableMonths + claimedMonths,
            claimableMonths: 0,
            pendingAmount: pendingAfter,
            isProcessing: false,
            lastConversionAt: now,
            lastConversionTxId: tx.txid
          },
          $unset: {
            processingStartedAt: ''
          },
          $push: {
            history: {
              amount: claimableAmount,
              tokenType: tokenLabel,
              date: now
            }
          }
        }
      );

      if (finalUpdate.matchedCount <= 0) {
        throw new Error(`Failed to persist conversion state for ${address}`);
      }

      shouldReleaseLock = false;

      return res.status(200).json({
        success: true,
        message: `You’ve received "${claimableMonths}/12" month’s ${tokenLabel} from your vesting schedule. Check back next month for your next claim!`,
        txId: tx.txid
      });
    } finally {
      if (shouldReleaseLock) {
        try {
          await collection.updateOne(
            { address },
            {
              $set: {
                isProcessing: false
              },
              $unset: {
                processingStartedAt: ''
              }
            }
          );
        } catch (unlockError) {
          console.error('Failed to release fry conversion processing lock', {
            address,
            error: unlockError instanceof Error ? unlockError.message : unlockError
          });
        }
      }
    }
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
}
