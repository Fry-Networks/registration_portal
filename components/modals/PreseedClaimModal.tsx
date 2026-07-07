import { useState } from 'react';
import algosdk from 'algosdk';
import { useWalletActions } from '../../lib/wallet/useWalletActions';
import { getAlgodClient } from '../../lib/wallet/clients';
import { startConfirmationWatcher } from '../../lib/confirmWatcher';
import { useToastContext } from '../../hooks/ToastContext';

// V1 FryMinerRewardPool (live). FRY3 flip: change to 3622586363 (V2) + rebuild.
const APP_ID = 3592975326;
const BUDGET_APP_ID = 3592977322;
const APP_ADDR = 'RZCYARBYGBWCWXZPAAGPCNOLVSCJCVTSXANIF2BSVPDE3YRK2SJMWUNC74';
const TFRY_ID = 2681521901;
const FNODE_ID = 2485202024;

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

interface PreseedClaimModalProps {
  proofData: {
    leaf_index: number;
    proof: string;
    entitled_tfry: number;
    entitled_fnode: number;
  };
  onClose: () => void;
}

export default function PreseedClaimModal({ proofData, onClose }: PreseedClaimModalProps) {
  const { activeAddress, signAndSubmit } = useWalletActions();
  const { success: toastSuccess, info, error: toastError } = useToastContext();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function buildPreseedClaimGroup(): Promise<Uint8Array[]> {
    if (!activeAddress) throw new Error('Wallet not connected');
    
    const algod = getAlgodClient();
    const sp = await algod.getTransactionParams().do();

    const method = algosdk.ABIMethod.fromSignature(
      'claim_preseed(uint64,uint64,byte[],uint64,pay,uint64,uint64)void'
    );

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

    atc.addMethodCall({
      appID: APP_ID,
      method,
      sender: activeAddress,
      suggestedParams: { ...sp, flatFee: true, fee: 3000 },
      signer: emptySigner,
      methodArgs: [
        BigInt(proofData.entitled_tfry),
        BigInt(proofData.entitled_fnode),
        hexToBytes(proofData.proof),
        BigInt(proofData.leaf_index),
        {
          txn: algosdk.makePaymentTxnWithSuggestedParamsFromObject({
            sender: activeAddress,
            receiver: APP_ADDR,
            amount: 100_000,
            suggestedParams: { ...sp, flatFee: true, fee: 1000 },
          }),
          signer: emptySigner,
        },
        BigInt(TFRY_ID),
        BigInt(FNODE_ID),
      ],
      boxes: [{
        appIndex: APP_ID,
        name: new Uint8Array([0x77, ...algosdk.decodeAddress(activeAddress).publicKey]),
      }],
      appForeignAssets: [TFRY_ID, FNODE_ID],
    });

    const group = atc.buildGroup();
    return group.map(ts => algosdk.encodeUnsignedTransaction(ts.txn));
  }

  async function handleClaim() {
    try {
      setIsLoading(true);
      setError(null);

      const encodedTxns = await buildPreseedClaimGroup();
      const result = await signAndSubmit(encodedTxns);
      
      info({ heading: 'Submission', message: 'Claim submitted! Waiting for confirmation...' });
      
      if (result && result.length > 0) {
        await startConfirmationWatcher(result[0], async () => {
          setSuccess(true);
          toastSuccess({ heading: 'Success', message: 'Preseed reward claimed!' });
          setTimeout(() => onClose(), 1500);
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

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-lg p-6 max-w-md w-full">
        <h2 className="text-2xl font-bold mb-4">Confirm Claim</h2>

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

        {!success && (
          <>
            <p className="text-gray-600 mb-6">
              Ready to claim {(proofData.entitled_tfry / 1e6).toFixed(2)} tFRY and {(proofData.entitled_fnode / 1e6).toFixed(2)} fNODE
            </p>

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
