import { Button, Dialog, DialogPanel, Flex, Title } from '@tremor/react';
import { useModal } from '../../app/modalcontext';
import { useRef, useState, useMemo } from 'react';
import { RiCloseLine } from '@remixicon/react';
import { Device } from '../../lib/types';
import MessageUpdate from '../messageUpdate';
import { useToastContext } from '../../hooks/ToastContext';
import { startConfirmationWatcher } from '../../lib/confirmWatcher';
import { getClientToken } from '../../lib/clientToken';
import { generateRequestSignatureAsync } from '../../lib/requestSignature.client';
import { useTheme } from 'next-themes';
import { useWalletActions } from '../../lib/wallet/useWalletActions';
import { REWARD_WALLET, tFRY } from '../../lib/utils';
import { buildPaymentTxn } from '../../lib/wallet/transactions';
import { WalletRequestInFlightError } from '../../lib/wallet/requestCoordinator.client';
import { useSmartRetry } from '../../lib/hooks/useSmartRetry';
import { getAlgoBalance } from '../../lib/algorand/balances';
import { parseAlgodError } from '../../lib/algorand/errorParser';

export default function BoostModal({
  modalName,
  miner_key,
  no,
  rewardAssetId,
  handleBoost
}: {
  modalName: string;
  miner_key: string;
  no?: number;
  rewardAssetId?: string;
  handleBoost: (ret: boolean, message: string) => Promise<void>;
}) {
  const { modals, closeModal } = useModal();
  const { activeAddress, signAndSubmit } = useWalletActions();
  const [isProcessing, setIsProcessing] = useState(false);
  const toast = useToastContext();
  const [stage, setStage] = useState<'idle'|'paying-fee'|'submitting'|'submitted'|'error'>('idle');
  const [statusText, setStatusText] = useState('');
  const [txIdState, setTxIdState] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const intervalRef = useRef<any>(null);
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme !== 'light';
  const feeRequestLockRef = useRef(false);
  const { executeWithRetry: executeWalletRetry } = useSmartRetry('wallet_signing');

  const isTfryReward = useMemo(
    () => (rewardAssetId ? String(rewardAssetId) === tFRY.id : false),
    [rewardAssetId]
  );

  const feeMicroAlgos = isTfryReward ? 1000 : 2000; // 0.001 for tFRY (direct), 0.002 for fNODE/FVPN (swap + treasury send).
  const feeAlgo = feeMicroAlgos / 1_000_000;
  const MIN_FEE_BUFFER = feeAlgo + 0.001; // small buffer above required fee

  const requestBoostFee = async (from: string | undefined): Promise<boolean> => {
    try {
      if (!from) {
        toast.error({
          heading: 'Wallet not connected',
          message: 'Connect your wallet before using Instant Claim.'
        });
        return false;
      }

      if (feeRequestLockRef.current) {
        toast.info({
          heading: 'Fee payment pending',
          message: 'Finish or cancel the current wallet prompt before retrying the fee payment.'
        });
        return false;
      }

      const algoBalance = await getAlgoBalance(from);
      if (algoBalance === null || algoBalance < MIN_FEE_BUFFER) {
        toast.error({
          heading: 'Insufficient ALGO',
          message: `Instant Claim needs ~${feeAlgo.toFixed(3)} ALGO to cover the network fee for processing the 30% fee. Current balance: ${(algoBalance ?? 0).toFixed(3)} ALGO.`
        });
        return false;
      }

      toast.info({
        heading: 'Signature required',
        message: isTfryReward
          ? 'Approve the 0.001 ALGO network fee so we can send the tFry fee portion to treasury.'
          : 'Approve the 0.002 ALGO network fee so we can swap the 30% fee to FRY 2.0 and send it to treasury.'
      });

      const encodedTxn = await buildPaymentTxn({
        sender: from,
        receiver: REWARD_WALLET,
        amount: feeMicroAlgos,
        useMicroAlgos: true
      });

      feeRequestLockRef.current = true;
      await executeWalletRetry(
        async () => {
          const txIds = await signAndSubmit([encodedTxn], {
            message: 'Authorize instant-claim fee payment'
          });
          if (!txIds.length) {
            throw new Error('Wallet did not provide a transaction id');
          }
          console.debug('[Boost] Fee payment txId', txIds[0]);
        },
        { operationType: 'pay instant-claim fee' }
      );

      return true;
    } catch (error) {
      if (error instanceof WalletRequestInFlightError) {
        toast.info({
          heading: 'Wallet request in progress',
          message: 'Finish or cancel the current wallet prompt, then retry the fee payment.'
        });
        return false;
      }
      const parsed = parseAlgodError(error);
      const logMessage = parsed?.rawMessage ?? (error instanceof Error ? error.message : String(error));
      const userMessage = parsed?.userMessage;
      console.error('[Boost] Fee payment failed:', logMessage);
      if (userMessage) {
        toast.error({
          heading: 'Fee Payment Error',
          message: userMessage
        });
      }
      return false;
    } finally {
      feeRequestLockRef.current = false;
    }
  };

  const boostRewards = async () => {
    setIsProcessing(true);
    setStage('paying-fee');
    setStatusText(
      isTfryReward
        ? 'Paying 0.001 ALGO network fee for instant claim...'
        : 'Paying 0.002 ALGO network fee for instant claim...'
    );
    const walletAddress = activeAddress ?? null;

    if (!walletAddress) {
      toast.error({
        heading: 'Wallet not connected',
        message: 'Connect your wallet before using Instant Claim.'
      });
      setIsProcessing(false);
      setStage('error');
      return;
    }

    const feePaid = await requestBoostFee(walletAddress);
    if (!feePaid) {
      setIsProcessing(false);
      setStage('error');
      return;
    }

    setStage('submitting');
    setStatusText('Submitting instant claim...');
    try {
      const clientToken = await getClientToken();
      
      // Generate request signature for extra security
      const body = no ? { miner_key: miner_key, no: no } : { miner_key: miner_key };
      const timestamp = Math.floor(Date.now() / 1000);
      const signature = await generateRequestSignatureAsync('POST', '/api/rewards/boost', body, timestamp);
      
      const response = await fetch('/api/rewards/boost', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-client-token': clientToken,
          'x-request-signature': signature,
          'x-request-timestamp': timestamp.toString()
        },
        body: JSON.stringify(body)
      });

      const result = await response.json();
      console.log("Boost without response.ok: ", result, response);
      if (!response.ok) {
        console.log("Boost within response.ok: ", response);
        const code = result?.code as string | undefined;
        const friendly =
          code === 'NO_REWARDS'
            ? 'No pending rewards to boost. If this reward is already claimable, use Claim instead or refresh the page if you believe this is not right.'
          : code === 'UNAUTHORIZED'
            ? 'Unauthorized. Make sure you are signed in with the device wallet.'
          : code === 'SWAP_FAILED'
            ? 'Swap failed while converting fee to FRY 2.0. Please try again later.'
          : code === 'INSUFFICIENT_SWAP_AMOUNT'
            ? 'Amount too small to swap for FRY 2.0. Try a different reward or claim normally.'
          : code === 'WALLET_ASSET_NOT_OPTED_IN'
            ? result?.action ||
              `Your reward wallet must opt into ${result?.assetId ?? 'this asset'} before using Instant Claim.`
          : result?.message || 'Server error';
        toast.error({
          heading: 'Instant Claim Error',
          message: friendly
        });

        setStage('error');
        setStatusText('Instant claim failed: ' + friendly);
        setIsProcessing(false);
        return;
      }

      console.log("Boost result.success: ", result.success);

      if (result.success) {
        setStage('submitted');
        setStatusText('Transaction broadcasted. Waiting for confirmation...');
        setTxIdState(result.txId);
        // Keep modal open and update device totals soon after
        setIsProcessing(true);
        handleBoost(true, '');

        // Optional background confirm and refresh
        try {
          const txId = result.txId;
          if (txId) {
            startConfirmationWatcher(
              txId,
              async () => {
                toast.success({
                  heading: 'Instant Claim Confirmed',
                  content: (
                    <div>
                      <div>30% fee paid in FRY 2.0.</div>
                      <div>70% moved to Claimable.</div>
                      <div>
                        TxId: <a className="underline break-all" href={`https://explorer.perawallet.app/tx/${txId}`} target="_blank" rel="noreferrer">{txId}</a>
                      </div>
                    </div>
                  )
                });
                await handleBoost(true, 'Boost confirmed');
                setIsProcessing(false);
                setStage('idle');
                setTxIdState(null);
                setSecondsLeft(null);
                if (intervalRef.current) clearInterval(intervalRef.current);
                closeModal(modalName);
              },
              {
                onAttempt: (i, delay) => {
                  const secs = Math.ceil(delay / 1000);
                  setSecondsLeft(secs);
                  setStatusText(`Waiting for confirmation… retry in ${secs}s (attempt ${i + 1})`);
                  if (intervalRef.current) clearInterval(intervalRef.current);
                  intervalRef.current = setInterval(() => {
                    setSecondsLeft((s) => (s && s > 0 ? s - 1 : 0));
                  }, 1000);
                },
                onTimeout: () =>
                  toast.info({ heading: 'Network Confirmation', message: 'Still confirming on network; this can take a bit.' })
              }
            );
          }
        } catch {}
      } else {
        const code = result?.code as string | undefined;
        const friendly =
          code === 'NO_REWARDS'
            ? 'No pending rewards to boost. If this reward is already claimable, use Claim instead or refresh the page if you believe this is not right.'
          : code === 'UNAUTHORIZED'
            ? 'Unauthorized. Make sure you are signed in with the device wallet.'
          : code === 'SWAP_FAILED'
            ? 'Swap failed while converting fee to FRY 2.0. Please try again later.'
          : code === 'INSUFFICIENT_SWAP_AMOUNT'
            ? 'Amount too small to swap for FRY 2.0. Try a different reward or claim normally.'
          : code === 'WALLET_ASSET_NOT_OPTED_IN'
            ? result?.action ||
              `Your reward wallet must opt into ${result?.assetId ?? 'this asset'} before using Instant Claim.`
          : result?.message || 'Unknown error';
        toast.error({
          heading: 'Instant Claim Error',
          message: friendly
        });
        setStage('error');
        setStatusText('Instant claim failed: ' + friendly);
        setIsProcessing(false);
        return;
      }
    } catch (error) {
      toast.error({
        heading: 'Instant Claim Error',
        message: 'Error on server side'
      });

      setStage('error');
      setStatusText('Unexpected error. Please try again.');
      setIsProcessing(false);
      return;
    }
    // do not clear processing state here; watcher or error paths will
  };

  return (
    <div>
      <Dialog
        open={modals[modalName]}
        onClose={() => {
          if (isProcessing || stage === 'submitting' || stage === 'submitted' || stage === 'paying-fee') return;
          closeModal(modalName);
        }}
        static={true}
        className="z-[180]"
      >
        <DialogPanel
          className={`max-w-full sm:max-w-xl min-h-[100dvh] sm:min-h-0 rounded-none sm:rounded-2xl ${isDark ? 'bg-gray-900 text-gray-100' : 'bg-white text-slate-900'}`}
          style={{ marginTop: 'calc(var(--navbar-height, 64px) + 12px)' }}
        >
          <div className="absolute right-0 top-0 pr-3 pt-3">
            <button
              type="button"
              className="rounded-tremor-small p-2 text-tremor-content-subtle hover:bg-tremor-background-subtle hover:text-tremor-content dark:text-dark-tremor-content-subtle hover:dark:bg-dark-tremor-background-subtle hover:dark:text-tremor-content"
              disabled={isProcessing || stage === 'submitting' || stage === 'submitted' || stage === 'paying-fee'}
              aria-disabled={isProcessing || stage === 'submitting' || stage === 'submitted' || stage === 'paying-fee'}
              onClick={() => { if (!(isProcessing || stage === 'submitting' || stage === 'submitted' || stage === 'paying-fee')) closeModal(modalName); }}
              aria-label="Close"
            >
              <RiCloseLine className="h-5 w-5 shrink-0" aria-hidden={true} />
            </button>
          </div>
          <Title className={`mb-5 ${isDark ? 'text-gray-100' : 'text-slate-900'}`}>Instant Claim</Title>
          <Flex
            flexDirection="col"
            alignItems="stretch"
            justifyContent="center"
            className={`gap-3 w-full mt-5 ${isDark ? 'text-gray-100' : 'text-slate-900'}`}
          >
            <div className={`space-y-2 text-sm ${isDark ? 'text-gray-100' : 'text-gray-800'}`}>
              <p>
                Are you sure you want to claim this reward instantly? A <span className="font-semibold text-red-600">30% fee</span> is deducted, while the remaining 70% moves straight to your Claimable.
              </p>
              <p className={`text-xs ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                This action cannot be undone.
              </p>
              <p className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
                Instant Claim requires a small {feeAlgo.toFixed(3)} ALGO top-up so the rewards vault can process the 30% fee
                {isTfryReward ? ' directly in tFry' : ' (swap to FRY 2.0 and forward it to treasury)'}.
                We’ll prompt your wallet for this fee first.
              </p>
            </div>
            {isProcessing && (
              <>
                <p className={`text-sm ${isDark ? 'text-gray-200' : 'text-gray-700'}`}>{statusText}</p>
                <p className={`text-xs ${isDark ? 'text-gray-300' : 'text-gray-500'}`}>
                  Please wait until you see the TxID notification. Do not close this window — it will close automatically after confirmation.
                </p>
              </>
            )}
          </Flex>
          <Flex
            flexDirection="row"
            justifyContent="center"
            className="gap-3 w-full mt-5"
          >
            <Button
              className={`bg-transparent border-red-600 hover:bg-red-600 hover:border-red-600 ${isDark ? 'text-white' : 'text-slate-900'}`}
              disabled={isProcessing || stage === 'submitting' || stage === 'submitted' || stage === 'paying-fee'}
              aria-disabled={isProcessing || stage === 'submitting' || stage === 'submitted' || stage === 'paying-fee'}
              onClick={() => {
                if (isProcessing || stage === 'submitting' || stage === 'submitted' || stage === 'paying-fee') return;
                closeModal(modalName);
              }}
            >
              Close
            </Button>
            <Button
              className={`relative flex items-center justify-center bg-transparent border-red-600 hover:bg-red-600 hover:border-red-600 ${isDark ? 'text-white' : 'text-slate-900'} ${
                isProcessing ? 'cursor-not-allowed' : 'cursor-default'
              }`}
              disabled={isProcessing || stage === 'submitting' || stage === 'submitted' || stage === 'paying-fee'}
              aria-disabled={isProcessing || stage === 'submitting' || stage === 'submitted' || stage === 'paying-fee'}
              onClick={() => { if (!(isProcessing || stage === 'submitting' || stage === 'submitted' || stage === 'paying-fee')) boostRewards(); }}
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
              'Instant Claim'
            )}
            </Button>
          </Flex>
          {stage === 'submitted' && txIdState && (
            <div className="mt-3 text-sm text-gray-700">
              {secondsLeft !== null && (
                <div>Next retry in {secondsLeft}s</div>
              )}
              <div>
                TxId: <a className="underline break-all" href={`https://explorer.perawallet.app/tx/${txIdState}`} target="_blank" rel="noreferrer">{txIdState}</a>
              </div>
            </div>
          )}
        </DialogPanel>
      </Dialog>
    </div>
  );
}
