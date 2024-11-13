import { useState } from 'react';
import { useRouter } from 'next/router';
import Sidebar from './Sidebar'; // Ensure this component is properly imported
import bgImg from '../assets/background.png';
import Image from 'next/image';

const WalletInfo = ({ minerKey, data, setData, onNext, onSkip }) => {
  const router = useRouter();
  const [errors, setErrors] = useState<{ [key: string]: string }>({});
  const [isComplete, setIsComplete] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  const validateForm = () => {
    const newErrors: { [key: string]: string } = {};

    if (!data.reward_wallet)
      newErrors.reward_wallet = 'Reward wallet address is required';
    if (!data.connectivity_wallet)
      newErrors.connectivity_wallet = 'Private key of wallet is required';

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async () => {
    console.log('handle submit');
    if (validateForm()) {
      await fetch('/api/saveWalletInfo', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)
      });
      setIsComplete(true);
      onNext(); // Call the onNext function to navigate to the next section
    }
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
        <div className="py-8 px-16 md:px-24 h-full relative">
          <form className="w-full">
            <div>
              <label className="block mb-2 text-white">
                Reward Wallet Address <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                className="w-full p-2 border border-red-600 rounded"
                placeholder="Enter reward wallet address"
                value={data.reward_wallet}
                onChange={(e) =>
                  setData({ ...data, reward_wallet: e.target.value })
                }
              />
              {errors.reward_wallet && (
                <span className="text-red-500 text-sm">
                  {errors.reward_wallet}
                </span>
              )}
            </div>
            <div>
              <label className="block mb-2 mt-2 text-white">
                Connectivity Private Key <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                className="w-full p-2 border border-red-600 rounded"
                placeholder="Enter private key of wallet"
                value={data.connectivity_wallet}
                onChange={(e) =>
                  setData({ ...data, connectivity_wallet: e.target.value })
                }
              />
              {errors.connectivity_wallet && (
                <span className="text-red-500 text-sm">
                  {errors.connectivity_wallet}
                </span>
              )}
            </div>
          </form>
          <div className="absolute bottom-4 right-4 flex gap-2 text-white">
            <button
              type="button"
              className="px-4 py-2 border border-gray-500 rounded"
              onClick={onSkip}
            >
              Skip
            </button>
            <button
              type="button"
              className="px-4 py-2 border border-red-600 rounded"
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
