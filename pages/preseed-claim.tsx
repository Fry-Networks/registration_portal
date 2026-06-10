import { useSession } from 'next-auth/react';
import { useEffect, useState } from 'react';
import { useWalletActions } from '../lib/wallet/useWalletActions';
import { getAssetBalance } from '../lib/algorand/balances';
import PreseedClaimModal from '../components/modals/PreseedClaimModal';

const TFRY_ID = 2681521901;
const FNODE_ID = 2485202024;

interface ClaimStatus {
  eligible: boolean;
  reason?: string;
  entitled_tfry?: number;
  entitled_fnode?: number;
}

interface ProofData {
  eligible: boolean;
  leaf_index?: number;
  proof?: string;
  entitled_tfry?: number;
  entitled_fnode?: number;
}

export default function PreseedClaimPage() {
  const { data: session, status } = useSession();
  const { activeAddress } = useWalletActions();
  const [claimStatus, setClaimStatus] = useState<ClaimStatus | null>(null);
  const [proofData, setProofData] = useState<ProofData | null>(null);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [tfryOptedIn, setTfryOptedIn] = useState(false);
  const [fnodeOptedIn, setFnodeOptedIn] = useState(false);

  useEffect(() => {
    if (!session?.user?.address) {
      setLoading(false);
      return;
    }

    (async () => {
      try {
        const statusRes = await fetch(`/api/preseed/claim-status?wallet=${session.user.address}`);
        const statusData = await statusRes.json();
        setClaimStatus(statusData);

        if (statusData.eligible) {
          const proofRes = await fetch(`/api/preseed/proof?wallet=${session.user.address}`);
          const proofData = await proofRes.json();
          if (proofData.eligible) {
            setProofData(proofData);
          }
        }

        // Check opt-in status
        if (activeAddress) {
          const tfryBal = await getAssetBalance(activeAddress, TFRY_ID.toString());
          const fnodeBal = await getAssetBalance(activeAddress, FNODE_ID.toString());
          setTfryOptedIn(tfryBal !== null);
          setFnodeOptedIn(fnodeBal !== null);
        }
      } catch (err) {
        console.error('Claim status fetch error:', err);
        setClaimStatus({ eligible: false });
      } finally {
        setLoading(false);
      }
    })();
  }, [session, activeAddress]);

  if (status === 'loading' || loading) {
    return <div className="p-8">Loading...</div>;
  }

  if (!session) {
    return <div className="p-8">Please connect your wallet to claim preseed rewards.</div>;
  }

  if (!claimStatus?.eligible) {
    if (claimStatus?.reason === 'already_claimed') {
      return (
        <div className="max-w-2xl mx-auto p-8">
          <h1 className="text-3xl font-bold mb-6">Preseed Rewards</h1>
          <div className="bg-white rounded-lg shadow p-6 mb-6">
            <div className="grid grid-cols-2 gap-4 mb-6">
              <div>
                <p className="text-gray-600">Entitled tFRY</p>
                <p className="text-2xl font-bold">
                  {claimStatus.entitled_tfry ? (claimStatus.entitled_tfry / 1e6).toFixed(2) : '0'}
                </p>
              </div>
              <div>
                <p className="text-gray-600">Entitled fNODE</p>
                <p className="text-2xl font-bold">
                  {claimStatus.entitled_fnode ? (claimStatus.entitled_fnode / 1e6).toFixed(2) : '0'}
                </p>
              </div>
            </div>
            <div className="bg-green-50 border border-green-200 rounded p-4 mb-6">
              <p className="text-green-800 font-semibold">
                You have already claimed your preseed rewards.
              </p>
            </div>
          </div>
        </div>
      );
    }
    return <div className="p-8">Your wallet is not eligible for preseed rewards.</div>;
  }

  const needsOptIn = !tfryOptedIn || !fnodeOptedIn;

  return (
    <div className="max-w-2xl mx-auto p-8">
      <h1 className="text-3xl font-bold mb-6">Preseed Rewards</h1>

      <div className="bg-white rounded-lg shadow p-6 mb-6">
        <div className="grid grid-cols-2 gap-4 mb-6">
          <div>
            <p className="text-gray-600">Entitled tFRY</p>
            <p className="text-2xl font-bold">
              {claimStatus.entitled_tfry ? (claimStatus.entitled_tfry / 1e6).toFixed(2) : '0'}
            </p>
          </div>
          <div>
            <p className="text-gray-600">Entitled fNODE</p>
            <p className="text-2xl font-bold">
              {claimStatus.entitled_fnode ? (claimStatus.entitled_fnode / 1e6).toFixed(2) : '0'}
            </p>
          </div>
        </div>

        {needsOptIn && (
          <div className="bg-yellow-50 border border-yellow-200 rounded p-4 mb-6">
            <p className="text-yellow-800">
              Opt into tFRY and fNODE before claiming. You will be offered this option in the claim modal.
            </p>
          </div>
        )}

        <button
          onClick={() => setShowModal(true)}
          disabled={needsOptIn}
          className="w-full bg-blue-600 text-white py-2 px-4 rounded font-semibold disabled:opacity-50"
        >
          Claim Preseed Rewards
        </button>
      </div>

      {showModal && proofData && (
        <PreseedClaimModal
          proofData={{
            leaf_index: proofData.leaf_index!,
            proof: proofData.proof!,
            entitled_tfry: proofData.entitled_tfry!,
            entitled_fnode: proofData.entitled_fnode!,
          }}
          onClose={() => setShowModal(false)}
        />
      )}
    </div>
  );
}
