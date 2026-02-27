import { Button, Dialog, DialogPanel, Flex, Title } from '@tremor/react';
import { useModal } from '../../app/modalcontext';
import { useRef, useState, useEffect } from 'react';
import { getSession, useSession } from 'next-auth/react';
import { RiCloseLine } from '@remixicon/react';
import { Device } from '../../lib/types';
import MessageUpdate from '../messageUpdate';
import { useToastContext } from '../../hooks/ToastContext';
import { REWARD_WALLET, tFRY } from '../../lib/utils';
import { startConfirmationWatcher } from '../../lib/confirmWatcher';
import { getClientToken } from '../../lib/clientToken';
import { generateRequestSignatureAsync } from '../../lib/requestSignature.client';
import { parseAlgodError } from '../../lib/algorand/errorParser';
import { buildPaymentTxn, buildOptInTxn } from '../../lib/wallet/transactions';
import { WalletRequestInFlightError } from '../../lib/wallet/requestCoordinator.client';
import { useWalletActions } from '../../lib/wallet/useWalletActions';
import { useSmartRetry } from '../../lib/hooks/useSmartRetry';
import { getAlgoBalance, getAssetBalance } from '../../lib/algorand/balances';
import { getAuthAddr } from '../../lib/algorand/authAddr';
import { useTheme } from 'next-themes';

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
  reward_db,
  reward_id,
  handleClaim
}: {
  modalName: string;
  miner_key: string;
  no?: number;
  reward_db?: 'main' | 'dbrewards';
  reward_id?: string;
  handleClaim: (ret: boolean, message: string, context?: ClaimContext) => Promise<void>;
}) {
  const { activeAddress, signAndSubmit } = useWalletActions();
  const { modals, closeModal } = useModal();
  const [isProcessing, setIsProcessing] = useState(false);
  const [stage, setStage] = useState<'idle'|'paying-fee'|'submitting'|'submitted'|'error'>('idle');
  const [statusText, setStatusText] = useState('');
  const [txIdState, setTxIdState] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  // State for proactive tFRY opt-in check
  const [optInStatus, setOptInStatus] = useState<'checking' | 'missing' | 'ok'>('checking');
  // State for auto opt-in flow
  const [optInStage, setOptInStage] = useState<'idle' | 'signing' | 'submitting' | 'success' | 'error'>('idle');
  const [optInError, setOptInError] = useState<string | null>(null);
  const intervalRef = useRef<any>(null);
  // Prevent stacking multiple fee-payment prompts; stays true until the wallet resolves.
  const feeRequestLockRef = useRef(false);
  const { data: session } = useSession();
  const toast = useToastContext();
  const { executeWithRetry: executeWalletRetry } = useSmartRetry('wallet_signing');
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme !== 'light';

  // Proactively check if user has opted into tFRY before allowing claim
  useEffect(() => {
    const checkOptIn = async () => {
      if (!activeAddress) {
        setOptInStatus('checking');
        return;
      }
      try {
        const balance = await getAssetBalance(activeAddress, tFRY.id);
        if (balance === null) {
          setOptInStatus('missing');
        } else {
          setOptInStatus('ok');
        }
      } catch {
        // On error, allow claim attempt (server will validate)
        setOptInStatus('ok');
      }
    };
    checkOptIn();
  }, [activeAddress]);

  const MIN_FEE_BUFFER = 0.002; // 0.002 ALGO ensures 0.001 fee + safety buffer
  const OPT_IN_FEE_BUFFER = 0.002; // 0.002 ALGO for opt-in transaction fee

  // Handle automatic ASA opt-in
  const handleOptIn = async () => {
    if (!activeAddress) return;

    setOptInStage('signing');
    setOptInError(null);

    try {
      // Check ALGO balance for tx fee
      const algoBalance = await getAlgoBalance(activeAddress);
      if (algoBalance === null || algoBalance < OPT_IN_FEE_BUFFER) {
        toast.error({
          heading: 'Insufficient ALGO',
          message: `You need at least ${OPT_IN_FEE_BUFFER.toFixed(3)} ALGO to cover the opt-in transaction fee. Current balance: ${(algoBalance ?? 0).toFixed(3)} ALGO.`
        });
        setOptInStage('error');
        setOptInError('Insufficient ALGO for transaction fee');
        return;
      }

      toast.info({
        heading: 'Signature Required',
        message: 'Approve the opt-in transaction in your wallet to continue.'
      });

      // Build opt-in transaction
      const encodedTxn = await buildOptInTxn({
        sender: activeAddress,
        assetId: Number(tFRY.id)
      });

      setOptInStage('submitting');

      // Sign and submit
      await executeWalletRetry(
        async () => {
          const txIds = await signAndSubmit([encodedTxn], {
            message: 'Opt into tFRY to receive rewards'
          });
          if (!txIds.length) {
            throw new Error('Wallet did not return a transaction id');
          }
          console.debug('[Claim] Opt-in txId:', txIds[0]);
        },
        { operationType: 'opt-in' }
      );

      // Wait briefly for indexer to catch up
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Verify opt-in succeeded
      const balance = await getAssetBalance(activeAddress, tFRY.id);
      if (balance !== null) {
        setOptInStatus('ok');
        setOptInStage('success');
        toast.success({
          heading: 'Opt-In Successful',
          message: 'You can now claim your rewards.'
        });
      } else {
        // Try one more time after a longer delay
        await new Promise(resolve => setTimeout(resolve, 3000));
        const retryBalance = await getAssetBalance(activeAddress, tFRY.id);
        if (retryBalance !== null) {
          setOptInStatus('ok');
          setOptInStage('success');
          toast.success({
            heading: 'Opt-In Successful',
            message: 'You can now claim your rewards.'
          });
        } else {
          throw new Error('Opt-in transaction submitted but asset not detected yet. Please wait a moment and try claiming again.');
        }
      }

    } catch (error) {
      if (error instanceof WalletRequestInFlightError) {
        toast.info({
          heading: 'Wallet Request In Progress',
          message: 'Finish or cancel the pending wallet prompt first.'
        });
        setOptInStage('idle');
        return;
      }
      if (isPeraPendingRequestError(error)) {
        toast.info({
          heading: 'Wallet Still Processing',
          message: 'Approve or cancel the existing request in your wallet.'
        });
        setOptInStage('idle');
        return;
      }
      if (isPeraRejectedError(error)) {
        toast.error({
          heading: 'Opt-In Rejected',
          message: 'You rejected the opt-in transaction. Try again when ready.'
        });
        setOptInStage('idle');
        return;
      }

      const msg = error instanceof Error ? error.message : String(error);
      // Check if this might be a rekeyed account issue
      const rekeyMsg = await checkRekeyedAccountError(error, activeAddress);
      if (rekeyMsg) {
        toast.error({
          heading: 'Rekeyed Account',
          message: rekeyMsg
        });
        setOptInStage('error');
        setOptInError(rekeyMsg);
        return;
      }
      console.error('[Claim] Opt-in failed:', msg);
      toast.error({
        heading: 'Opt-In Failed',
        message: 'Could not complete opt-in. Please try again.'
      });
      setOptInStage('error');
      setOptInError(msg);
    }
  };

  const isPeraPendingRequestError = (error: unknown): boolean => {
    const message = typeof error === 'string' ? error : (error as { message?: string })?.message ?? '';
    return /confirmation failed\(4100\)/i.test(message) && /pending/i.test(message);
  };

  const isPeraRejectedError = (error: unknown): boolean => {
    const message = typeof error === 'string' ? error : (error as { message?: string })?.message ?? '';
    return /confirmation failed\(4100\)/i.test(message) && /rejected/i.test(message);
  };

  // Helper to check if a signing error might be due to rekeyed account
  const checkRekeyedAccountError = async (error: unknown, address: string | null): Promise<string | null> => {
    if (!address) return null;
    try {
      const authAddr = await getAuthAddr(address);
      if (authAddr) {
        const shortAuth = `${authAddr.slice(0, 6)}...${authAddr.slice(-4)}`;
        return `Your account is rekeyed. To sign transactions, import the authorizing account (${shortAuth}) into your Pera wallet.`;
      }
    } catch {
      // Ignore lookup errors
    }
    return null;
  };

  const requestGasFee = async (from: string | undefined): Promise<boolean> => {
    try {
      if (!from) {
        return false;
      }

      if (feeRequestLockRef.current) {
        toast.info({
          heading: 'Fee Payment Pending',
          message: 'Finish or cancel the existing wallet prompt before trying to pay the network fee again.'
        });
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

      feeRequestLockRef.current = true;
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
      if (isPeraPendingRequestError(error)) {
        toast.info({
          heading: 'Wallet Still Processing',
          message: 'Your wallet already has a signing request open. Approve or cancel it inside the wallet, then retry.'
        });
        return false;
      }
      if (isPeraRejectedError(error)) {
        toast.error({
          heading: 'Fee Payment Rejected',
          message: 'The fee transaction was rejected in your wallet. Approve the request next time to continue claiming.'
        });
        return false;
      }
      // Check if this might be a rekeyed account issue
      const rekeyMsgFee = await checkRekeyedAccountError(error, from ?? null);
      if (rekeyMsgFee) {
        toast.error({
          heading: 'Rekeyed Account',
          message: rekeyMsgFee
        });
        return false;
      }
      const parsed = parseAlgodError(error);
      const logMessage = parsed?.rawMessage ?? (error instanceof Error ? error.message : String(error));
      const userMessage = parsed?.userMessage;
      console.error('[Claim] Fee payment failed:', logMessage);
      if (userMessage) {
        toast.error({
          heading: 'Fee Payment Error',
          message: userMessage
        });
      }
      return false;
    } finally {
      // Always release the fee lock so users can retry after clearing their wallet state.
      feeRequestLockRef.current = false;
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

      // Include reward source metadata when targeting a single reward in split databases.
      const baseBody = {
        miner_key,
        ...(typeof no === 'number' ? { no } : {}),
        ...(reward_db ? { reward_db } : {}),
        ...(reward_id ? { reward_id } : {})
      };
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
            : code === 'REWARD_VAULT_DEPLETED'
            ? previewResult?.action ||
              'Rewards vault needs to be refilled for this asset, Admins have already been alerted. Please try again shortly.'
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
            : code === 'REWARD_VAULT_DEPLETED'
            ? result?.action ||
              'Rewards vault needs to be refilled for this asset, Admins have already been alerted. Please try again shortly.'
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
            : code === 'REWARD_VAULT_DEPLETED'
            ? result?.action || 'Rewards vault needs to be refilled for this asset, Admins have already been alerted. Please try again shortly.'
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
        className="z-[180]"
      >
        <DialogPanel
          className={`sm:max-w-xl ${isDark ? 'bg-gray-900 text-gray-100' : 'bg-white text-slate-900'}`}
          style={{ marginTop: 'calc(var(--navbar-height, 64px) + 12px)' }}
        >
          <div className="absolute right-0 top-0 pr-3 pt-3">
            <button
              type="button"
              className="rounded-tremor-small p-2 text-tremor-content-subtle hover:bg-tremor-background-subtle hover:text-tremor-content dark:text-dark-tremor-content-subtle hover:dark:bg-dark-tremor-background-subtle hover:dark:text-tremor-content"
              disabled={isProcessing || stage === 'paying-fee' || stage === 'submitting' || stage === 'submitted' || optInStatus !== 'ok'}
              aria-disabled={isProcessing || stage === 'paying-fee' || stage === 'submitting' || stage === 'submitted' || optInStatus !== 'ok'}
              onClick={() => { if (!(isProcessing || stage === 'paying-fee' || stage === 'submitting' || stage === 'submitted')) closeModal(modalName); }}
              aria-label="Close"
            >
              <RiCloseLine className="h-5 w-5 shrink-0" aria-hidden={true} />
            </button>
          </div>
          <Title className={`mb-5 ${isDark ? 'text-gray-100' : 'text-slate-900'}`}>Claim Rewards</Title>
          <Flex
            flexDirection="col"
            alignItems="stretch"
            justifyContent="center"
            className={`gap-3 w-full mt-5 ${isDark ? 'text-gray-100' : 'text-slate-900'}`}
          >
            <p>Do you want to claim the rewards?</p>
            {optInStatus === 'missing' && (
              <div className="mt-3 p-3 bg-amber-100 dark:bg-amber-900/30 border border-amber-300 dark:border-amber-700 rounded-lg">
                <p className="text-amber-800 dark:text-amber-200 text-sm mb-2">
                  <strong>Action Required:</strong> You need to opt into tFRY before claiming rewards.
                </p>
                <Button
                  onClick={handleOptIn}
                  disabled={optInStage === 'signing' || optInStage === 'submitting'}
                  className="w-full bg-amber-600 hover:bg-amber-700 text-white border-amber-600"
                >
                  {optInStage === 'signing' ? 'Approve in wallet...' :
                   optInStage === 'submitting' ? 'Submitting...' :
                   'Opt In Now'}
                </Button>
                {optInError && (
                  <p className="text-red-600 dark:text-red-400 text-xs mt-2">{optInError}</p>
                )}
              </div>
            )}
            {optInStatus === 'checking' && (
              <div className="text-sm text-gray-500 dark:text-gray-400 mt-2">
                Checking wallet opt-in status...
              </div>
            )}
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
              disabled={isProcessing || stage === 'paying-fee' || stage === 'submitting' || stage === 'submitted' || optInStatus !== 'ok'}
              aria-disabled={isProcessing || stage === 'paying-fee' || stage === 'submitting' || stage === 'submitted' || optInStatus !== 'ok'}
              onClick={() => {
                if (isProcessing || stage === 'paying-fee' || stage === 'submitting' || stage === 'submitted') return;
                closeModal(modalName);
              }}
            >
              Close
            </Button>
            <Button
              className={`relative flex items-center justify-center bg-transparent border-red-600 hover:bg-red-600 hover:border-red-600 ${isDark ? 'text-white' : 'text-slate-900'} ${
                isProcessing ? 'cursor-not-allowed' : 'cursor-default'
              }`}
              disabled={isProcessing || stage === 'paying-fee' || stage === 'submitting' || stage === 'submitted' || optInStatus !== 'ok'}
              aria-disabled={isProcessing || stage === 'paying-fee' || stage === 'submitting' || stage === 'submitted' || optInStatus !== 'ok'}
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
