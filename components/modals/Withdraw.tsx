import { Button, Dialog, DialogPanel, Flex, Title } from '@tremor/react';
import { Device, Product } from '../../lib/types';
import { useModal } from '../../app/modalcontext';
import { useEffect, useRef, useState } from 'react';
import { RiCloseLine } from '@remixicon/react';
import { useSession } from 'next-auth/react';
import { secureFetch } from '../../lib/api/secureFetch';
import { parseAlgodError } from '../../lib/algorand/errorParser';
import { useToastContext } from '../../hooks/ToastContext';
import { useTheme } from 'next-themes';

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
  const [statusError, setStatusError] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);

  const { data: session } = useSession();
  const toast = useToastContext();
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme !== 'light';
  const walletAddress = session?.user?.address ?? null;
  const modalOpen = Boolean(modals[modalName]);
  const errorToastShownRef = useRef(false);
  const buttonBaseClass =
    'px-4 py-2 rounded-md border font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-red-600 disabled:opacity-60 disabled:cursor-not-allowed';
  const primaryButtonClass = `${buttonBaseClass} border-red-600 bg-red-600 text-white hover:bg-red-500 hover:border-red-500`;
  const secondaryButtonClass = `${buttonBaseClass} border-red-600 ${isDark ? 'text-red-300 bg-transparent hover:bg-red-900/20' : 'text-black bg-white hover:bg-red-50'} `;

  useEffect(() => {
    if (!modalOpen) {
      setAcknowledged(false);
      setStatusError(null);
      errorToastShownRef.current = false;
    }
  }, [modalOpen]);

  useEffect(() => {
    if (!modalOpen || !device || !walletAddress) {
      return;
    }

    let cancelled = false;
    const fetchWithdrawableStatus = async () => {
      try {
        const response = await secureFetch('/api/stake/withdrawable', {
          miner_key: device.miner_key,
          address: walletAddress
        });
        const payload = await response.json().catch(() => null);

        if (!response.ok) {
          const fallback = 'We could not confirm your withdraw status. Please try again in a few moments.';
          const message =
            typeof payload?.message === 'string' ? payload.message : fallback;
          throw new Error(message);
        }

        if (!payload?.data) {
          throw new Error('Withdraw status response was malformed. Please refresh and try again.');
        }

        if (!cancelled) {
          setIsWithdrawable(Boolean(payload.data.available));
          setWithdrawableTime(new Date(payload.data.availableIn));
          setStatusError(null);
          errorToastShownRef.current = false;
        }
      } catch (error) {
        if (cancelled) return;
        const message =
          error instanceof Error
            ? error.message
            : 'We could not confirm your withdraw status. Please try again in a few moments.';
        setIsWithdrawable(false);
        setStatusError(message);

        if (!errorToastShownRef.current) {
          toast.error({
            heading: 'Withdraw check failed',
            message
          });
          errorToastShownRef.current = true;
        }
      }
    };

    void fetchWithdrawableStatus();

    return () => {
      cancelled = true;
    };
  }, [modalOpen, device, walletAddress, toast]);

  const handleWithdraw = async () => {
    setIsProcessing(true);
    try {
      const response = await secureFetch('/api/stake/stake-withdraw', {
        address: session?.user.address,
        miner_key: device.miner_key
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        const serverMessage =
          (payload && typeof payload.message === 'string' && payload.message) ||
          (payload && typeof payload?.response?.message === 'string' && payload.response.message) ||
          null;
        toast.error({
          heading: 'Withdraw Error',
          message:
            serverMessage || 'Failed to withdraw the token. Please contact us before you try again'
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
      const parsed = parseAlgodError(error);
      const message =
        parsed?.userMessage ||
        (error instanceof Error ? error.message : 'Failed to withdraw the token. Please contact us before you try again');
      console.error('[Withdraw] Failed to withdraw', parsed?.rawMessage || error);

      toast.error({
        heading: 'Withdraw Error',
        message
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
        className="z-[180]"
      >
          {/* Align modal palette with the verification withdraw styling so text stays legible on both themes. */}
        <DialogPanel
          className={`max-w-full sm:max-w-xl min-h-[100dvh] sm:min-h-0 rounded-none sm:rounded-2xl ${isDark ? 'bg-[#111827] text-gray-100' : 'bg-white text-slate-900'}`}
        >
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
          <Title className={`mb-5 ${isDark ? 'text-gray-100' : 'text-slate-900'}`}>{`Withdraw Verification Stake`}</Title>
          <p className={`${isDark ? 'text-gray-100' : 'text-slate-900'}`}>
            {isWithdrawable
              ? `You can withdraw now`
              : `You can withdraw at ${withdrawableTime}`}
          </p>
          {statusError && (
            <p className="mt-2 text-sm text-red-500 dark:text-red-400">
              {statusError}
            </p>
          )}

          {/* {!isWithdrawable && (
            <p className="text-red-500 mt-4">
              Note: You can click 'Withdraw with Boost' button to pay 50USD to
              withdraw the token immediately.
            </p>
          )} */}
          <div className="mt-4 rounded-2xl border border-warning-500/50 bg-warning-100 px-4 py-3 text-sm text-warning-900 dark:bg-warning-500/10 dark:text-warning-100">
            <p className="font-semibold text-[#3c1e00] dark:text-warning-50">
              Withdrawing removes your verification multiplier.
            </p>
            <p className="text-xs mt-1 text-[#3c1e00] dark:text-warning-100/90">
              You will earn base rewards only until you re-stake with FRY&nbsp;2.0 and restore your multiplier bonus.
            </p>
            <label className="mt-3 flex items-center gap-2 text-xs text-[#3c1e00] dark:text-warning-100">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-warning-700 text-warning-700 focus:ring-warning-500 dark:border-warning-200 dark:text-warning-200"
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
            <Button className={secondaryButtonClass} onClick={() => !isProcessing && closeModal(modalName)}>
              Close
            </Button>
            <Button
              className={`${primaryButtonClass} relative flex items-center justify-center`}
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
