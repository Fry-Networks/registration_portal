import algosdk, { Account, Algodv2 } from 'algosdk';

// Shared helpers for custodial signing paths (mnemonic-derived service accounts).

export type MnemonicAccount = Account;

const resolveMnemonic = (envVar: string, label: string): string => {
  const value = process.env[envVar];
  if (!value || typeof value !== 'string') {
    throw new Error(
      `[custodial] Missing ${label} mnemonic. Set the "${envVar}" environment variable to a valid 25-word mnemonic.`
    );
  }
  return value.trim();
};

export const getAccountFromMnemonic = (mnemonic: string): MnemonicAccount => {
  return algosdk.mnemonicToSecretKey(mnemonic);
};

export const decodeUnsignedTransaction = (encodedTxn: Uint8Array): algosdk.Transaction => {
  return algosdk.decodeUnsignedTransaction(encodedTxn);
};

export const signDecodedTransaction = (
  txn: algosdk.Transaction,
  account: MnemonicAccount
): Uint8Array => {
  return txn.signTxn(account.sk);
};

export const signDecodedGroup = (
  txns: algosdk.Transaction[],
  account: MnemonicAccount
): Uint8Array[] => {
  return txns.map((txn) => signDecodedTransaction(txn, account));
};

export interface MnemonicAccountPair {
  account: MnemonicAccount;
  signer: MnemonicAccount;
  address: string;
}

export interface MnemonicAccountPairConfig {
  mnemonicEnv: string;
  rekeyEnv?: string;
  label: string;
}

// Central helper to derive both the original account and the active signer (handles rekeys).
export const loadMnemonicAccountPair = ({
  mnemonicEnv,
  rekeyEnv,
  label
}: MnemonicAccountPairConfig): MnemonicAccountPair => {
  const account = getAccountFromMnemonic(resolveMnemonic(mnemonicEnv, label));
  const signerMnemonic = rekeyEnv ? resolveMnemonic(rekeyEnv, label) : null;
  const signer = signerMnemonic ? getAccountFromMnemonic(signerMnemonic) : account;

  return {
    account,
    signer,
    address: account.addr.toString()
  };
};

export interface CustodialSubmissionConfig extends MnemonicAccountPairConfig {
  algod: Algodv2;
  transactions: algosdk.Transaction[];
  assignGroupId?: boolean;
  waitRounds?: number;
}

export interface CustodialSubmissionResult {
  txId: string;
  signedTransactions: Uint8Array[];
}

// Shared submission pipeline so every custodial API signs/groups/broadcasts the same way.
export const signAndSubmitCustodialTransactions = async ({
  mnemonicEnv,
  rekeyEnv,
  label,
  algod,
  transactions,
  assignGroupId = true,
  waitRounds = 4
}: CustodialSubmissionConfig): Promise<CustodialSubmissionResult> => {
  if (!Array.isArray(transactions) || transactions.length === 0) {
    throw new Error('[custodial] No transactions supplied for signing.');
  }

  const { signer } = loadMnemonicAccountPair({ mnemonicEnv, rekeyEnv, label });

  if (assignGroupId) {
    algosdk.assignGroupID(transactions);
  }

  const signedTransactions = signDecodedGroup(transactions, signer);
  const { txid } = await algod.sendRawTransaction(signedTransactions).do();

  if (waitRounds && waitRounds > 0) {
    await algosdk.waitForConfirmation(algod, txid, waitRounds);
  }

  return {
    txId: txid,
    signedTransactions
  };
};
