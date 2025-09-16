import { Button, Dialog, DialogPanel, Flex, Title } from '@tremor/react';
import { Device, Product } from '../../lib/types';
import { useModal } from '../../app/modalcontext';
import { useEffect, useState } from 'react';
import { RiCloseLine } from '@remixicon/react';
import { useSession } from 'next-auth/react';
import MessageUpdate from '../messageUpdate';
import axios from 'axios';
import { getTokenBalance } from '../../pages/api/algorand/get-token-balance';

const fry2AssetId = '2485314946';
const USDAmount = process.env.NODE_ENV === 'production' ? 50 : 0.003;
const devMode =
  process.env.NEXT_PUBLIC_DEV_MODE &&
  process.env.NEXT_PUBLIC_DEV_MODE === 'true';
import { useToastContext } from '../../hooks/ToastContext';

export default function WithdrawModal({
  modalName,
  device,
  product,
  handleWithdrawUpdate
}: {
  modalName: string;
  device: Device;
  product: Product;
  handleWithdrawUpdate: (device: Device) => void;
}) {
  const { modals, closeModal } = useModal();
  const [isProcessing, setIsProcessing] = useState(false);
  const [isWithdrawable, setIsWithdrawable] = useState(false);
  const [withdrawableTime, setWithdrawableTime] = useState<Date>(
    new Date(Date.now())
  );

  const { data: session } = useSession();
  const toast = useToastContext();

  const fetchWithdrawable = async (device: Device) => {
    console.log;
    if (modals[modalName] === false) {
      return;
    }

    console.log('fetchWithdrawable');

    if (!session || !session.user) {
      console.log('Session invalid');
      return;
    }

    try {
      const response = await fetch('api/stake/withdrawable', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          miner_key: device.miner_key,
          address: session.user.address
        })
      });

      if (!response.ok) {
        toast.error({
          heading: 'Withdraw Error',
          message: 'Network error to get withdraw status'
        });
        return;
      }

      const result = await response.json();
      setIsWithdrawable(result.data.available);
      setWithdrawableTime(new Date(result.data.availableIn));
    } catch (error) {}
  };

  useEffect(() => {
    fetchWithdrawable(device);
  }, [device, product, modals]);

  const handleWithdraw = async () => {
    setIsProcessing(true);
    try {
      const response = await fetch('/api/stake/stake-withdraw', {
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
          message:
            'Failed to withdraw the token. Please contact us before you try again'
        });

        setIsProcessing(false);
        return;
      }

      const result = await response.json();
      toast.success({ heading: 'Success', message: `Tx: ${result.txId}` });

      setIsProcessing(false);
      closeModal(modalName);
      handleWithdrawUpdate(device);
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
        onClose={() => {}}
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
          <Title className="mb-5">{`Withdraw`}</Title>
          <p className='text-slate-900'>
            {isWithdrawable
              ? `You can withdraw now`
              : `You can withdraw at ${withdrawableTime}`}
          </p>

          {/* {!isWithdrawable && (
            <p className="text-red-500 mt-4">
              Note: You can click 'Withdraw with Boost' button to pay 50USD to
              withdraw the token immediately.
            </p>
          )} */}
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
              disabled={!isWithdrawable}
              onClick={() => handleWithdraw()}
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
                'Withdraw'
              )}
            </Button>
            {/* <Button
              className={`relative flex items-center justify-center bg-transparent text-slate-900 border-red-600 hover:bg-red-600 hover:border-red-600 ${
                isProcessing ? 'cursor-not-allowed' : 'cursor-default'
              }`}
              onClick={() => handleBoostWithdraw()}
              disabled={isWithdrawable}
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
                'Withdraw with Boost'
              )}
            </Button> */}
          </Flex>
        </DialogPanel>
      </Dialog>
    </div>
  );
}
