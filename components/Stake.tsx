import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { XIcon, ChevronRightIcon } from '@heroicons/react/outline';

import Sidebar from './Sidebar';
import bgImg from '../assets/background.png';
import Image from 'next/image';

const Stake = ({ status, device, product, onNext, onSkip }) => {
  const router = useRouter();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [stakeType, setStateType] = useState('one');
  const [stakeAmount, setStakeAmount] = useState(0);
  const [errors, setErrors] = useState<{ [key: string]: string }>({});
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    if (!device) {
      return;
    }

    if (!device.staked) {
      return;
    }

    setStateType(device.staked.type);
  }, [device]);

  useEffect(() => {
    if (product === undefined) {
      return;
    }

    console.log('Stake Amount initialize');

    if (stakeType === 'one') {
      setStakeAmount(product.reward.stake.stake_one);
    } else {
      setStakeAmount(product.reward.stake.stake_two);
    }
  }, [product, stakeType]);

  const handleSubmit = async () => {
    setIsProcessing(true);
    setTimeout(() => {}, 3_000);
  };

  const toggleSidebar = () => {
    setIsSidebarOpen(!isSidebarOpen);
  };

  return (
    <div className="flex h-full">
      <div className="flex flex-col relative w-full h-full">
        <Image
          src={bgImg}
          className="w-screen h-[30vh] object-cover"
          alt="Background Image"
        />
        <div className="py-8 px-24 relative h-full">
          {status ? (
            <form className="space-y-6">
              <div className="flex items-center space-x-4">
                <label className="flex items-center space-x-2 text-white">
                  <input
                    type="radio"
                    name="stakeOption"
                    value="one"
                    checked={stakeType === 'one'}
                    onClick={() => setStateType('one')}
                    className="form-radio border border-red-600 text-blue-600"
                  />
                  <span>24-Hour Staking</span>
                </label>
                <label className="flex items-center space-x-2 text-white">
                  <input
                    type="radio"
                    name="stakeOption"
                    value="two"
                    checked={stakeType === 'two'}
                    onClick={() => setStateType('two')}
                    className="form-radio border border-red-600 text-blue-600"
                  />
                  <span>6-months Staking</span>
                </label>
              </div>
              {errors.stakeType && (
                <span className="text-red-500 text-sm">{errors.stakeType}</span>
              )}

              <div>
                <label className="block mb-2 text-white">
                  Amount to Stake:
                </label>
                <input
                  type="number"
                  min="0"
                  className="w-full p-2 border border-red-600 rounded"
                  defaultValue={0}
                  disabled={true}
                />
              </div>
              {errors.amount && (
                <span className="text-red-500 text-sm">{errors.amount}</span>
              )}
            </form>
          ) : (
            <form className="space-y-6">
              <div className="flex gap-2">
                <p className="text-white">BYOD:</p>
                <p className="text-white">{device?.byod ? 'Yes' : 'No'}</p>
              </div>

              <div className="flex items-center space-x-4">
                <label className="flex items-center space-x-2 text-white">
                  <input
                    type="radio"
                    name="stakeOption"
                    value="one"
                    checked={stakeType === 'one'}
                    onClick={() => setStateType('one')}
                    className="form-radio border border-red-600 text-red-600"
                  />
                  <span>24-Hour Staking</span>
                </label>
                <label className="flex items-center space-x-2 text-white">
                  <input
                    type="radio"
                    name="stakeOption"
                    value="two"
                    checked={stakeType === 'two'}
                    onClick={() => setStateType('two')}
                    className="form-radio border border-red-600 text-red-600"
                  />
                  <span>6-months Staking</span>
                </label>
              </div>

              <div>
                <label className="block mb-2 text-white">
                  Amount to Stake:
                </label>
                <input
                  type="number"
                  min="0"
                  className="w-full p-2 border border-red-600 rounded"
                  defaultValue={0}
                  disabled={true}
                  value={stakeAmount}
                />
              </div>
            </form>
          )}

          {/* Button container positioned at the bottom right */}
          <div className="absolute bottom-4 right-4 flex space-x-4 text-white">
            <button
              type="button"
              className="px-4 py-2 border border-gray-500 rounded"
              onClick={onSkip}
            >
              Skip
            </button>
            <button
              type="button"
              className={`relative flex items-center justify-center border-red-600 px-4 py-2 border rounded-md text-white font-medium transition duration-300 ${isProcessing ? 'cursor-not-allowed' : 'cursor-default'}`}
              onClick={handleSubmit}
            >
              {isProcessing ? (
                <div className="absolute flex items-center justify-center">
                  <svg
                    className="animate-spin h-6 w-6 text-red-500"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <defs>
                      <linearGradient
                        id="redGradient"
                        x1="0%"
                        y1="0%"
                        x2="100%"
                        y2="0%"
                      >
                        <stop offset="0%" stopColor="#ff0000" />
                        <stop offset="50%" stopColor="#ff4d4d" />
                        <stop offset="100%" stopColor="#ff9999" />
                      </linearGradient>
                    </defs>
                    <circle
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="url(#redGradient)"
                      strokeWidth="4"
                      fill="none"
                      strokeLinecap="round"
                    />
                  </svg>
                </div>
              ) : status ? (
                'Withdraw'
              ) : (
                'Stake'
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Stake;
