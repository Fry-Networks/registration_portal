import { useState } from 'react';
import algosdk from 'algosdk';
import { useWalletActions } from '../lib/wallet/useWalletActions';
import { getAlgodClient } from '../lib/wallet/clients';
import { startConfirmationWatcher } from '../lib/confirmWatcher';
import { useToastContext } from '../hooks/ToastContext';

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

            <div className="flex gap-4">
              <button
                onClick={handleClaim}
                disabled={isLoading}
                className="flex-1 bg-blue-600 text-white py-2 px-4 rounded font-semibold disabled:opacity-50"
              >
                {isLoading ? 'Submitting...' : 'Claim'}
              </button>
              <button
                onClick={onClose}
                disabled={isLoading}
                className="flex-1 bg-gray-300 text-gray-700 py-2 px-4 rounded font-semibold disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
