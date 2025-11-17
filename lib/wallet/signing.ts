import { getAlgodClient } from './clients';
import type { SupportedNetwork } from './config';
import { waitForFinalConfirmation } from './transactionConfirmation';

export interface WalletSigner {
  signTransactions: (
    transactions: Uint8Array[],
    opts?: Record<string, unknown>
  ) => Promise<Array<Uint8Array | string | null>>;
}

export interface TransactionSubmissionOptions {
  waitForConfirmation?: boolean;
  confirmationRounds?: number;
  network?: SupportedNetwork;
}

const coerceToBytes = (value: unknown): Uint8Array | null => {
  if (!value) return null;
  if (value instanceof Uint8Array) return value;
  if (typeof value === 'string' && value.length > 0) {
    try {
      const buf = Buffer.from(value, 'base64');
      return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    } catch {
      return null;
    }
  }
  return null;
};

export const signTransactionsWithWallet = async (
  signer: WalletSigner,
  encodedTransactions: Uint8Array[],
  opts?: Record<string, unknown>
): Promise<Uint8Array[]> => {
  const signed = await signer.signTransactions(encodedTransactions, opts);
  const bytes: Uint8Array[] = [];
  for (const entry of signed) {
    const payload = coerceToBytes(entry);
    if (payload) {
      bytes.push(payload);
    }
  }
  if (!bytes.length) {
    throw new Error('Wallet did not return any signed transactions.');
  }
  return bytes;
};

export const submitSignedTransactions = async (
  signedTransactions: Uint8Array[],
  {
    waitForConfirmation = false,
    confirmationRounds,
    network
  }: TransactionSubmissionOptions = {}
): Promise<string[]> => {
  const algod = getAlgodClient(network);
  const txIds: string[] = [];

  for (const signed of signedTransactions) {
    const { txid } = await algod.sendRawTransaction(signed).do();
    txIds.push(txid);
    if (waitForConfirmation) {
      await waitForFinalConfirmation(txid, {
        network,
        minConfirmations: confirmationRounds
      });
    }
  }

  return txIds;
};
