import { useEffect, useState } from "react";
import { useWalletActions } from "../lib/wallet/useWalletActions";
import { getAssetBalance } from "../lib/algorand/balances";
import WalletGate from "../components/WalletGate";
import RewardClaimModal from "../components/RewardClaimModal";
import { useSession } from "next-auth/react";
import Link from "next/link";

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
  error?: string;
}

export default function RewardsClaimPage() {
  const { activeAddress } = useWalletActions();
  const { data: session } = useSession();
  const [data, setData] = useState<ClaimableResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [tfryOptedIn, setTfryOptedIn] = useState(false);
  const [fnodeOptedIn, setFnodeOptedIn] = useState(false);

  const fetchClaimable = async () => {
    if (!activeAddress) {
      setLoading(false);
      return;
    }
    try {
      const res = await fetch(`/api/rewards/claimable?wallet=${activeAddress}`);
      const json = await res.json();
      setData(json);
    } catch (err) {
      console.error("Failed to load claimable:", err);
      setData({
        error: "fetch_failed",
        claimable_tfry: 0,
        claimable_fnode: 0,
        matured_tfry: 0,
        matured_fnode: 0,
        recent_tfry: 0,
        recent_fnode: 0,
        epoch: 0,
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchClaimable();
  }, [activeAddress]);

  useEffect(() => {
    if (!activeAddress) return;
    (async () => {
      const tfryBal = await getAssetBalance(activeAddress, TFRY_ID.toString());
      const fnodeBal = await getAssetBalance(activeAddress, FNODE_ID.toString());
      setTfryOptedIn(tfryBal !== null);
      setFnodeOptedIn(fnodeBal !== null);
    })();
  }, [activeAddress]);

  const refresh = () => {
    setShowModal(false);
    setLoading(true);
    fetchClaimable();
  };

  if (activeAddress && !session) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center p-8">
        <div className="text-center">
          <p className="font-semibold mb-2">Session expired</p>
          <p className="text-sm text-gray-500 mb-4">Your wallet is connected, but your session has expired.</p>
          <Link href="/signin" className="text-blue-500 hover:underline">Sign in again →</Link>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <WalletGate>
        <div className="p-8">Loading...</div>
      </WalletGate>
    );
  }

  const needsOptIn = !tfryOptedIn || !fnodeOptedIn;
  const hasError = !data || !!data.error;
  const hasClaimable = data && (data.claimable_tfry + data.claimable_fnode) > 0;

  return (
    <WalletGate>
      <div className="max-w-2xl mx-auto p-8">
        <h1 className="text-3xl font-bold mb-6">Epoch Rewards Claim</h1>

        {hasError && (
          <div className="bg-yellow-50 border border-yellow-200 rounded p-4 mb-6">
            <p className="text-yellow-800">
              No rewards published yet for this epoch.
            </p>
          </div>
        )}

        {!hasError && data && (
          <div className="bg-white rounded-lg shadow p-6 mb-6">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-semibold">Current Epoch</h2>
              <span className="text-2xl font-bold text-blue-600">{data.epoch}</span>
            </div>

            <div className="grid grid-cols-2 gap-4 mb-6">
              <div>
                <p className="text-gray-600">Claimable tFRY</p>
                <p className="text-2xl font-bold">{(data.claimable_tfry / 1e6).toFixed(2)}</p>
              </div>
              <div>
                <p className="text-gray-600">Claimable fNODE</p>
                <p className="text-2xl font-bold">{(data.claimable_fnode / 1e6).toFixed(2)}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 mb-6 text-sm text-gray-500">
              <div>
                <p>Matured (free): {(data.matured_tfry / 1e6).toFixed(2)} tFRY</p>
                <p>Recent (fee): {(data.recent_tfry / 1e6).toFixed(2)} tFRY</p>
              </div>
              <div>
                <p>Matured (free): {(data.matured_fnode / 1e6).toFixed(2)} fNODE</p>
                <p>Recent (fee): {(data.recent_fnode / 1e6).toFixed(2)} fNODE</p>
              </div>
            </div>

            {needsOptIn && (
              <div className="bg-yellow-50 border border-yellow-200 rounded p-4 mb-6">
                <p className="text-yellow-800">
                  You must opt into tFRY and fNODE in your wallet before claiming.
                </p>
              </div>
            )}

            <button
              onClick={() => setShowModal(true)}
              disabled={needsOptIn || !hasClaimable}
              className="w-full bg-blue-600 text-white py-2 px-4 rounded font-semibold disabled:opacity-50"
            >
              Claim Epoch Rewards
            </button>
          </div>
        )}

        {showModal && activeAddress && (
          <RewardClaimModal
            wallet={activeAddress}
            onClose={() => setShowModal(false)}
            onSuccess={refresh}
            initialData={data ?? undefined}
          />
        )}
      </div>
    </WalletGate>
  );
}
