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

const resolveAxferPayload = (txn: any) =>
  txn['asset-transfer-transaction'] ??
  (txn as Record<string, any>)['asset_transfer_transaction'] ??
  (txn as Record<string, any>).assetTransferTransaction ??
  (txn as Record<string, any>).asset_transfer_transaction;

const readAssetId = (axfer: Record<string, any>) =>
  axfer['asset-id'] ??
  axfer['asset_id'] ??
  axfer.assetId ??
  axfer.asset_id ??
  axfer['assetId'];

const readAmount = (axfer: Record<string, any>) =>
  axfer['amount'] ??
  axfer.amount ??
  axfer['amount-base'] ??
  axfer['amount_base'];

const readReceiver = (axfer: Record<string, any>) =>
  axfer['receiver'] ?? axfer.receiver;

const validateBurnTxn = (
  txn: any,
  expectedMicroAmount: number,
  address: string
) => {
  if (!txn) return 'Missing transaction payload.';
  if (txn['sender'] !== address) return 'Unauthorized Transaction.';
  const axfer = resolveAxferPayload(txn);
  if (!axfer) {
    console.log('[reconcileFryBurn] validation missing axfer', {
      id: txn?.id ?? txn?.tx ?? null,
      keys: txn ? Object.keys(txn) : null
    });
    return 'Invalid Transaction Type.';
  }

  const rawAssetId = readAssetId(axfer);
  const assetId = normalizeAssetId(rawAssetId);
  const expectedAssetId = normalizeAssetId(FRY_1.id);
  if (assetId !== expectedAssetId) {
    console.log('[reconcileFryBurn] validation asset mismatch', {
      txId: txn?.id ?? txn?.tx ?? null,
      actual: rawAssetId,
      normalized: assetId,
      expected: expectedAssetId,
      axferKeys: Object.keys(axfer || {})
    });
    return 'Invalid Asset ID for burn transaction.';
  }

  const receiver = readReceiver(axfer);
  if (receiver !== BURN_WALLET) {
    console.log('[reconcileFryBurn] validation receiver mismatch', {
      txId: txn?.id ?? txn?.tx ?? null,
      receiver,
      expected: BURN_WALLET
    });
    return 'Unauthorized Receiver.';
  }

  const amountRaw = readAmount(axfer);
  const amountValue =
    typeof amountRaw === 'number' ? amountRaw : Number(amountRaw);
  if (Number.isNaN(amountValue) || amountValue <= 0) {
    console.log('[reconcileFryBurn] validation amount invalid', {
      txId: txn?.id ?? txn?.tx ?? null,
      amountRaw
    });
    return 'Invalid Transfer Amount.';
  }
  if (amountValue !== expectedMicroAmount) {
    console.log('[reconcileFryBurn] validation amount mismatch', {
      txId: txn?.id ?? txn?.tx ?? null,
      amountValue,
      expectedMicroAmount
    });
    return 'Invalid Transfer Amount.';
  }

  return undefined;
};

