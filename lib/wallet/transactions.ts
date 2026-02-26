import algosdk, {
  SuggestedParams,
  Transaction,
  makePaymentTxnWithSuggestedParamsFromObject,
  makeAssetTransferTxnWithSuggestedParamsFromObject
} from 'algosdk';
import { getAlgodClient } from './clients';
import type { SupportedNetwork } from './config';

export interface BaseTxnParams {
  sender: string;
  suggestedParams?: SuggestedParams;
  note?: Uint8Array;
  network?: SupportedNetwork;
}

export interface PaymentTxnParams extends BaseTxnParams {
  receiver: string;
  amount: number;
  useMicroAlgos?: boolean;
}

export interface AssetTransferTxnParams extends BaseTxnParams {
  receiver: string;
  assetId: number;
  amount: number;
  decimals?: number;
  useRawAmount?: boolean;
}

export interface OptInTxnParams extends BaseTxnParams {
  assetId: number;
}

const encodeUnsigned = (txn: Transaction): Uint8Array =>
  algosdk.encodeUnsignedTransaction(txn);

const resolveSuggestedParams = async (
  params: BaseTxnParams
): Promise<SuggestedParams> => {
  if (params.suggestedParams) {
    return params.suggestedParams;
  }
  const algod = getAlgodClient(params.network);
  return algod.getTransactionParams().do();
};

export const buildPaymentTxn = async (
  params: PaymentTxnParams
): Promise<Uint8Array> => {
  const suggestedParams = await resolveSuggestedParams(params);
  const amount = params.useMicroAlgos
    ? Math.round(params.amount)
    : Math.round(params.amount * 1_000_000);

  const txn = makePaymentTxnWithSuggestedParamsFromObject({
    sender: params.sender,
    receiver: params.receiver,
    amount,
    note: params.note,
    suggestedParams
  });

  return encodeUnsigned(txn);
};

export const buildAssetTransferTxn = async (
  params: AssetTransferTxnParams
): Promise<Uint8Array> => {
  const suggestedParams = await resolveSuggestedParams(params);
  const decimals = params.decimals ?? 6;
  const rawAmount = params.useRawAmount
    ? params.amount
    : Math.round(params.amount * 10 ** decimals);

  const txn = makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender: params.sender,
    receiver: params.receiver,
    amount: rawAmount,
    assetIndex: params.assetId,
    note: params.note,
    suggestedParams
  });

  return encodeUnsigned(txn);
};

/**
 * Builds an ASA opt-in transaction.
 * An opt-in is a 0-amount asset transfer from the sender to themselves.
 */
export const buildOptInTxn = async (
  params: OptInTxnParams
): Promise<Uint8Array> => {
  const suggestedParams = await resolveSuggestedParams(params);

  const txn = makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender: params.sender,
    receiver: params.sender, // Self-transfer for opt-in
    amount: 0,               // Zero amount = opt-in
    assetIndex: params.assetId,
    note: params.note,
    suggestedParams
  });

  return encodeUnsigned(txn);
};
