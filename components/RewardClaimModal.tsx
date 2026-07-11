import { useState, useEffect } from 'react';
import algosdk from 'algosdk';
import { useWalletActions } from '../lib/wallet/useWalletActions';
import { getAlgodClient } from '../lib/wallet/clients';
import { startConfirmationWatcher } from '../lib/confirmWatcher';
import { useToastContext } from '../hooks/ToastContext';
import {
  V2_APP_ID,
  V2_APP_ADDR,
  V2_FEE_ADDRESS,
  v2BoxName,
  readV2Box,
  readV2TokenRegistry,
  type TokenInfo,
} from '../lib/rewards/v2Box';

// V1 FryMinerRewardPool (live). V2 is App 3633170823 (N-token, deployed 2026-07-10).
const APP_ID = 3592975326;
const BUDGET_APP_ID = 3592977322;
const TFRY_ID = 2681521901;
const FNODE_ID = 2485202024;

interface ClaimableResponse {
  claimable_tfry: number;
  claimable_fnode: number;
  matured_tfry: number;
  matured_fnode: number;
  recent_tfry: number;
  recent_fnode: number;
  epoch: number;
}

interface V2TokenClaimable {
  index: number;
  asaId: number;
  name: string;
  entitled: number;
  matured: number;
  claimed: number;
  claimable: number;
  underfunded: boolean;
}

interface RewardClaimModalProps {
  wallet: string;
  onClose: () => void;
  onSuccess: () => void;
  initialData?: ClaimableResponse;
}

