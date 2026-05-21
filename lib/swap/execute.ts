import algosdk from 'algosdk';
import { waitForFinalConfirmation } from '../wallet/transactionConfirmation';
import type { SupportedNetwork } from '../wallet/config';
import { getAlgodClient } from '../wallet/clients';
import { getDefaultNetwork } from '../wallet/config';

export interface WalletActionContext {
  activeAddress: string | null;
  signAndSubmit: (encodedTransactions: Uint8Array[], opts?: Record<string, unknown>) => Promise<string[]>;
  signTransactions: (encodedTransactions: Uint8Array[], opts?: Record<string, unknown>) => Promise<Uint8Array[]>;
}

export interface PrepareSwapResult {
  transactions: Uint8Array[];
  quoteId?: string;
  usedAggregator?: string;
}

function base64ToUint8Array(b64: string): Uint8Array {
  const binaryString = atob(b64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

export const checkAssetOptIn = async (address: string, assetId: number): Promise<boolean> => {
  const algod = getAlgodClient(getDefaultNetwork());
  const accountInfo = await algod.accountInformation(address).do();
  const assets = (accountInfo.assets || []) as Array<{ 'asset-id'?: number | bigint | string }>;
  return assets.some((asset) => Number(asset['asset-id']) === assetId);
};

export const buildAssetOptInTransaction = async (
  sender: string,
  assetId: number
): Promise<Uint8Array> => {
  const algod = getAlgodClient(getDefaultNetwork());
  const params = await algod.getTransactionParams().do();
  const txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender,
    receiver: sender,
    amount: 0,
    assetIndex: assetId,
    suggestedParams: params,
  });
  return algosdk.encodeUnsignedTransaction(txn);
};

export const prepareSwapTransactions = async (
  quote: any,
  sender: string,
  slippage?: number
): Promise<PrepareSwapResult> => {
  const res = await fetch('/api/swap/execute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ quote, sender, slippage }),
  });
  const data = await res.json();
  if (!data.success) {
    const err = new Error(data.error || 'Swap preparation failed');
    (err as any).errorType = data.errorType;
    (err as any).aggregatorErrors = data.aggregatorErrors;
    throw err;
  }
  return {
    transactions: data.transactions.map((b64: string) => base64ToUint8Array(b64)),
    quoteId: data.quoteId,
    usedAggregator: data.usedAggregator,
  };
};

export const executeSwap = async (
  preparedTxns: Uint8Array[],
  walletActions: WalletActionContext,
  opts?: { message?: string; network?: string }
): Promise<{ txIds: string[]; confirmed: boolean }> => {
  const txIds = await walletActions.signAndSubmit(preparedTxns, {
    message: opts?.message || 'Authorize swap',
  });
  const confirmation = await waitForFinalConfirmation(txIds[0], {
    network: opts?.network as SupportedNetwork,
    minConfirmations: 4,
  });
  return { txIds, confirmed: confirmation.confirmedRound > 0 };
};
