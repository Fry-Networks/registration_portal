import type { Collection } from 'mongodb';
import clientPromise from '../mongoclient';
import {
  indexerClient,
  BURN_WALLET,
  FRY_1,
  normalizeAssetId
} from '../utils';

type ConversionDoc = Record<string, any> & {
  address: string;
  amount: number | string;
  status?: string;
};

export class ReconcileBurnError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export interface ReconcileBurnParams {
  address: string;
  txId?: string;
}

export interface ReconcileBurnSuccess {
  success: true;
  message: string;
  user: ConversionDoc;
  burnTxnId?: string;
  alreadyPending?: boolean;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const lookupWithRetry = async (
  id: string,
  maxAttempts = 8,
  delayMs = 1000
) => {
  let lastErr: unknown = null;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await indexerClient.lookupTransactionByID(id).do();
      if (res && res.transaction) return res.transaction;
    } catch (error) {
      lastErr = error;
    }
    await wait(delayMs);
  }
  if (lastErr instanceof Error) {
    throw new ReconcileBurnError(
      `Indexer lookup failed: ${lastErr.message}`,
      502
    );
  }
  throw new ReconcileBurnError('Transaction not found by indexer', 404);
};

const validateBurnTxn = (
  txn: any,
  expectedMicroAmount: number,
  address: string
) => {
  if (!txn) return 'Missing transaction payload.';
  if (txn['sender'] !== address) return 'Unauthorized Transaction.';
  if (!txn['asset-transfer-transaction']) return 'Invalid Transaction Type.';
  const axfer = txn['asset-transfer-transaction'];
  if (!axfer) return 'Invalid Transaction Type.';

  const assetId = normalizeAssetId(axfer['asset-id']);
  if (assetId !== normalizeAssetId(FRY_1.id)) {
    return 'Invalid Asset ID for burn transaction.';
  }
  if (axfer['receiver'] !== BURN_WALLET) {
    return 'Unauthorized Receiver.';
  }

  const amountValue =
    typeof axfer['amount'] === 'number' ? axfer['amount'] : Number(axfer['amount']);
  if (Number.isNaN(amountValue) || amountValue <= 0) {
    return 'Invalid Transfer Amount.';
  }
  if (amountValue !== expectedMicroAmount) {
    return 'Invalid Transfer Amount.';
  }

  return undefined;
};

export const reconcileFryBurn = async ({
  address,
  txId
}: ReconcileBurnParams): Promise<ReconcileBurnSuccess> => {
  const trimmedAddress = address?.trim();
  if (!trimmedAddress) {
    throw new ReconcileBurnError('Wallet address is required.', 400);
  }

  const client = await clientPromise;
  const db = client.db('main');
  const collection: Collection<ConversionDoc> = db.collection('fry-conversions');

  const user = await collection.findOne({ address: trimmedAddress });
  if (!user) {
    throw new ReconcileBurnError('Not Existed Account For Conversion.', 401);
  }

  const baseAmount =
    typeof user.amount === 'number' ? user.amount : parseFloat(String(user.amount));
  if (!Number.isFinite(baseAmount) || baseAmount <= 0) {
    throw new ReconcileBurnError('Not Enough Balance For Conversion.', 401);
  }

  if (user.status === 'pending') {
    return {
      success: true,
      message: 'Already started conversion.',
      user,
      alreadyPending: true
    };
  }

  const expectedMicro = Math.floor(baseAmount * Math.pow(10, FRY_1.decimals));
  if (expectedMicro <= 0) {
    throw new ReconcileBurnError('Invalid conversion amount configured.', 500);
  }

  let burnTxn: any;
  let finalTxId: string | undefined = txId;

  if (txId) {
    const txn = await lookupWithRetry(txId);
    const validationErr = validateBurnTxn(txn, expectedMicro, trimmedAddress);
    if (validationErr) {
      throw new ReconcileBurnError(validationErr, 401);
    }
    burnTxn = txn;
    finalTxId = typeof txn.id === 'string' ? txn.id : txId;
  } else {
    const search = await indexerClient
      .searchForTransactions()
      .address(trimmedAddress)
      .addressRole('sender')
      .txType('axfer')
      .assetID(Number(FRY_1.id))
      .limit(50)
      .do();

    const normalizedFryId = normalizeAssetId(FRY_1.id);
    const candidates = (search.transactions || []).filter((txn: any) => {
      const axfer = txn['asset-transfer-transaction'];
      if (!axfer) return false;
      const assetId = normalizeAssetId(axfer['asset-id']);
      if (assetId !== normalizedFryId) return false;
      if (axfer['receiver'] !== BURN_WALLET) return false;

      const amountValue =
        typeof axfer['amount'] === 'number'
          ? axfer['amount']
          : Number(axfer['amount']);

      return !Number.isNaN(amountValue) && amountValue === expectedMicro;
    });

    if (!candidates.length) {
      throw new ReconcileBurnError(
        'No matching burn transaction found. If you already burned, provide the transaction ID.',
        404
      );
    }

    burnTxn = candidates[0];
    const validationErr = validateBurnTxn(burnTxn, expectedMicro, trimmedAddress);
    if (validationErr) {
      throw new ReconcileBurnError(validationErr, 401);
    }
    finalTxId =
      typeof burnTxn.id === 'string'
        ? burnTxn.id
        : typeof burnTxn['tx'] === 'string'
        ? burnTxn['tx']
        : finalTxId;
  }

  const updateResult = await collection.updateOne(
    { address: trimmedAddress },
    {
      $set: {
        status: 'pending',
        claimableAmount: 0,
        pendingAmount: user.amount,
        claimableMonths: 0,
        claimedMonths: 0
      },
      $unset: {
        supportReconcile: '',
        burnAttempted: '',
        burnAttemptedAt: ''
      }
    }
  );

  if (updateResult.matchedCount <= 0) {
    throw new ReconcileBurnError(
      `Failed to set claiming for account ${trimmedAddress}.`,
      402
    );
  }

  const updated = await collection.findOne({ address: trimmedAddress });
  if (!updated) {
    throw new ReconcileBurnError('Failed to load updated conversion document.', 500);
  }

  return {
    success: true,
    message: 'Previous burn verified and conversion started.',
    user: updated,
    burnTxnId: finalTxId
  };
};
