import { Button, Dialog, DialogPanel, Flex, Title } from '@tremor/react';
import { useModal } from '../../app/modalcontext';
import { useRef, useState } from 'react';
import { getSession, useSession } from 'next-auth/react';
import { RiCloseLine } from '@remixicon/react';
import { Device } from '../../lib/types';
import MessageUpdate from '../messageUpdate';
import { useToastContext } from '../../hooks/ToastContext';
import { REWARD_WALLET } from '../../lib/utils';
import { startConfirmationWatcher } from '../../lib/confirmWatcher';
import { getClientToken } from '../../lib/clientToken';
import { generateRequestSignatureAsync } from '../../lib/requestSignature.client';
import { buildPaymentTxn } from '../../lib/wallet/transactions';
import { WalletRequestInFlightError } from '../../lib/wallet/requestCoordinator.client';
import { useWalletActions } from '../../lib/wallet/useWalletActions';
import { useSmartRetry } from '../../lib/hooks/useSmartRetry';
import { getAlgoBalance } from '../../lib/algorand/balances';

const devMode =
  process.env.NEXT_PUBLIC_DEV_MODE &&
  process.env.NEXT_PUBLIC_DEV_MODE === 'true';

type ClaimContext = {
  minerKey?: string;
  rewardNumbers?: number[];
  txId?: string;
};

