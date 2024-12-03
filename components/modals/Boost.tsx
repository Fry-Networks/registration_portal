import { Button, Dialog, DialogPanel, Flex, Title } from '@tremor/react';
import { useModal } from '../../app/modalcontext';
import { useState } from 'react';
import { RiCloseLine } from '@remixicon/react';
import { Device } from '../../lib/types';
import MessageUpdate from '../MessageUpdate';

export default function BoostModal({
  modalName,
  miner_key,
  no,
  handleBoost
}: {
  modalName: string;
  miner_key: string;
  no?: string;
  handleBoost: (ret: boolean, message: string) => Promise<void>;
}) {
  const { modals, closeModal } = useModal();
  const [isProcessing, setIsProcessing] = useState(false);
  const [updateSuccess, setUpdateSuccess] = useState({
    status: 'success',
    message: ''
  });

  const boostRewards = async () => {
    console.log('Boosting');
    setIsProcessing(true);
    try {
      const response = await fetch('api/rewards/boost', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(
          no ? { miner_key: miner_key, no: no } : { miner_key: miner_key }
        )
      });

      const result = await response.json();
      if (!response.ok) {
        setUpdateSuccess({
          status: 'error',
          message: result.message
        });
        setTimeout(() => {
          setUpdateSuccess({ status: 'error', message: '' });
        }, 3_000);

        setIsProcessing(false);
        return;
      }

      if (result.success) {
        setIsProcessing(false);
        closeModal(modalName);
        handleBoost(true, '');
      } else {
        setUpdateSuccess({
          status: 'error',
          message: result.message
        });
        setTimeout(() => {
          setUpdateSuccess({ status: 'error', message: '' });
        }, 3_000);

        setIsProcessing(false);
        return;
      }
    } catch (error) {
      setUpdateSuccess({
        status: 'error',
        message: 'Error on server side'
      });
      setTimeout(() => {
        setUpdateSuccess({ status: 'error', message: '' });
      }, 3_000);

      setIsProcessing(false);
      return;
    }
    setIsProcessing(false);
  };

  return (
    <div>
      <Dialog
        open={modals[modalName]}
        onClose={() => {
          !isProcessing && closeModal(modalName);
        }}
        static={true}
        className="z-[100]"
      >
        <DialogPanel className="sm:max-w-xl">
          <div className="absolute right-0 top-0 pr-3 pt-3">
            <button
              type="button"
              className="rounded-tremor-small p-2 text-tremor-content-subtle hover:bg-tremor-background-subtle hover:text-tremor-content dark:text-dark-tremor-content-subtle hover:dark:bg-dark-tremor-background-subtle hover:dark:text-tremor-content"
              onClick={() => !isProcessing && closeModal(modalName)}
              aria-label="Close"
            >
              <RiCloseLine className="h-5 w-5 shrink-0" aria-hidden={true} />
            </button>
          </div>
          <Title className="mb-5">Boost Rewards</Title>
          <div className="px-2 sm:px-20">
            <MessageUpdate updateSuccess={updateSuccess} />
          </div>
          <Flex
            flexDirection="col"
            alignItems="stretch"
            justifyContent="center"
            className="gap-3 w-full mt-5"
          >
            <p>
              Do you want to boost pending rewards? If you boost then 30% will
              be reduced.
            </p>
          </Flex>
          <Flex
            flexDirection="row"
            justifyContent="center"
            className="gap-3 w-full mt-5"
          >
            <Button
              className="bg-transparent text-slate-900 border-red-600 hover:bg-red-600 hover:border-red-600"
              onClick={() => !isProcessing && closeModal(modalName)}
            >
              Close
            </Button>
            <Button
              className={`relative flex items-center justify-center bg-transparent text-slate-900 border-red-600 hover:bg-red-600 hover:border-red-600 ${
                isProcessing ? 'cursor-not-allowed' : 'cursor-default'
              }`}
              onClick={() => boostRewards()}
            >
              {isProcessing ? (
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
              ) : (
                'Boost'
              )}
            </Button>
          </Flex>
        </DialogPanel>
      </Dialog>
    </div>
  );
}
