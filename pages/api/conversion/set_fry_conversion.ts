import { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import clientPromise from '../../../lib/mongoclient';
import { indexerClient, BURN_WALLET, FRY_1, normalizeAssetId } from '../../../lib/utils';

const testMode =
  process.env.NEXT_PUBLIC_TEST_MODE &&
  process.env.NEXT_PUBLIC_TEST_MODE === 'true';
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
    id: string;
  } = req.body;

  const { address, id } = data;
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
      res.status(401).json({ success: false, message: 'Not Existed Account For Conversion.' });
      return;
    }

    if (user.amount === 0) {
      res.status(401).json({ success: false, message: 'Not Enough Balance For Conversion.' });
      return;
    }

    if (user.status === 'pending') {
      res.status(401).json({ success: false, message: 'Already Started The Conversion.' });
      return;
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
          const res = await indexerClient.lookupTransactionByID(txId).do();
          if (res && res.transaction) return res;
        } catch (e) {
          lastErr = e;
        }
        // small delay before retrying
        await new Promise((r) => setTimeout(r, delayMs));
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
      res.status(401).json({ success: false, message: 'Unauthorized Transaction.' });
      return;
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

    // Check if the transaction is an Algorand asset transfer (expected)
    if (!assetTransfer) {
      console.error('[set_fry_conversion] Missing asset-transfer-transaction', {
        txId: id,
        keys: Object.keys(txn || {}),
        txType: txn['tx-type'] || txn['type'] || txn?.transaction?.txType,
        innerTxns: stringifyBigInts(txn['inner-txns'] || txn.innerTxns || []),
        raw: stringifyBigInts(response)
      });
      res.status(401).json({ success: false, message: 'Invalid Transaction Type.' });
      return;
    } else {
      // Ensure the ASA matches FRY 1.0
      const assetIdCandidate =
        assetTransfer['asset-id'] ??
        assetTransfer['assetId'] ??
        assetTransfer.assetId ??
        (typeof assetTransfer.getAssetId === 'function'
          ? assetTransfer.getAssetId()
          : undefined);

      if (
        normalizeAssetId(assetIdCandidate) !== normalizeAssetId(FRY_1.id)
      ) {
        res.status(401).json({ success: false, message: 'Invalid Asset ID for burn transaction.' });
        return;
      }
      const receiverAddr =
        assetTransfer['receiver'] ??
        assetTransfer['receiverAddr'] ??
        assetTransfer.receiver;

      if (receiverAddr !== BURN_WALLET) {
        res.status(401).json({ success: false, message: 'Unauthorized Receiver.' });
        return;
      }

      // Compute expected micro amount from DB amount
      const baseAmount = typeof user.amount === 'number' ? user.amount : parseFloat(user.amount);
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
        res.status(401).json({ success: false, message: 'Invalid Transfer Amount.' });
        return;
      }
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
          isProcessing: false
        },
        $unset: {
          processingStartedAt: ''
        }
      }
    );

    let success = true;
    if (updateResult.matchedCount <= 0) {
      success = false;
    }

    if (success === false) {
      res.status(402).json({
        success: false,
        message: `Failed to set claiming for account ${address}.`
      });
      return;
    }

    // Return the latest user state so the UI can refresh without an extra request
    const updated = await collection.findOne({ address });

    res.status(200).json({
      success: true,
      message: `🔥 FRY1.0 burn complete! Your vaulted amount is unlocked and ready to claim.`,
      user: updated
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
}