export default function ClaimModal({
  modalName,
  miner_key,
  no,
  handleClaim
}: {
  modalName: string;
  miner_key: string;
  no?: number;
  handleClaim: (ret: boolean, message: string, context?: ClaimContext) => Promise<void>;
}) {
  const { activeAddress, signAndSubmit } = useWalletActions();
  const { modals, closeModal } = useModal();
  const [isProcessing, setIsProcessing] = useState(false);
  const [stage, setStage] = useState<'idle'|'paying-fee'|'submitting'|'submitted'|'error'>('idle');
  const [statusText, setStatusText] = useState('');
  const [txIdState, setTxIdState] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const intervalRef = useRef<any>(null);
  const { data: session } = useSession();
  const toast = useToastContext();
  const { executeWithRetry: executeWalletRetry } = useSmartRetry('wallet_signing');

  const MIN_FEE_BUFFER = 0.002; // 0.002 ALGO ensures 0.001 fee + safety buffer

  const requestGasFee = async (from: string | undefined): Promise<boolean> => {
    try {
      if (!from) {
        return false;
      }

      const algoBalance = await getAlgoBalance(from);
      if (algoBalance === null || algoBalance < MIN_FEE_BUFFER) {
        toast.error({
          heading: 'Insufficient ALGO',
          message: `Your reward wallet needs at least ${MIN_FEE_BUFFER.toFixed(3)} ALGO to cover the claim fee. Current balance: ${(algoBalance ?? 0).toFixed(3)} ALGO.`
        });
        return false;
      }
      
      toast.info({
        heading: 'Signature required',
        message: 'Approve the fee transaction in your wallet to continue.'
      });

      const encodedTxn = await buildPaymentTxn({
        sender: from,
        receiver: REWARD_WALLET,
        amount: 1000,
        useMicroAlgos: true
      });

      await executeWalletRetry(
        async () => {
          const txIds = await signAndSubmit([encodedTxn], {
            message: 'Authorize network fee payment for reward claim'
          });
          if (!txIds.length) {
            throw new Error('Wallet did not provide a transaction id');
          }
          console.debug('[Claim] Fee payment txId', txIds[0]);
        },
        { operationType: 'pay claim fee' }
      );
      return true;
    } catch (error) {
      if (error instanceof WalletRequestInFlightError) {
        // Let the user know they must resolve the existing wallet dialog first.
        toast.info({
          heading: 'Wallet Request In Progress',
          message: 'Finish or cancel the pending wallet prompt before paying the fee again.'
        });
        return false;
      }
      console.error ("getGasFee : ", error);
      return false;
    }
  };

  const claimRewards = async () => {
    setIsProcessing(true);
    setStage('submitting');
    setStatusText('Submitting claim details to the network coordinator...');
    try {
      const latestSession = await getSession();
      const sessionAddress = latestSession?.user?.address;
      if (!sessionAddress) {
        toast.error({
          heading: 'Session required',
          message: 'Your session expired. Please sign in again before claiming.'
        });
        setStage('error');
        setStatusText('Session expired. Please sign in again.');
        setIsProcessing(false);
        return;
      }

      const walletAddress = activeAddress ?? null;
      if (!walletAddress) {
        toast.error({
          heading: 'Wallet not connected',
          message: 'Connect your wallet before submitting a claim.'
        });
        setStage('error');
        setStatusText('Wallet connection required.');
        setIsProcessing(false);
        return;
      }

      if (walletAddress !== sessionAddress) {
        toast.error({
          heading: 'Wallet mismatch',
          message:
            'The connected wallet differs from your signed-in session. Disconnect and sign back in with the device wallet before claiming.'
        });
        setStage('error');
        setStatusText('Wallet mismatch detected. Please reconnect with the device wallet.');
        setIsProcessing(false);
        return;
      }

      const baseBody = no ? { miner_key, no } : { miner_key };
      const clientToken = await getClientToken();

      const previewTimestamp = Math.floor(Date.now() / 1000);
      const previewSignature = await generateRequestSignatureAsync('POST', '/api/rewards/claim', { ...baseBody, preview: true }, previewTimestamp);

      const previewResponse = await fetch('api/rewards/claim', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-client-token': clientToken,
          'x-request-signature': previewSignature,
          'x-request-timestamp': previewTimestamp.toString()
        },
        body: JSON.stringify({ ...baseBody, preview: true })
      });

      const previewResult = await previewResponse.json().catch(() => ({}));
      if (!previewResponse.ok || previewResult?.success === false) {
        const code = previewResult?.code as string | undefined;
        // Provide targeted messaging for opt-in failures so users know how to unblock the claim.
        const friendly =
          code === 'NO_REWARDS'
            ? 'No claimable rewards. If you just boosted, wait for confirmation and try again.'
            : code === 'UNAUTHORIZED'
            ? 'Unauthorized. Make sure you are signed in with the device wallet.'
            : code === 'DEVICE_MISMATCH'
            ? 'This request came from a different device. Disconnect and sign back in on the original browser.'
            : code === 'WALLET_ASSET_NOT_OPTED_IN'
            ? previewResult?.action ||
              `Your reward wallet must opt into ${previewResult?.assetId ?? 'this asset'} before claiming.`
            : previewResult?.message || 'Server error';
        toast.error({ heading: 'Claim Error', message: friendly });
        setStage('error');
        setStatusText('Claim failed: ' + friendly);
        setIsProcessing(false);
        return;
      }

      if (!devMode) {
        setStage('paying-fee');
        setStatusText('Paying network fee...');
        const isFeePaid = await requestGasFee(walletAddress);
        if (!isFeePaid) {
          toast.error({ heading: 'Fee Payment Error', message: `Failed to pay transaction fee ${walletAddress}` });
          setStage('error');
          setStatusText('Fee payment failed. Please ensure your reward wallet has enough ALGO and try again.');
          setIsProcessing(false);
          return;
        }
      }

      setStage('submitting');
      setStatusText('Finalizing reward transfer with Algorand...');
      // Generate request signature for extra security
      const timestamp = Math.floor(Date.now() / 1000);
      const signature = await generateRequestSignatureAsync('POST', '/api/rewards/claim', baseBody, timestamp);
      
      const response = await fetch('api/rewards/claim', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-client-token': clientToken,
          'x-request-signature': signature,
          'x-request-timestamp': timestamp.toString()
        },
        body: JSON.stringify(baseBody)
      });

      const result = await response.json();
      if (!response.ok) {
        const code = result?.code as string | undefined;
        // Provide targeted messaging for opt-in failures so users know how to unblock the claim.
        const friendly =
          code === 'NO_REWARDS'
            ? 'No claimable rewards. If you just boosted, wait for confirmation and try again.'
            : code === 'UNAUTHORIZED'
            ? 'Unauthorized. Make sure you are signed in with the device wallet.'
            : code === 'DEVICE_MISMATCH'
            ? 'This request came from a different device. Disconnect and sign back in on the original browser.'
            : code === 'WALLET_ASSET_NOT_OPTED_IN'
            ? result?.action ||
              `Your reward wallet must opt into ${result?.assetId ?? 'this asset'} before claiming.`
            : result?.message || 'Server error';
        toast.error({ heading: 'Claim Error', message: friendly });
        setStage('error');
        setStatusText('Claim failed: ' + friendly);
        setIsProcessing(false);
        return;
      }

      const txId = result?.txId ?? result?.result;
      if (!txId) {
        toast.error({ heading: 'Claim Error', message: 'The claim response did not include a transaction id. Please try again.' });
        setStage('error');
        setStatusText('Missing transaction id in server response.');
        setIsProcessing(false);
        return;
      }
      const theMsg = `Claim submitted. TxId: ${txId}`;
      const rewardNumbers = typeof no === 'number' ? [no] : undefined;

      if (result.success) {
        setStage('submitted');
        setStatusText('Reward transfer submitted. Waiting for on-chain confirmation...');
        setTxIdState(txId);
        // Keep modal open to show countdown; optimistically refresh device totals
        setIsProcessing(true);
        await handleClaim(true, theMsg, { minerKey: miner_key, rewardNumbers, txId });

        // Background confirm and soft refresh
        try {
          startConfirmationWatcher(
            txId,
            async () => {
              toast.success({
                heading: 'Claim Confirmed',
                content: (
                  <div>
                    <div>
                      TxId: <a className="underline break-all" href={`https://explorer.perawallet.app/tx/${txId}`} target="_blank" rel="noreferrer">Claim Successful: {txId}</a>
                    </div>
                  </div>
                )
              });
              await handleClaim(true, 'Claim confirmed', { minerKey: miner_key, rewardNumbers, txId });
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
                toast.info({
                  heading: 'Network Confirmation',
                  message: 'Still confirming on network; this can take a bit.'
                })
            }
          );
        } catch {}
      } else {
        const code = result?.code as string | undefined;
        const friendly =
          code === 'NO_REWARDS'
            ? 'No claimable rewards. If you just boosted, wait for confirmation and try again.'
            : code === 'UNAUTHORIZED'
            ? 'Unauthorized. Make sure you are signed in with the device wallet.'
            : result?.message || 'Unknown error';
        toast.error({ heading: 'Claim Error', message: friendly });
        setStage('error');
        setStatusText('Claim failed: ' + friendly);
        setIsProcessing(false);
        return;
      }
    } catch (error) {
      toast.error({ heading: 'Claim Error', message: 'Error on server side' });
      setStage('error');
      setStatusText('Unexpected error. Please try again.');
      setIsProcessing(false);
      return;
    }
    // keep processing until watcher confirms or we error
  };

  return (
    <div>
      <Dialog
        open={modals[modalName]}
        onClose={() => {
          // Block closing while fee/submission/awaiting confirmation
          if (isProcessing || stage === 'paying-fee' || stage === 'submitting' || stage === 'submitted') return;
          closeModal(modalName);
        }}
        static={true}
        className="z-[100]"
      >
        <DialogPanel className="sm:max-w-xl">
          <div className="absolute right-0 top-0 pr-3 pt-3">
            <button
              type="button"
              className="rounded-tremor-small p-2 text-tremor-content-subtle hover:bg-tremor-background-subtle hover:text-tremor-content dark:text-dark-tremor-content-subtle hover:dark:bg-dark-tremor-background-subtle hover:dark:text-tremor-content"
              disabled={isProcessing || stage === 'paying-fee' || stage === 'submitting' || stage === 'submitted'}
              aria-disabled={isProcessing || stage === 'paying-fee' || stage === 'submitting' || stage === 'submitted'}
              onClick={() => { if (!(isProcessing || stage === 'paying-fee' || stage === 'submitting' || stage === 'submitted')) closeModal(modalName); }}
              aria-label="Close"
            >
              <RiCloseLine className="h-5 w-5 shrink-0" aria-hidden={true} />
            </button>
          </div>
          <Title className="mb-5">Claim Rewards</Title>
          <Flex
            flexDirection="col"
            alignItems="stretch"
            justifyContent="center"
            className="gap-3 w-full mt-5 text-slate-900"
          >
            <p>Do you want to claim the rewards?</p>
            {isProcessing && (
              <>
                <p className="text-sm text-gray-700">{statusText}</p>
                <p className="text-xs text-gray-500">
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
              className="bg-transparent text-slate-900 border-red-600 hover:bg-red-600 hover:border-red-600"
              disabled={isProcessing || stage === 'paying-fee' || stage === 'submitting' || stage === 'submitted'}
              aria-disabled={isProcessing || stage === 'paying-fee' || stage === 'submitting' || stage === 'submitted'}
              onClick={() => {
                if (isProcessing || stage === 'paying-fee' || stage === 'submitting' || stage === 'submitted') return;
                closeModal(modalName);
              }}
            >
              Close
            </Button>
            <Button
              className={`relative flex items-center justify-center bg-transparent text-slate-900 border-red-600 hover:bg-red-600 hover:border-red-600 ${
                isProcessing ? 'cursor-not-allowed' : 'cursor-default'
              }`}
              disabled={isProcessing || stage === 'paying-fee' || stage === 'submitting' || stage === 'submitted'}
              aria-disabled={isProcessing || stage === 'paying-fee' || stage === 'submitting' || stage === 'submitted'}
              onClick={() => { if (!(isProcessing || stage === 'paying-fee' || stage === 'submitting' || stage === 'submitted')) claimRewards(); }}
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
              'Claim'
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