const findBurnWithSearch = async (
  address: string,
  expectedMicro: number,
  maxPages = 5,
  pageLimit = 200
) => {
  const normalizedFryId = normalizeAssetId(FRY_1.id);
  let nextToken: string | undefined;

  for (let page = 0; page < maxPages; page++) {
    const builder = indexerClient
      .searchForTransactions()
      .address(address)
      .addressRole('sender')
      .txType('axfer')
      .assetID(Number(FRY_1.id))
      .limit(pageLimit);

    if (nextToken) {
      builder.nextToken(nextToken);
    }

    const search = await builder.do();

    const transactions: any[] = search.transactions || [];
    console.log('[reconcileFryBurn] search page', {
      page,
      fetched: transactions.length,
      next: search['next-token'] ? true : false
    });

    const candidates = transactions.filter((txn) => {
      const axfer = resolveAxferPayload(txn);
      if (!axfer) return false;
      const rawAssetId = readAssetId(axfer);
      const assetId = normalizeAssetId(rawAssetId);
      if (assetId !== normalizedFryId) return false;
      const receiver = readReceiver(axfer);
      if (receiver !== BURN_WALLET) return false;

      const amountRaw = readAmount(axfer);
      const amountValue =
        typeof amountRaw === 'number' ? amountRaw : Number(amountRaw);

      return !Number.isNaN(amountValue) && amountValue === expectedMicro;
    });

    console.log('[reconcileFryBurn] page candidates', {
      page,
      matching: candidates.length,
      firstMatchId: candidates[0]?.id || candidates[0]?.tx || null
    });

    if (candidates.length) {
      return candidates[0];
    }

    nextToken = search['next-token'] as string | undefined;
    if (!nextToken) {
      break;
    }
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

  const normalizedTxId =
    typeof txId === 'string' && txId.trim().length > 0 ? txId.trim() : undefined;

  console.log('[reconcileFryBurn] start', {
    address: trimmedAddress,
    hasTxId: Boolean(normalizedTxId)
  });

  const client = await clientPromise;
  const db = client.db('main');
  const collection: Collection<ConversionDoc> = db.collection('fry-conversions');

  const user = await collection.findOne({ address: trimmedAddress });
  console.log('[reconcileFryBurn] user lookup', {
    found: Boolean(user),
    status: user?.status,
    amount: user?.amount
  });

  if (!user) {
    throw new ReconcileBurnError('Not Existed Account For Conversion.', 401);
  }

  const baseAmount =
    typeof user.amount === 'number' ? user.amount : parseFloat(String(user.amount));
  if (!Number.isFinite(baseAmount) || baseAmount <= 0) {
    throw new ReconcileBurnError('Not Enough Balance For Conversion.', 401);
  }

  if (user.status === 'pending') {
    console.log('[reconcileFryBurn] already pending', {
      address: trimmedAddress
    });
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

  console.log('[reconcileFryBurn] expected micro amount', {
    baseAmount,
    expectedMicro
  });

  let burnTxn: any;
  let finalTxId: string | undefined = normalizedTxId;

  if (normalizedTxId) {
    console.log('[reconcileFryBurn] validating explicit txId');
    const txn = await lookupWithRetry(normalizedTxId);
    const validationErr = validateBurnTxn(txn, expectedMicro, trimmedAddress);
    if (validationErr) {
      console.log('[reconcileFryBurn] explicit txId validation failed', {
        validationErr
      });
      throw new ReconcileBurnError(validationErr, 401);
    }
    burnTxn = txn;
    finalTxId = typeof txn.id === 'string' ? txn.id : normalizedTxId;
    console.log('[reconcileFryBurn] explicit txId validated', {
      finalTxId
    });
  } else {
    console.log('[reconcileFryBurn] searching indexer for burn', {
      limitPerPage: 200
    });

    burnTxn = await findBurnWithSearch(trimmedAddress, expectedMicro);

    if (!burnTxn) {
      throw new ReconcileBurnError(
        'No matching burn transaction found. If you already burned, provide the transaction ID.',
        404
      );
    }

    const validationErr = validateBurnTxn(burnTxn, expectedMicro, trimmedAddress);
    if (validationErr) {
      console.log('[reconcileFryBurn] discovered tx validation failed', {
        validationErr,
        txId: burnTxn.id ?? burnTxn.tx
      });
      throw new ReconcileBurnError(validationErr, 401);
    }
    finalTxId =
      typeof burnTxn.id === 'string'
        ? burnTxn.id
        : typeof burnTxn['tx'] === 'string'
        ? burnTxn['tx']
        : finalTxId;
    console.log('[reconcileFryBurn] discovered tx validated', {
      finalTxId
    });
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

  console.log('[reconcileFryBurn] update result', {
    matched: updateResult.matchedCount,
    modified: updateResult.modifiedCount
  });

  if (updateResult.matchedCount <= 0) {
    throw new ReconcileBurnError(
      `Failed to set claiming for account ${trimmedAddress}.`,
      402
    );
  }

  const updated = await collection.findOne({ address: trimmedAddress });
  console.log('[reconcileFryBurn] fetch updated user', {
    success: Boolean(updated)
  });

  if (!updated) {
    throw new ReconcileBurnError('Failed to load updated conversion document.', 500);
  }

  console.log('[reconcileFryBurn] success', {
    address: trimmedAddress,
    finalTxId
  });

  return {
    success: true,
    message: 'Previous burn verified and conversion started.',
    user: updated,
    burnTxnId: finalTxId
  };
};
