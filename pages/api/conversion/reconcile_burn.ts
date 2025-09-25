import { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import clientPromise from '../../../lib/mongoclient';
import {
  indexerClient,
  BURN_WALLET,
  FRY_1,
  normalizeAssetId
} from '../../../lib/utils';

const testMode =
  process.env.NEXT_PUBLIC_TEST_MODE &&
  process.env.NEXT_PUBLIC_TEST_MODE === 'true';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const session = await getServerSession(req, res, authOptions);
  if (!session || !session.user) {
    res.status(401).json({ message: 'Unauthorized 1' });
    return;
  }

  const data: {
    address: string;
    txId?: string;
  } = req.body;

  const { address, txId } = data;
  if (session.user.address !== address || !address) {
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
      // Already reconciled
      res.status(200).json({ success: true, message: 'Already started conversion.', user });
      return;
    }

    const lookupWithRetry = async (
      id: string,
      maxAttempts = 8,
      delayMs = 1000
    ) => {
      let lastErr: any = null;
      for (let i = 0; i < maxAttempts; i++) {
        try {
          const res = await indexerClient.lookupTransactionByID(id).do();
          if (res && res.transaction) return res;
        } catch (e) {
          lastErr = e;
        }
        await new Promise((r) => setTimeout(r, delayMs));
      }
      if (lastErr) throw lastErr;
      throw new Error('Transaction not found by indexer');
    };

    const validateBurnTxn = (txn: any, expectedMicroAmount: number) => {
      if (txn['sender'] !== address) return 'Unauthorized Transaction.';
      if (!txn['asset-transfer-transaction']) return 'Invalid Transaction Type.';
      const axfer = txn['asset-transfer-transaction'];
      if (
        axfer['asset-id'] !== Number(FRY_1.id) &&
        axfer['asset-id'] !== FRY_1.id
      )
        return 'Invalid Asset ID for burn transaction.';
      if (axfer['receiver'] !== BURN_WALLET) return 'Unauthorized Receiver.';
      if (axfer['amount'] !== expectedMicroAmount)
        return 'Invalid Transfer Amount.';
      return undefined;
    };

    // Compute expected amount
    const baseAmount = typeof user.amount === 'number' ? user.amount : parseFloat(user.amount);
    const expectedMicro = testMode ? 0 : Math.floor(baseAmount * Math.pow(10, FRY_1.decimals));

    let burnTxn: any | undefined;

    if (txId) {
      const resp = await lookupWithRetry(txId);
      burnTxn = resp.transaction;
      const err = validateBurnTxn(burnTxn, expectedMicro);
      if (err) {
        res.status(401).json({ success: false, message: err });
        return;
      }
    } else {
      // Try to discover a suitable burn by searching recent transactions
      const search = await indexerClient
        .searchForTransactions()
        .address(address)
        .addressRole('sender')
        .txType('axfer')
        .assetID(Number(FRY_1.id))
        .limit(50)
        .do();

      // Ensure transaction searches work regardless of bigint asset ids.
      const normalizedFryId = normalizeAssetId(FRY_1.id);
      const candidates = (search.transactions || []).filter((t: any) => {
        const ax = t['asset-transfer-transaction'];
        return (
          ax &&
          normalizeAssetId(ax['asset-id']) === normalizedFryId &&
          ax['receiver'] === BURN_WALLET &&
          ax['amount'] === expectedMicro
        );
      });

      if (!candidates.length) {
        res.status(404).json({
          success: false,
          message: 'No matching burn transaction found. If you already burned, provide the transaction ID.'
        });
        return;
      }
      // Pick the most recent
      burnTxn = candidates[0];
    }

    // Update user to pending as in set_fry_conversion
    const updateResult = await collection.updateOne(
      { address },
      {
        $set: {
          status: 'pending',
          claimableAmount: 0,
          pendingAmount: user.amount,
          claimableMonths: 0,
          claimedMonths: 0
        },
        $unset: {
          supportReconcile: "",
          burnAttempted: "",
          burnAttemptedAt: ""
        }
      }
    );

    if (updateResult.matchedCount <= 0) {
      res.status(402).json({
        success: false,
        message: `Failed to set claiming for account ${address}.`
      });
      return;
    }

    const updated = await collection.findOne({ address });
    res.status(200).json({
      success: true,
      message: 'Previous burn verified and conversion started.',
      user: updated
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
}
