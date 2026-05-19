/**
 * Settlement execution - builds and submits vault settle() ABI call.
 *
 * Uses the admin.ts custodial signing pattern.
 * PAT and mnemonics resolved from env (1P op:// refs at container start).
 */
import algosdk from 'algosdk';
import crypto from 'crypto';
import { getAlgodClient } from '../wallet/clients';
import { getDefaultNetwork } from '../wallet/config';
import { loadMnemonicAccountPair } from '../algorand/admin';
import {
  getVaultAppId,
  getClaimWindowSec,
  GUARANTEE_MNEMONIC_ENV,
  GUARANTEE_REKEY_ENV,
} from './guaranteeConfig';

export interface SettlementParams {
  quoteId: string;
  walletAddress: string;
  targetAssetId: number;
  guaranteedAmount: number;
  settlementDeadline: number;
  shortfallAmount: number;
}

export interface SettlementResult {
  txId: string;
  confirmedRound: number;
  orderHash: string;
}

/**
 * Compute the bound settlement order hash.
 */
export function computeOrderHash(params: {
  quoteId: string;
  walletAddress: string;
  targetAssetId: number;
  guaranteedAmount: number;
  settlementDeadline: number;
}): Uint8Array {
  const h = crypto.createHash('sha256');
  h.update(params.quoteId);
  h.update(params.walletAddress);
  h.update(params.targetAssetId.toString());
  h.update(params.guaranteedAmount.toString());
  h.update(params.settlementDeadline.toString());
  return new Uint8Array(h.digest());
}

/** Encode a number as big-endian uint64 Uint8Array. */
function encodeUint64(n: number | bigint): Uint8Array {
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setBigUint64(0, BigInt(n));
  return new Uint8Array(buf);
}

/** Encode dynamic bytes for ABI (2-byte length prefix + data). */
function encodeDynamicBytes(data: Uint8Array): Uint8Array {
  const result = new Uint8Array(2 + data.length);
  result[0] = (data.length >> 8) & 0xff;
  result[1] = data.length & 0xff;
  result.set(data, 2);
  return result;
}

/** Concatenate Uint8Arrays. */
function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((s, a) => s + a.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

/**
 * Execute vault settlement - send shortfall FRY to user.
 */
export async function executeSettlement(params: SettlementParams): Promise<SettlementResult> {
  if (!getVaultAppId()) {
    throw new Error('getVaultAppId() not configured');
  }

  const { signer } = loadMnemonicAccountPair({
    mnemonicEnv: GUARANTEE_MNEMONIC_ENV,
    rekeyEnv: GUARANTEE_REKEY_ENV,
    label: 'guarantee-settlement',
  });

  const algod = getAlgodClient(getDefaultNetwork());
  const sp = await algod.getTransactionParams().do();
  sp.flatFee = true;
  sp.fee = BigInt(2000);

  const orderHash = computeOrderHash(params);

  // ABI method selector for settle(byte[],address,uint64,uint64,uint64)void
  const selector = new Uint8Array([0x85, 0x47, 0x21, 0xdf]);

  // Encode ABI args as separate app_args entries
  const orderHashArg = encodeDynamicBytes(orderHash);
  const receiverArg = algosdk.decodeAddress(params.walletAddress).publicKey;
  const assetIdArg = encodeUint64(params.targetAssetId);
  const amountArg = encodeUint64(params.shortfallAmount);
  const expiryArg = encodeUint64(params.settlementDeadline);

  // Box reference for replay protection
  const boxPrefix = new Uint8Array([0x73, 0x74, 0x6c, 0x5f]); // "stl_"
  const boxName = concatBytes(boxPrefix, orderHash);

  const appCallTxn = algosdk.makeApplicationCallTxnFromObject({
    sender: signer.addr.toString(),
    appIndex: getVaultAppId(),
    onComplete: algosdk.OnApplicationComplete.NoOpOC,
    appArgs: [selector, orderHashArg, receiverArg, assetIdArg, amountArg, expiryArg],
    accounts: [params.walletAddress],
    foreignAssets: [params.targetAssetId],
    boxes: [{ appIndex: getVaultAppId(), name: boxName }],
    suggestedParams: sp,
  });

  const signedTxn = appCallTxn.signTxn(signer.sk);
  const { txid } = await algod.sendRawTransaction(signedTxn).do();
  const result = await algosdk.waitForConfirmation(algod, txid, 6);

  return {
    txId: txid,
    confirmedRound: Number(result.confirmedRound || result['confirmed-round'] || 0),
    orderHash: Array.from(orderHash).map(b => b.toString(16).padStart(2, '0')).join(''),
  };
}

export interface CertificateParams {
  quoteId: string;
  walletAddress: string;
  targetAssetId: number;
  guaranteedAmount: number;
  settlementDeadline: number;
  shortfallAmount: number;
}

/**
 * Write a settlement certificate to the vault contract.
 * User claims later via on-chain claim() call.
 */
export async function writeCertificate(params: CertificateParams): Promise<SettlementResult> {
  if (!getVaultAppId()) {
    throw new Error('getVaultAppId() not configured');
  }

  const { signer } = loadMnemonicAccountPair({
    mnemonicEnv: GUARANTEE_MNEMONIC_ENV,
    rekeyEnv: GUARANTEE_REKEY_ENV,
    label: 'guarantee-settlement',
  });

  const algod = getAlgodClient(getDefaultNetwork());
  const sp = await algod.getTransactionParams().do();
  sp.flatFee = true;
  sp.fee = BigInt(2000);

  const orderHash = computeOrderHash(params);

  // ABI method selector for write_certificate(byte[],address,uint64,uint64,uint64)void
  const selector = new Uint8Array([0x5a, 0x14, 0x82, 0xc3]);

  const orderHashArg = encodeDynamicBytes(orderHash);
  const beneficiaryArg = algosdk.decodeAddress(params.walletAddress).publicKey;
  const assetIdArg = encodeUint64(params.targetAssetId);
  const amountArg = encodeUint64(params.shortfallAmount);

  // Claim deadline: current time + claim window (7 days default)
  const claimDeadline = Math.floor(Date.now() / 1000) + getClaimWindowSec();
  const deadlineArg = encodeUint64(claimDeadline);

  // Box reference for certificate storage
  const boxPrefix = new Uint8Array([0x63, 0x65, 0x72, 0x74, 0x5f]); // "cert_"
  const boxName = concatBytes(boxPrefix, orderHash);

  const appCallTxn = algosdk.makeApplicationCallTxnFromObject({
    sender: signer.addr.toString(),
    appIndex: getVaultAppId(),
    onComplete: algosdk.OnApplicationComplete.NoOpOC,
    appArgs: [selector, orderHashArg, beneficiaryArg, assetIdArg, amountArg, deadlineArg],
    accounts: [params.walletAddress],
    foreignAssets: [params.targetAssetId],
    boxes: [{ appIndex: getVaultAppId(), name: boxName }],
    suggestedParams: sp,
  });

  const signedTxn = appCallTxn.signTxn(signer.sk);
  const { txid } = await algod.sendRawTransaction(signedTxn).do();
  const result = await algosdk.waitForConfirmation(algod, txid, 6);

  return {
    txId: txid,
    confirmedRound: Number(result.confirmedRound || result['confirmed-round'] || 0),
    orderHash: Array.from(orderHash).map(b => b.toString(16).padStart(2, '0')).join(''),
  };
}
