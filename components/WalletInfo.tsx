import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Sidebar from './Sidebar'; // Ensure this component is properly imported
import bgImg from '../assets/background.png';
import Image from 'next/image';
import { useSession } from 'next-auth/react';
import MessageUpdate from './messageUpdate';
import { Button, Flex } from '@tremor/react';
import PasteAddress from './PasteAddress';
import WalletIcon from './WalletIcon';
import { normalizeAssetId } from '../lib/utils';
import { useToastContext } from '../hooks/ToastContext';

const WalletInfo = ({
  minerKey,
  data,
  setData,
  onNext,
  onSkip,
  onCancel,
  status,
  asset_id
}) => {
  const router = useRouter();
  const [errors, setErrors] = useState<{ [key: string]: string }>({});
  const [isComplete, setIsComplete] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isLowBalance, setIsLowBalance] = useState(true);
  const [lackBalance, setLackBalance] = useState(0);
  const { data: session } = useSession();
  const [connectivityFocus, setConnectivityFocus] = useState(false);
  const toast = useToastContext();

  // FIXED: Improved hasOptedInForAsset function with better error handling and debugging
  // This function checks if a wallet has opted-in to a specific Algorand asset (token)
  async function hasOptedInForAsset(
    address: string,
    assetId: number | string
  ): Promise<boolean> {
    console.log(`Checking opt-in status for address: ${address}, assetId: ${assetId}`);

    try {
      const normalizedTarget = normalizeAssetId(assetId);

      if (!Number.isFinite(normalizedTarget) || normalizedTarget <= 0) {
        console.warn('Invalid asset id supplied to hasOptedInForAsset', {
          assetId
        });
        return false;
      }

      // Ask the server to confirm opt-in so we avoid browser-side algod quirks.
      const response = await fetch('/api/algorand/get-token-balance', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify({
          address,
          asset_id: normalizedTarget.toString()
        })
      });

      if (!response.ok) {
        console.error('Failed to verify opt-in status', {
          status: response.status,
          statusText: response.statusText
        });
        return false;
      }

      const result = await response.json();

      if (result?.success) {
        return true;
      }

      console.log('Opt-in check response', result);
      return false;
    } catch (error) {
      // IMPROVED: Better error logging to help debug wallet package issues
      console.error(`Error checking opt-in status for asset ${assetId} on address ${address}:`, error);
      
      // FIXED: Properly handle TypeScript error typing
      const errorDetails = error instanceof Error ? {
        message: error.message,
        stack: error.stack,
        assetId,
        address
      } : {
        message: 'Unknown error occurred',
        error: String(error),
        assetId,
        address
      };
      
      console.error('Full error details:', errorDetails);
      return false;
    }
  }

  const validateForm = async () => {
    const newErrors: { [key: string]: string } = {};

    if (!data.reward_wallet) {
      newErrors.reward_wallet = 'Reward wallet address is required';
    } else if (
      (await hasOptedInForAsset(data.reward_wallet, asset_id)) === false
    ) {
      const response = await fetch('/api/tokens/get-one', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ asset_id: asset_id })
      });

      const result = await response.json();
      newErrors.reward_wallet = `$${result.token.name} must be opted-in in reward wallet.`;
    }

  // ...existing code...
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async () => {
    if (await validateForm()) {
      if (!session || !session.user) {
        return;
      }
  // ...existing code...
      // const saveData = {
      //   miner_key: minerKey,
      //   reward_wallet: data.reward_wallet,
      //   connectivity_wallet: data.connectivity_wallet,
      //   note: data.note,
      //   address: session?.user.address
      // };
      // const response = await fetch('/api/registrations/save-wallet-info', {
      //   method: 'POST',
      //   headers: {
      //     'Content-Type': 'application/json'
      //   },
      //   body: JSON.stringify(saveData)
      // });

      // if (response.ok) {
      onNext();
      // } else {
      //   const data = await response.json();
      // }
    }
  };

  const handlePaste = () => {
    setData({ ...data, reward_wallet: session?.user.address });
  };

  const toggleSidebar = () => {
    setIsSidebarOpen(!isSidebarOpen);
  };

  // ...existing code...

  // ...existing code...

  return (
    <div className="flex h-full">
      <div className="flex flex-col w-full relative">
        <Image
          src={bgImg}
          className="w-screen h-[30vh] object-cover"
          alt="Background Image"
        />
  {/* ...existing code... */}
        <div className="py-8 pl-6 pr-24 md:px-24 h-full relative">
          <form className="w-full">
            <div className="w-full">
              <label className="block mb-2 text-white">
                Reward Wallet Address <span className="text-red-500">*</span>
              </label>
              <Flex flexDirection="row" className="gap-3">
                <input
                  type="text"
                  className="w-full p-2 border border-red-600 rounded text-black"
                  placeholder="Enter wallet address or use the clipboard icon to set the currently connected wallet as your Reward Wallet address."
                  defaultValue={data.reward_wallet}
                  onChange={(e) =>
                    setData({ ...data, reward_wallet: e.target.value })
                  }
                />
                <PasteAddress handlePaste={handlePaste} />
              </Flex>
              {errors.reward_wallet && (
                <span className="text-red-500 text-sm">
                  {errors.reward_wallet}
                </span>
              )}
            </div>

            {/* ...existing code... */}
          </form>
          <div className="absolute bottom-4 right-4 flex gap-2 text-white">
            <button
              type="button"
              className="px-4 py-2 border border-gray-500 rounded hover:bg-gray-500"
              onClick={onCancel}
            >
              Cancel
            </button>
            <button
              type="button"
              className="px-4 py-2 border border-gray-500 rounded hover:bg-gray-500"
              onClick={onSkip}
            >
              Back
            </button>
            <button
              type="button"
              className="px-4 py-2 border border-red-600 rounded  hover:bg-red-600"
              onClick={handleSubmit}
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default WalletInfo;
