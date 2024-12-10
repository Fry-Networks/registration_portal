import { useState } from 'react';
import { useRouter } from 'next/router';
import Sidebar from './Sidebar'; // Ensure this component is properly imported
import bgImg from '../assets/background.png';
import Image from 'next/image';
import { useSession } from 'next-auth/react';
import algosdk, { Account, Algodv2 } from 'algosdk';
import MessageUpdate from './messageUpdate';
import { Button, Flex } from '@tremor/react';
import PasteAddress from './PasteAddress';
import WalletIcon from './WalletIcon';
import { useModal } from '../app/modalcontext';
import GenerateWallet from './modals/GenerateWallet';
import { getWalletAddress } from '../lib/utils';

const token = '';
const server = 'https://xna-mainnet-api.algonode.cloud/';

const port = 443;
const tokenToSend = {
  'X-API-Key': token
};

const algodClient = new algosdk.Algodv2(
  '',
  'https://mainnet-api.algonode.cloud',
  ''
);

const WalletInfo = ({
  minerKey,
  data,
  setData,
  onNext,
  onSkip,
  status,
  asset_id
}) => {
  const router = useRouter();
  const [errors, setErrors] = useState<{ [key: string]: string }>({});
  const [isComplete, setIsComplete] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const { data: session } = useSession();
  const [connectivityFocus, setConnectivityFocus] = useState(false);
  const { openModal } = useModal();

  async function hasOptedInForAsset(
    address: string,
    assetId: number
  ): Promise<boolean> {
    const devMode =
      process.env.NEXT_PUBLIC_DEV_MODE &&
      process.env.NEXT_PUBLIC_DEV_MODE === 'true';

    try {
      console.log(address);
      console.log(assetId);
      const accountInfo = await algodClient.accountInformation(address).do();
      const assets = accountInfo['assets'] || [];
      return assets.some((asset: any) => asset['asset-id'] === assetId);
    } catch (error) {
      console.error(`Error: ${error}`);
      return false;
    }
  }

  const validateForm = async () => {
    const newErrors: { [key: string]: string } = {};

    if (!data.reward_wallet) {
      newErrors.reward_wallet = 'Reward wallet address is required';
    } else if (
      (await hasOptedInForAsset(data.reward_wallet, Number(asset_id))) == false
    ) {
      const response = await fetch('/api/tokens/get-one', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ asset_id: asset_id })
      });

      const result = await response.json();
      newErrors.reward_wallet = `$${result.token.name} must be optined in reward wallet.`;
    }

    if (!data.connectivity_wallet) {
      newErrors.connectivity_wallet = 'Private key of wallet is required.';
    } else if (data.connectivity_wallet.split(' ').length !== 25) {
      newErrors.connectivity_wallet = 'Private key consists of 25 words.';
    } else {
      try {
        const account = algosdk.mnemonicToSecretKey(data.connectivity_wallet);

        if (!account) {
          newErrors.connectivity_wallet = 'Inputed wrong private key';
        }
      } catch (error) {
        newErrors.connectivity_wallet = 'Inputed wrong private key';
      }
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async () => {
    console.log('handle submit');
    if (await validateForm()) {
      if (!session || !session.user) {
        return;
      }
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

  const handleGenWallet = () => {
    console.log('Generate new wallet');
    openModal('generate_wallet');
  };

  const saveGenerateWallet = (mnemonic: string) => {
    setData({ ...data, connectivity_wallet: mnemonic });
  };

  const toggleSidebar = () => {
    setIsSidebarOpen(!isSidebarOpen);
  };

  return (
    <div className="flex h-full">
      <div className="flex flex-col w-full relative">
        <Image
          src={bgImg}
          className="w-screen h-[30vh] object-cover"
          alt="Background Image"
        />
        <div className="py-8 pl-6 pr-24 md:px-24 h-full relative">
          <form className="w-full">
            <div className="w-full">
              <label className="block mb-2 text-white">
                Reward Wallet Address <span className="text-red-500">*</span>
              </label>
              <Flex flexDirection="row" className="gap-3">
                <input
                  type="text"
                  className="w-full p-2 border border-red-600 rounded"
                  placeholder="Enter wallet address or use the clipboard icon to set the currently connected wallet as your Reward Wallet address."
                  value={data.reward_wallet}
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

            <div>
              <label className="block mb-2 mt-2 text-white">
                PoC Wallet <span className="text-red-500">*</span>
              </label>
              <Flex flexDirection="row" className="gap-3">
                <input
                  type="text"
                  className="w-full p-2 border border-red-600 rounded"
                  placeholder="Click wallet icon to create a new PoC wallet. A secure secret phrase will be created for you"
                  value={getWalletAddress(data.connectivity_wallet)}
                  onFocus={() => setConnectivityFocus(true)}
                  onBlur={() => setConnectivityFocus(false)}
                />
                <WalletIcon handleOnclick={handleGenWallet} />
              </Flex>
              {errors.connectivity_wallet && (
                <span className="text-red-500 text-sm">
                  {errors.connectivity_wallet}
                </span>
              )}
              {data.connectivity_wallet && (
                <p>
                  For security, only the wallet address is shown. Add gas fees
                  as needed without revealing the secret phrase.
                </p>
              )}
            </div>
            <div>
              <label className="block mb-2 mt-2 text-white">Note</label>
              <input
                type="text"
                className="w-full p-2 border border-red-600 rounded"
                placeholder="Enter note for Tx"
                value={data.note}
                onChange={(e) => setData({ ...data, note: e.target.value })}
              />
            </div>
          </form>
          <div className="absolute bottom-4 right-4 flex gap-2 text-white">
            {/* <button
              type="button"
              className="px-4 py-2 border border-gray-500 rounded hover:bg-gray-500"
              onClick={onSkip}
            >
              Skip
            </button> */}
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
      <GenerateWallet
        modalName="generate_wallet"
        saveGenerateWallet={saveGenerateWallet}
      />
    </div>
  );
};

export default WalletInfo;
