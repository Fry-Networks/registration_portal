import { Button, Dialog, DialogPanel, Flex, Title } from '@tremor/react';
import { Device, Product } from '../../lib/types';
import { useModal } from '../../app/modalcontext';
import { useCallback, useEffect, useState } from 'react';
import { RiCloseLine } from '@remixicon/react';
import { useSession } from 'next-auth/react';
import { secureFetch } from '../../lib/api/secureFetch';
import { useToastContext } from '../../hooks/ToastContext';

const fry2AssetId = '2485314946';
const USDAmount = process.env.NODE_ENV === 'production' ? 50 : 0.003;

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
  const [acknowledged, setAcknowledged] = useState(false);

  const { data: session } = useSession();
  const toast = useToastContext();
  const walletAddress = session?.user?.address ?? null;

  const fetchWithdrawable = useCallback(
    async (targetDevice: Device) => {
      if (modals[modalName] === false) {
        return;
      }

      console.log('fetchWithdrawable');

      if (!walletAddress) {
        console.log('Session invalid');
        return;
      }

      try {
        const response = await secureFetch('/api/stake/withdrawable', {
          miner_key: targetDevice.miner_key,
          address: walletAddress
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
    },
    [modals, modalName, walletAddress, toast]
  );

  useEffect(() => {
    if (device) {
      fetchWithdrawable(device);
    }
  }, [device, fetchWithdrawable]);

  useEffect(() => {
    if (!modals[modalName]) {
      setAcknowledged(false);
    }
  }, [modals, modalName]);

  useEffect(() => {
    if (!modals[modalName]) {
      setAcknowledged(false);
    }
  }, [modals, modalName]);

  const handleWithdraw = async () => {
    setIsProcessing(true);
    try {
      const response = await secureFetch('/api/stake/stake-withdraw', {
        address: session?.user.address,
        miner_key: device.miner_key
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
        {/* Align modal palette with the verification withdraw styling so text stays legible on both themes. */}
        <DialogPanel className="sm|max-w-xl bg-white text-gray-900 dark:bg-gray-900 dark:text-gray-100">
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
          <Title className="mb-5 text-gray-900 dark:text-gray-100">{`Withdraw`}</Title>
          <p className="text-gray-900 dark:text-gray-100">
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
          <div className="mt-4 rounded-2xl border border-amber-500/50 bg-amber-100 px-4 py-3 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-100">
            <p className="font-semibold text-[#3c1e00] dark:text-amber-50">
              Withdrawing removes your verification multiplier.
            </p>
            <p className="text-xs mt-1 text-[#3c1e00] dark:text-amber-100/90">
              You will earn base rewards only until you re-stake with FRY&nbsp;2.0 and restore your multiplier bonus.
            </p>
            <label className="mt-3 flex items-center gap-2 text-xs text-[#3c1e00] dark:text-amber-100">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-amber-700 text-amber-700 focus:ring-amber-500 dark:border-amber-200 dark:text-amber-200"
                checked={acknowledged}
                onChange={(event) => setAcknowledged(event.target.checked)}
              />
              <span>I understand withdrawing now removes my multiplier until I re-stake.</span>
            </label>
          </div>

          <Flex
            flexDirection="row"
            justifyContent="center"
            className="gap-3 w-full mt-5"
          >
            <Button
            className="bg-transparent border-red-600 text-white hover:bg-red-600 hover:border-red-600"
              onClick={() => !isProcessing && closeModal(modalName)}
            >
              Close
            </Button>
            <Button
              className={`relative flex items-center justify-center bg-transparent border-red-600 text-white hover:bg-red-600 hover:border-red-600 ${
                isProcessing ? 'cursor-not-allowed' : 'cursor-default'
              }`}
              disabled={!isWithdrawable || !acknowledged}
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