export default function RewardClaimModal({ wallet, onClose, onSuccess, initialData }: RewardClaimModalProps) {
  const { activeAddress, signAndSubmit } = useWalletActions();
  const { success: toastSuccess, info, error: toastError } = useToastContext();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [v2Tokens, setV2Tokens] = useState<V2TokenClaimable[]>([]);
  const [v2Registry, setV2Registry] = useState<TokenInfo[]>([]);

  useEffect(() => {
    const loadV2Data = async () => {
      try {
        const algod = getAlgodClient();
        const registry = await readV2TokenRegistry(algod);
        setV2Registry(registry);

        if (registry.length > 0 && activeAddress) {
          const boxState = await readV2Box(algod, activeAddress, registry.length);
          if (boxState) {
            const tokens: V2TokenClaimable[] = [];
            for (const token of registry) {
              const state = boxState.tokens[token.index];
              if (!state) continue;

              const claimable = Number(state.entitled - state.claimed);
              let underfunded = false;
              if (claimable > 0) {
                try {
                  const acctInfo = await algod.accountAssetInformation(V2_APP_ADDR, token.asaId).do();
                  const balance = acctInfo['asset-holding'].amount ?? 0;
                  if (balance < claimable) {
                    underfunded = true;
                  }
                } catch {
                  underfunded = true;
                }
              }

              tokens.push({
                index: token.index,
                asaId: token.asaId,
                name: token.name,
                entitled: Number(state.entitled),
                matured: Number(state.matured),
                claimed: Number(state.claimed),
                claimable,
                underfunded,
              });
            }
            setV2Tokens(tokens);
          }
        }
      } catch (err) {
        console.error('Error loading V2 data:', err);
      }
    };

    if (activeAddress) {
      loadV2Data();
    }
  }, [activeAddress]);

  async function buildClaimGroup(): Promise<Uint8Array[]> {
    if (!activeAddress) throw new Error('Wallet not connected');

    const algod = getAlgodClient();
    const sp = await algod.getTransactionParams().do();

    const method = algosdk.ABIMethod.fromSignature('claim(asset,asset)void');

    const atc = new algosdk.AtomicTransactionComposer();
    const emptySigner = algosdk.makeEmptyTransactionSigner();

    atc.addTransaction({
      txn: algosdk.makeApplicationNoOpTxnFromObject({
        sender: activeAddress,
        appIndex: BUDGET_APP_ID,
        suggestedParams: { ...sp, flatFee: true, fee: 1000 },
      }),
      signer: emptySigner,
    });

    const boxName = new Uint8Array([0x77, ...algosdk.decodeAddress(activeAddress).publicKey]);

    atc.addMethodCall({
      appID: APP_ID,
      method,
      sender: activeAddress,
      suggestedParams: { ...sp, flatFee: true, fee: 5000 },
      signer: emptySigner,
      methodArgs: [BigInt(TFRY_ID), BigInt(FNODE_ID)],
      boxes: [{ appIndex: APP_ID, name: boxName }],
      appForeignAssets: [TFRY_ID, FNODE_ID],
    });

    const group = atc.buildGroup();
    return group.map(ts => algosdk.encodeUnsignedTransaction(ts.txn));
  }

  async function buildClaimMaturedGroup(): Promise<Uint8Array[]> {
    if (!activeAddress) throw new Error('Wallet not connected');

    const algod = getAlgodClient();
    const sp = await algod.getTransactionParams().do();

    const method = algosdk.ABIMethod.fromSignature('claim_matured_only(asset,asset)void');

    const atc = new algosdk.AtomicTransactionComposer();
    const emptySigner = algosdk.makeEmptyTransactionSigner();

    atc.addTransaction({
      txn: algosdk.makeApplicationNoOpTxnFromObject({
        sender: activeAddress,
        appIndex: BUDGET_APP_ID,
        suggestedParams: { ...sp, flatFee: true, fee: 1000 },
      }),
      signer: emptySigner,
    });

    const boxName = new Uint8Array([0x77, ...algosdk.decodeAddress(activeAddress).publicKey]);

    atc.addMethodCall({
      appID: APP_ID,
      method,
      sender: activeAddress,
      suggestedParams: { ...sp, flatFee: true, fee: 5000 },
      signer: emptySigner,
      methodArgs: [BigInt(TFRY_ID), BigInt(FNODE_ID)],
      boxes: [{ appIndex: APP_ID, name: boxName }],
      appForeignAssets: [TFRY_ID, FNODE_ID],
    });

    const group = atc.buildGroup();
    return group.map(ts => algosdk.encodeUnsignedTransaction(ts.txn));
  }

  async function buildV2ClaimGroup(tokenIndex: number, amount: bigint, asaId: number): Promise<Uint8Array[]> {
    if (!activeAddress) throw new Error('Wallet not connected');

    const algod = getAlgodClient();
    const sp = await algod.getTransactionParams().do();

    const method = algosdk.ABIMethod.fromSignature('claim(pay,uint64,uint64)void');

    const atc = new algosdk.AtomicTransactionComposer();
    const emptySigner = algosdk.makeEmptyTransactionSigner();

    const pay = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
      sender: activeAddress,
      receiver: V2_APP_ADDR,
      amount: 3000,
      suggestedParams: { ...sp, flatFee: true, fee: 1000 },
    });

    atc.addMethodCall({
      appID: V2_APP_ID,
      method,
      sender: activeAddress,
      suggestedParams: { ...sp, flatFee: true, fee: 3000 },
      signer: emptySigner,
      methodArgs: [{ txn: pay, signer: emptySigner }, BigInt(tokenIndex), amount],
      boxes: [{ appIndex: V2_APP_ID, name: v2BoxName(activeAddress) }],
      appForeignAssets: [asaId],
      appAccounts: [V2_FEE_ADDRESS],
    });

    const group = atc.buildGroup();
    return group.map(ts => algosdk.encodeUnsignedTransaction(ts.txn));
  }

  async function handleClaim() {
    try {
      setIsLoading(true);
      setError(null);

      const encodedTxns = await buildClaimGroup();
      const result = await signAndSubmit(encodedTxns);

      info({ heading: 'Submission', message: 'Claim submitted! Waiting for confirmation...' });

      if (result && result.length > 0) {
        await startConfirmationWatcher(result[0], async () => {
          setSuccess(true);
          toastSuccess({ heading: 'Success', message: 'Rewards claimed!' });
          setTimeout(() => {
            onSuccess();
            onClose();
          }, 1500);
        });
      }
    } catch (err: any) {
      const errorMsg = err?.message || 'Claim failed';
      setError(errorMsg);
      toastError({ heading: 'Claim Failed', message: `Error: ${errorMsg}` });
    } finally {
      setIsLoading(false);
    }
  }

  async function handleClaimMatured() {
    try {
      setIsLoading(true);
      setError(null);

      const encodedTxns = await buildClaimMaturedGroup();
      const result = await signAndSubmit(encodedTxns);

      info({ heading: 'Submission', message: 'Matured claim submitted! Waiting for confirmation...' });

      if (result && result.length > 0) {
        await startConfirmationWatcher(result[0], async () => {
          setSuccess(true);
          toastSuccess({ heading: 'Success', message: 'Matured rewards claimed!' });
          setTimeout(() => {
            onSuccess();
            onClose();
          }, 1500);
        });
      }
    } catch (err: any) {
      const errorMsg = err?.message || 'Claim failed';
      setError(errorMsg);
      toastError({ heading: 'Claim Failed', message: `Error: ${errorMsg}` });
    } finally {
      setIsLoading(false);
    }
  }

  async function handleV2Claim(token: V2TokenClaimable) {
    try {
      setIsLoading(true);
      setError(null);

      const encodedTxns = await buildV2ClaimGroup(token.index, BigInt(token.claimable), token.asaId);
      const result = await signAndSubmit(encodedTxns);

      info({ heading: 'Submission', message: `${token.name} claim submitted! Waiting for confirmation...` });

      if (result && result.length > 0) {
        await startConfirmationWatcher(result[0], async () => {
          setSuccess(true);
          toastSuccess({ heading: 'Success', message: `${token.name} rewards claimed!` });
          setTimeout(() => {
            onSuccess();
            onClose();
          }, 1500);
        });
      }
    } catch (err: any) {
      const errorMsg = err?.message || 'Claim failed';
      setError(errorMsg);
      toastError({ heading: 'Claim Failed', message: `Error: ${errorMsg}` });
    } finally {
      setIsLoading(false);
    }
  }

  const data = initialData;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-lg p-6 max-w-md w-full">
        <h2 className="text-2xl font-bold mb-4">Claim Rewards</h2>

        {success && (
          <div className="bg-green-50 border border-green-200 rounded p-4 text-green-800 mb-4">
            ✓ Claim confirmed!
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded p-4 text-red-800 mb-4">
            {error}
          </div>
        )}

        {!success && data && (
          <>
            <div className="space-y-2 mb-6">
              <div className="flex justify-between">
                <span className="text-gray-600">tFRY claimable:</span>
                <span className="font-semibold">{(data.claimable_tfry / 1e6).toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">fNODE claimable:</span>
                <span className="font-semibold">{(data.claimable_fnode / 1e6).toFixed(2)}</span>
              </div>
              <div className="text-xs text-gray-400 mt-2">
                Matured (fee-free): {(data.matured_tfry / 1e6).toFixed(2)} tFRY / {(data.matured_fnode / 1e6).toFixed(2)} fNODE
                <br />
                Recent (30% fee): {(data.recent_tfry / 1e6).toFixed(2)} tFRY / {(data.recent_fnode / 1e6).toFixed(2)} fNODE
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex gap-2">
                <button
                  onClick={handleClaim}
                  disabled={isLoading}
                  className="flex-1 bg-blue-600 text-white py-2 px-4 rounded font-semibold disabled:opacity-50"
                >
                  {isLoading ? 'Submitting...' : 'Claim All'}
                </button>
                <button
                  onClick={handleClaimMatured}
                  disabled={isLoading || !data?.matured_tfry && !data?.matured_fnode}
                  className="flex-1 bg-green-600 text-white py-2 px-4 rounded font-semibold disabled:opacity-50"
                >
                  {isLoading ? 'Submitting...' : 'Claim Matured'}
                </button>
              </div>
              <button
                onClick={onClose}
                disabled={isLoading}
                className="w-full bg-gray-300 text-gray-700 py-2 px-4 rounded font-semibold disabled:opacity-50"
              >
                Cancel
              </button>
            </div>

            <p className="text-xs text-gray-400 mt-3">
              &ldquo;Claim All&rdquo; claims all rewards (matured + recent at 30% fee). &ldquo;Claim Matured&rdquo; claims only fee-free rewards.
            </p>
          </>
        )}

        {!success && v2Tokens.length > 0 && (
          <div className="border-t pt-6 mt-6">
            <h3 className="text-lg font-bold mb-4">V2 Rewards</h3>

            {v2Tokens.some(t => t.underfunded) && (
              <div className="bg-yellow-50 border border-yellow-200 rounded p-3 text-yellow-800 text-sm mb-4">
                ⚠️ V2 pool is being funded — some claims temporarily unavailable
              </div>
            )}

            <div className="space-y-3">
              {v2Tokens.map(token => (
                <div key={token.index} className="border rounded p-3">
                  <div className="flex justify-between items-center mb-2">
                    <span className="font-semibold">{token.name}</span>
                    <span className="text-sm text-gray-600">
                      {(token.claimable / 1e6).toFixed(2)} claimable
                    </span>
                  </div>
                  <button
                    onClick={() => handleV2Claim(token)}
                    disabled={isLoading || token.claimable === 0 || token.underfunded}
                    className="w-full bg-purple-600 text-white py-2 px-4 rounded font-semibold disabled:opacity-50"
                  >
                    {isLoading ? 'Submitting...' : `Claim ${token.name}`}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
