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

export interface UserPaysAssetLeg {
  assetId: number;
  rewardAmount: number; // raw micro-units of the reward asset
}

export interface UserPaysFeeLeg {
  assetId: number;
  amount: number; // raw micro-units of the FFG holder-cut
  receiver: string; // fee sink (U5TA)
  noteB64?: string; // base64 note (e.g. "ffg-fee:v1")
}

export interface UserPaysClaimGroupConfig extends MnemonicAccountPairConfig {
  algod: Algodv2;
  claimingAddress: string;
  assetLegs: UserPaysAssetLeg[]; // one vault -> user ASA transfer per reward asset (amount = payout)
  gasPaymentMicroAlgo: number; // ALGO (micro) the user pays to the vault to cover ALL group fees
  feeLegs?: UserPaysFeeLeg[]; // optional FFG holder-cut legs (vault -> sink), vault-signed, in-group
}

export interface UserPaysClaimGroupResult {
  groupId: string;
  unsignedUserLegB64: string; // leg0: user -> vault ALGO payment (user signs client-side)
  signedServerLegsB64: string[]; // legs 1..N: vault -> user ASA transfers (already server-signed)
  unsignedServerLegsB64: string[]; // legs 1..N unsigned; client presents the full group to the wallet (ARC-1)
  expected: {
    receiver: string; // vault address the user payment must go to
    amountMicroAlgo: number;
    assetLegs: UserPaysAssetLeg[];
  };
}

// User-pays-gas claim group builder. Builds a (1+N)-txn atomic group:
//   leg0    = user -> vault ALGO payment (ALL fees pooled here: (1+N) x minFee, flatFee),
//   legs1..N = vault -> user ASA transfer per reward asset (fee 0, flatFee) — vault pays zero gas.
// Group id is assigned across all legs; ONLY the vault legs are signed here (custodial rekey
// signer). leg0 is returned unsigned for the user's wallet to sign; confirm reassembles+submits.
export const buildUserPaysClaimGroup = async ({
  mnemonicEnv,
  rekeyEnv,
  label,
  algod,
  claimingAddress,
  assetLegs,
  gasPaymentMicroAlgo,
  feeLegs = []
}: UserPaysClaimGroupConfig): Promise<UserPaysClaimGroupResult> => {
  if (!Array.isArray(assetLegs) || assetLegs.length === 0) {
    throw new Error('[user-pays] No asset legs supplied for claim group.');
  }
  const { signer, address: vaultAddress } = loadMnemonicAccountPair({ mnemonicEnv, rekeyEnv, label });

  const base = await algod.getTransactionParams().do();
  const minFee = Number((base as any).minFee ?? 1000) || 1000;
  // leg0 (user payment) pools ALL group fees: 1 (leg0) + N reward legs + M FFG fee legs.
  const legCount = 1 + assetLegs.length + feeLegs.length;
  const leg0Params = { ...base, flatFee: true, fee: legCount * minFee } as algosdk.SuggestedParams;
  const zeroFeeParams = { ...base, flatFee: true, fee: 0 } as algosdk.SuggestedParams;

  const leg0 = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    sender: claimingAddress,
    receiver: vaultAddress,
    amount: gasPaymentMicroAlgo,
    suggestedParams: leg0Params
  });
  const vaultLegs = assetLegs.map((leg) =>
    algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      sender: vaultAddress,
      receiver: claimingAddress,
      assetIndex: leg.assetId,
      amount: leg.rewardAmount,
      suggestedParams: zeroFeeParams
    })
  );
  // FFG holder-cut legs (vault -> sink), vault-signed, fee 0 (covered by leg0).
  const feeTxns = feeLegs.map((leg) =>
    algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      sender: vaultAddress,
      receiver: leg.receiver,
      assetIndex: leg.assetId,
      amount: leg.amount,
      note: leg.noteB64 ? new Uint8Array(Buffer.from(leg.noteB64, 'base64')) : undefined,
      suggestedParams: zeroFeeParams
    })
  );

  const serverLegs = [...vaultLegs, ...feeTxns];
  algosdk.assignGroupID([leg0, ...serverLegs]);
  const signedServerLegsB64 = serverLegs.map((t) => Buffer.from(t.signTxn(signer.sk)).toString('base64'));

  return {
    groupId: Buffer.from(leg0.group as Uint8Array).toString('base64'),
    unsignedUserLegB64: Buffer.from(algosdk.encodeUnsignedTransaction(leg0)).toString('base64'),
    signedServerLegsB64,
    unsignedServerLegsB64: serverLegs.map((t) => Buffer.from(algosdk.encodeUnsignedTransaction(t)).toString('base64')),
    expected: {
      receiver: vaultAddress,
      amountMicroAlgo: gasPaymentMicroAlgo,
      assetLegs
    }
  };
};
