import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { Device } from '../lib/types';
import { Product } from '../pages/api/verify-stake';
import { useModal } from '../app/modalcontext';
import {
  Dialog,
  DialogPanel,
  Title,
  Flex,
  TextInput,
  Button
} from '@tremor/react';
import { RiCloseLine } from '@remixicon/react';
import StakeVerification from './modals/StakeVerification';
import WithdrawStakeVerification from './modals/WithdrawStakeVerification';

const StakeWithdrawModal = ({ modalName, status, device, product }) => {
  const { modals, openModal, closeModal } = useModal();
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

    if (!status) {
      openModal('withdraw_stakeVerification');
    } else {
      openModal('stakeVerification');
    }

    setIsProcessing(false);
  };

  const toggleSidebar = () => {
    setIsSidebarOpen(!isSidebarOpen);
  };

  return (
    <div>
      <Dialog
        open={modals[modalName]}
        onClose={() => {}}
        static={true}
        className="z-[100]"
      >
        <DialogPanel className="sm:max-w-xl">
          <div className="absolute right-0 top-0 pr-3 pt-3">
            <button
              type="button"
              className="rounded-tremor-small p-2 text-tremor-content-subtle hover:bg-tremor-background-subtle hover:text-tremor-content dark:text-dark-tremor-content-subtle hover:dark:bg-dark-tremor-background-subtle hover:dark:text-tremor-content"
              onClick={() => closeModal(modalName)}
              aria-label="Close"
            >
              <RiCloseLine className="h-5 w-5 shrink-0" aria-hidden={true} />
            </button>
          </div>
          <Title className="mb-5">{status ? 'Withdraw' : 'Stake'}</Title>
          {status ? (
            <Flex
              flexDirection="col"
              justifyContent="start"
              className="gap-3 w-full mt-5"
            >
              <div className="flex items-center space-x-2">
                <label className="flex-row items-center space-x-2">
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
                <label className="flex items-center space-x-2">
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
                <label className="block mb-2">Amount to Stake:</label>
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
            </Flex>
          ) : (
            <Flex
              flexDirection="col"
              alignItems="stretch"
              justifyContent="center"
              className="gap-3 w-full mt-5"
            >
              <div className="flex gap-2">
                <p>BYOD:</p>
                <p>{device?.byod ? 'Yes' : 'No'}</p>
              </div>

              <div className="flex items-center space-x-2">
                <label className="flex items-center space-x-2">
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
                <label className="flex items-center space-x-2">
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
              <div className="flex items-center space-x-4">
                <label
                  htmlFor="stakeAmount"
                  className="text-sm font-medium text-gray-700"
                >
                  Amount to Stake:
                </label>
                <input
                  id="stakeAmount"
                  type="number"
                  min="0"
                  className="p-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-red-600 focus:border-red-600 disabled:opacity-50"
                  defaultValue={0}
                  disabled={true}
                  value={stakeAmount}
                />
              </div>
            </Flex>
          )}
          <Flex
            flexDirection="row"
            justifyContent="center"
            className="gap-3 w-full mt-5"
          >
            <Button
              className="bg-transparent text-slate-900 border-red-600 hover:bg-red-600 hover:border-red-600"
              onClick={() => closeModal(modalName)}
            >
              Skip
            </Button>
            <Button
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
            </Button>
          </Flex>
        </DialogPanel>
      </Dialog>
      <StakeVerification
        modalName="stakeVerification"
        miner={`${device.miner_key}`}
        byod={device?.byod ? true : false}
      />
      <WithdrawStakeVerification
        modalName="withdraw_stakeVerification"
        miner={`${device.miner_key}`}
        staked={stakeAmount}
      />
    </div>
  );
};

export default StakeWithdrawModal;
