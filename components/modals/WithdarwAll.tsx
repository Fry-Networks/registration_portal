import { Button, Dialog, DialogPanel, Flex, Title } from '@tremor/react';
import { useModal } from '../../app/modalcontext';
import { useState } from 'react';
import { RiCloseLine } from '@remixicon/react';
import { Device } from '../../lib/types';
import MessageUpdate from '../messageUpdate';
import { useSession } from 'next-auth/react';
import { useToastContext } from '../../hooks/ToastContext';
import { isNodeStaked, isRegistartionStaked } from '../../lib/utils';

export default function WithdrawAllModal({
  modalName,
  device,
  handleWithdrawAll
}: {
  modalName: string;
  device: Device;
  handleWithdrawAll: (device: Device) => Promise<void>;
}) {
  const { modals, closeModal } = useModal();
  const [isProcessing, setIsProcessing] = useState(false);
  const { data: session } = useSession();
  const toast = useToastContext();

  const withdrawAll = async () => {
    setIsProcessing(true);
    try {
      if (isRegistartionStaked(device)) {
        const response = await fetch('/api/stake/r-withdraw', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            address: session?.user.address,
            miner_key: device.miner_key
          })
        });

        if (!response.ok) {
          toast.error({
            heading: 'Withdraw Error',
            message: 'Failed to withdraw registration staking'
          });

          setIsProcessing(false);
          return;
        }

        const result = await response.json();
        toast.success({
          heading: 'Withdarw Registraion Success',
          message: `Tx: ${result.txId}`
        });
      }

      if (isNodeStaked(device)) {
        const response = await fetch('/api/stake/n-withdraw', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            address: session?.user.address,
            miner_key: device.miner_key
          })
        });

        if (!response.ok) {
          toast.error({
            heading: 'Withdraw Error',
            message: 'Failed to withdraw node staking'
          });

          setIsProcessing(false);
          return;
        }

        const result = await response.json();
        toast.success({
          heading: 'Withdarw Node Success',
          message: `Tx: ${result.txId}`
        });
      }

      setIsProcessing(false);
      closeModal(modalName);
      handleWithdrawAll(device);
    } catch (error) {
      console.error(error);

      toast.error({
        heading: 'Withdraw Error',
        message:
          'Failed to withdraw the token. Please contact us before you try again'
      });
      setIsProcessing(false);
      return;
    }
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
          <Title className="mb-5">Withdraw All</Title>
          <Flex
            flexDirection="col"
            alignItems="stretch"
            justifyContent="center"
            className="gap-3 w-full mt-5 text-slate-900"
          >
            <p>Do you want to withdraw registration and node staking?</p>
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
              onClick={() => withdrawAll()}
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
                'Yes'
              )}
            </Button>
          </Flex>
        </DialogPanel>
      </Dialog>
    </div>
  );
}
