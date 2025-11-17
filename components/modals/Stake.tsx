import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useRouter } from 'next/router';
import { Device, FryToken, Product } from '../../lib/types';
import { getFRYPrice } from '../../lib/price';
import { verifyTransactionRequest, VERIFY_RESULT } from '../../lib/algorand/verification';
import { useModal } from '../../app/modalcontext';
import {
  Dialog,
  DialogPanel,
  Title,
  Flex,
  TextInput,
  Button
} from '@tremor/react';
import { RiCloseLine } from '@remixicon/react';
import { getAssetBalance as getStakeAssetBalance, getAlgoBalance } from '../../lib/algorand/balances';
import { useSession } from 'next-auth/react';
import MessageUpdate from '../messageUpdate';
import { useWalletActions } from '../../lib/wallet/useWalletActions';
import { buildAssetTransferTxn } from '../../lib/wallet/transactions';
import { WalletRequestInFlightError } from '../../lib/wallet/requestCoordinator.client';
import { useToastContext } from '../../hooks/ToastContext';
import { useSmartRetry } from '../../lib/hooks/useSmartRetry';
// Added secure fetch helper so API calls automatically include security headers.
import { secureFetch } from '../../lib/api/secureFetch';

const devMode =
  process.env.NEXT_PUBLIC_DEV_MODE &&
  process.env.NEXT_PUBLIC_DEV_MODE === 'true';

const testMode =
  process.env.NEXT_PUBLIC_TEST_MODE &&
  process.env.NEXT_PUBLIC_TEST_MODE === 'true';

const STAKE_ADDRESS =
  'UKVAN7ORIUX7Y6QJFYQ4YGQAZD3RAC7QTDB73S2E5MSILUWAA7FJ6N7WLU';

const token = '';
const server = 'https://xna-mainnet-api.algonode.cloud/';
const tokenToSend = { 'X-API-Key': token };
const port = '';

const StakeModal = ({
  modalName,
  device,
  product,
  handleStakingUpdate,
  stakeContext = 'verification'
}: {
  modalName: string;
  device: Device;
  product: Product;
  handleStakingUpdate: (device: Device) => void;
  stakeContext?: 'verification' | 'registration' | 'node';
}) => {
  const { activeAddress, signAndSubmit } = useWalletActions();
  const { modals, openModal, closeModal } = useModal();
  const [stakeType, setStateType] = useState<string>('one');
  const [tokenName, setTokenName] = useState('');
  const [stakeAmount, setStakeAmount] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const { data: session } = useSession();
  const toast = useToastContext();
  const effectiveContext = stakeContext ?? 'verification';
  const registrationStakeUsd = useMemo(() => {
    const baseUsd = product?.reward?.stake?.register ?? 0;
    if (!device?.byod) return baseUsd;
    return Math.round((baseUsd / 2) * 100) / 100;
  }, [product?.reward?.stake?.register, device?.byod]);
  const nodeStakeUsd = useMemo(() => product?.reward?.stake?.node ?? 0, [product?.reward?.stake?.node]);
  const formatUsdDisplay = useCallback((value?: number) => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
    return value.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }, []);
  const requirementDescription = useMemo(() => {
    if (effectiveContext === 'registration') {
      const usdLabel = formatUsdDisplay(registrationStakeUsd);
      const suffix = device?.byod ? ' (BYOD rate)' : '';
      return usdLabel
        ? `Stake $${usdLabel} USD in ${tokenName || 'the staking asset'} to complete device registration${suffix}.`
        : null;
    }
    if (effectiveContext === 'node') {
      const usdLabel = formatUsdDisplay(nodeStakeUsd);
      return usdLabel
        ? `Stake $${usdLabel} USD in ${tokenName || 'the staking asset'} to power your node operations.`
        : null;
    }
    return null;
  }, [effectiveContext, formatUsdDisplay, registrationStakeUsd, nodeStakeUsd, tokenName, device?.byod]);
  const modalTitle = useMemo(() => {
    if (effectiveContext === 'registration') return 'Stake Registration';
    if (effectiveContext === 'node') return 'Stake Node Operation';
    return 'Stake';
  }, [effectiveContext]);
  
  // Single-flight operation state to prevent concurrent wallet operations
  const operationInProgress = useRef(false);
  
  // Retry state management for resilient operations
  const { executeWithRetry: executeWalletRetry } = useSmartRetry('wallet_signing');

  const MINIMUM_ALGO_BUFFER = 0.01; // Require a tiny Algo reserve to cover network fees

  // Added reusable opt-in helper so staking modals can automatically submit the ASA opt-in
  // transaction (0 amount transfer to self) when the wallet has not opted into the stake asset yet.
  const requestAssetOptIn = useCallback(
    async (assetId: string, assetLabel: string): Promise<boolean> => {
      if (!session?.user?.address) {
        return false;
      }
      if (!assetId || assetId === 'none') {
        return true;
      }

      try {
        toast.info({
          heading: 'Opt-in required',
          message: `Approving an opt-in transaction for ${assetLabel}.`
        });

        const optInTxn = await buildAssetTransferTxn({
          sender: session.user.address,
          receiver: session.user.address,
          assetId: Number(assetId),
          amount: 0,
          useRawAmount: true
        });

        await executeWalletRetry(
          async () => {
            const txIds = await signAndSubmit([optInTxn], {
              message: `Opt-in to ${assetLabel}`
            });
            if (!txIds[0]) {
              throw new Error('Opt-in transaction cancelled.');
            }
            return txIds[0];
          },
          { operationType: 'asset opt-in' }
        );

        toast.success({
          heading: 'Opt-in complete',
          message: `Wallet is now opted into ${assetLabel}.`
        });
        return true;
      } catch (error) {
        const friendly =
          error instanceof Error ? error.message : 'Opt-in transaction failed.';
        toast.error({
          heading: 'Opt-in failed',
          message: friendly
        });
        return false;
      }
    },
    [executeWalletRetry, session?.user?.address, signAndSubmit, toast]
  );

  const fetchTokenInformation = useCallback(async (asset_id: string | undefined) => {
    if (!asset_id) {
      return;
    }

    try {
      const response = await fetch('/api/tokens/get-one', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ asset_id })
      });

      if (!response.ok) {
        setTokenName('Unknown');
        return;
      }

      const result = await response.json();
      setTokenName(result.token?.name || 'Unknown');
    } catch (error) {
      console.error(error);
    }
  }, []);

  useEffect(() => {
    if (!device) {
      return;
    }

    if (!device.staked) {
      return;
    }

    if (device.staked.type) {
      setStateType(device.staked.type);
    }
  }, [device]);

  useEffect(() => {
    if (!product) {
      return;
    }

    if (effectiveContext === 'verification') {
      let nextAmount = 0;
      if (stakeType === 'one') {
        nextAmount = product.reward.stake?.stake_one ?? 0;
      } else {
        nextAmount = product.reward.stake?.stake_two ?? 0;
      }
      if (device.byod && device.byod.length > 0) {
        nextAmount = Math.round((nextAmount * 100) / 2) / 100;
      }
      setStakeAmount(nextAmount);
      return;
    }

    let cancelled = false;
    const computeRequirementAmount = async () => {
      const usdAmount = effectiveContext === 'registration' ? registrationStakeUsd : nodeStakeUsd;
      const assetId =
        effectiveContext === 'registration'
          ? product.reward.tokens?.register
          : product.reward.tokens?.node;
      if (!assetId || usdAmount <= 0) {
        if (!cancelled) setStakeAmount(0);
        return;
      }
      try {
        const price = await getFRYPrice(assetId);
        if (!price || !Number.isFinite(price) || price <= 0) {
          if (!cancelled) setStakeAmount(0);
          return;
        }
        const amount = Math.floor(usdAmount / price);
        if (!cancelled) {
          setStakeAmount(amount);
        }
      } catch (error) {
        console.error('[stake-modal] failed to compute stake requirement', error);
        if (!cancelled) {
          setStakeAmount(0);
        }
      }
    };
    computeRequirementAmount();
    return () => {
      cancelled = true;
    };
  }, [product, stakeType, device?.byod, effectiveContext, registrationStakeUsd, nodeStakeUsd]);
  useEffect(() => {
    if (!product) {
      return;
    }
    const assetId =
      effectiveContext === 'registration'
        ? product.reward.tokens?.register
        : effectiveContext === 'node'
          ? product.reward.tokens?.node
          : product.reward.tokens?.stake;
    fetchTokenInformation(assetId);
  }, [
    product,
    effectiveContext,
    product?.reward?.tokens?.register,
    product?.reward?.tokens?.node,
    product?.reward?.tokens?.stake,
    fetchTokenInformation
  ]);

  /**
   * Modern transaction sending with comprehensive error handling and retry logic.
   * 
   * This replaces the legacy sendAlgoTransaction calls with our modern wallet infrastructure:
   * - Uses signAndSubmit for reliable wallet interaction
   * - Handles wallet cancellation gracefully
   * - Provides detailed error context for debugging
   * - Includes operation context in transaction notes for audit trails
   */
  const sendTransaction = useCallback(
    async ({
      from,
      to,
      amount,
      assetIdRaw,
      notePayload,
      walletMessage
    }: {
      from: string;
      to: string;
      amount: number;
      assetIdRaw?: string | null;
      notePayload: Record<string, unknown>;
      walletMessage: string;
    }) => {
      try {
        const enc = new TextEncoder();
        const note = enc.encode(JSON.stringify(notePayload));
        let assetId = 0;
        if (assetIdRaw && assetIdRaw !== 'none') {
          const numeric = Number(assetIdRaw);
          if (!Number.isFinite(numeric)) {
            throw new Error('Stake asset id is not configured in product settings');
          }
          assetId = numeric;
        }

        if (session?.user?.address && assetIdRaw && assetIdRaw !== 'none') {
          const stakeBalance = await getStakeAssetBalance(session.user.address, assetIdRaw);
          if (stakeBalance === null) {
            const optedIn = await requestAssetOptIn(assetIdRaw, tokenName || 'staking asset');
            if (!optedIn) {
              throw new Error(`Opt into ${tokenName || 'this staking asset'} before staking.`);
            }
          }
        }

        const encodedTransaction = await buildAssetTransferTxn({
          sender: from,
          receiver: to,
          assetId,
          amount: testMode ? 0 : amount,
          note,
          useRawAmount: testMode ? true : undefined,
          decimals: 6
        });

        const [txId] = await signAndSubmit([encodedTransaction], {
          message: walletMessage
        });

        if (!txId) {
          throw new Error('No transaction id returned from wallet - transaction may have been cancelled');
        }

        return txId;
      } catch (error) {
        if (error instanceof WalletRequestInFlightError) {
          throw new Error('A wallet request is already in progress. Complete the pending prompt before retrying.');
        }
        if (error instanceof Error) {
          if (error.message.includes('Request Pending')) {
            throw new Error('Another wallet request is pending. Please complete or cancel the existing request first.');
          }
          if (error.message.includes('cancelled')) {
            throw new Error('Transaction was cancelled by user.');
          }
          if (error.message.includes('insufficient')) {
            throw new Error('Insufficient balance to complete the staking transaction.');
          }
        }

        console.error('Modern transaction failed:', error);
        throw error;
      }
    },
    [requestAssetOptIn, session?.user?.address, signAndSubmit, tokenName]
  );

  /**
   * Modern, reliable staking submission with comprehensive error handling and retry logic.
   * 
   * This implements the reliability improvements from the wallet-reliability-plan.md:
   * - Single-flight operations to prevent double submissions
   * - Comprehensive balance checking before wallet interaction
   * - Modern transaction sending with proper error handling
   * - Retry logic for failed operations
   * - Direct server-side API calls (no legacy transaction confirmation)
   * - Progressive user feedback throughout the operation
   */
  const handleSubmit = useCallback(async () => {
    if (operationInProgress.current) {
      toast.warning({
        heading: 'Operation in Progress',
        message: 'A staking operation is already in progress. Please wait for it to complete.'
      });
      return;
    }

    operationInProgress.current = true;
    setIsProcessing(true);
    const context = effectiveContext;

    try {
      if (!session || !session.user) {
        toast.error({
          heading: 'Authorization Error',
          message: 'Please sign in to your wallet to continue.'
        });
        return;
      }

      if (!activeAddress || activeAddress !== session.user.address) {
        toast.error({
          heading: 'Wallet Mismatch',
          message: 'Please connect the wallet you used to sign in.'
        });
        return;
      }

      const asset_id =
        context === 'registration'
          ? product.reward.tokens?.register ?? 'none'
          : context === 'node'
            ? product.reward.tokens?.node ?? 'none'
            : product.reward.tokens?.stake ?? 'none';

      if (!stakeAmount || stakeAmount <= 0) {
        toast.error({
          heading: 'Stake Unavailable',
          message: 'Stake amount could not be determined. Please try again shortly.'
        });
        return;
      }

      toast.info({
        heading: 'Checking balances',
        message:
          context === 'verification'
            ? 'Verifying your wallet has sufficient staking tokens...'
            : 'Verifying your wallet has sufficient tokens for this requirement...'
      });

      const [stakeTokenBalance, algoBalance] = await Promise.all([
        getStakeAssetBalance(session.user.address, asset_id),
        getAlgoBalance(session.user.address)
      ]);

      if (stakeTokenBalance === null || stakeTokenBalance < stakeAmount) {
        toast.error({
          heading: 'Insufficient Balance',
          message: `You need at least ${stakeAmount} ${tokenName || 'tokens'} to stake. Current balance: ${stakeTokenBalance ?? 0}`
        });
        return;
      }

      if (algoBalance === null || algoBalance < MINIMUM_ALGO_BUFFER) {
        toast.error({
          heading: 'Insufficient ALGO',
          message: `You need at least ${MINIMUM_ALGO_BUFFER} ALGO to cover network fees. Current balance: ${algoBalance ?? 0}`
        });
        return;
      }

      // Guard against triggering an on-chain stake when the API rate limit will reject the update.
      const precheckResponse = await secureFetch('/api/stake/precheck', {
        miner_key: device.miner_key,
        address: session.user.address,
        context
      });
      if (!precheckResponse.ok) {
        const details = await precheckResponse.json().catch(() => null);
        toast.error({
          heading: 'Staking Unavailable',
          message: details?.message ?? 'Too many staking requests right now. Please wait before trying again.'
        });
        return;
      }

      toast.info({
        heading: 'Signature Required',
        message:
          context === 'verification'
            ? `Please approve the ${stakeType === 'one' ? '24-hour' : '6-month'} staking transaction in your wallet.`
            : `Please approve the ${context === 'registration' ? 'registration' : 'node'} staking transaction in your wallet.`
      });

      const shortMinerKey = `${device.miner_key.split('-')[0]}-${device.miner_key.split('-')[1].slice(0, 6)}`;
      const notePayload: Record<string, unknown> = {
        action:
          context === 'registration'
            ? 'Registration Staking'
            : context === 'node'
              ? 'Node Staking'
              : 'Verification Staking',
        miner_key: shortMinerKey,
        asset_id,
        type: context === 'verification' ? stakeType : undefined,
        from: session.user.address,
        to: STAKE_ADDRESS,
        amount: stakeAmount,
        operation:
          context === 'registration'
            ? 'registration_staking'
            : context === 'node'
              ? 'node_staking'
              : 'verification_staking',
        timestamp: new Date().toISOString()
      };

      const walletMessage =
        context === 'verification'
          ? `Authorize ${stakeType === 'one' ? '24-hour' : '6-month'} staking of ${stakeAmount} ${tokenName || ''}`
          : `Authorize ${context === 'registration' ? 'registration' : 'node'} staking of ${stakeAmount} ${tokenName || ''}`;

      const txId = await executeWalletRetry(
        () =>
          sendTransaction({
            from: session.user.address!,
            to: STAKE_ADDRESS,
            amount: stakeAmount,
            assetIdRaw: asset_id,
            notePayload,
            walletMessage
          }),
        { operationType: 'stake tokens', amount: stakeAmount }
      );

      if (context !== 'verification') {
        const verifyResult = await verifyTransactionRequest({
          address: session.user.address!,
          txId
        });
        if (verifyResult !== VERIFY_RESULT.OK) {
          toast.error({ heading: 'Error', message: `Confirm ${txId} failed` });
          return;
        }
      }

      toast.info({
        heading: 'Processing',
        message: 'Confirming transaction on blockchain...'
      });

      const endpoint =
        context === 'registration'
          ? '/api/stake/registration'
          : context === 'node'
            ? '/api/stake/node-staking'
            : '/api/stake/verification';

      const payload =
        context === 'verification'
          ? {
              miner_key: device.miner_key,
              address: session.user.address,
              txId,
              amount: stakeAmount,
              type: stakeType,
              asset_id
            }
          : {
              miner_key: device.miner_key,
              address: session.user.address,
              txId,
              amount: stakeAmount,
              asset_id
            };

      const dataResponse = await secureFetch(endpoint, payload);
      const dataResult = await dataResponse.json();
      if (!dataResponse.ok || !dataResult?.success) {
        throw new Error(dataResult?.message || 'Server processing failed');
      }

      const successHeading =
        context === 'registration'
          ? 'Registration Staking Successful'
          : context === 'node'
            ? 'Node Staking Successful'
            : 'Staking Successful';

      toast.success({
        heading: successHeading,
        message:
          context === 'verification'
            ? `${stakeType === 'one' ? '24-hour' : '6-month'} staking completed! Transaction: ${txId}`
            : `Transaction: ${txId}`
      });

      closeModal(modalName);
      handleStakingUpdate(device);
    } catch (error) {
      console.error('Staking operation failed:', error);
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';

      if (errorMessage.includes('cancelled')) {
        toast.warning({
          heading: 'Transaction Cancelled',
          message: 'The staking transaction was cancelled. You can try again when ready.'
        });
      } else if (errorMessage.includes('Request Pending')) {
        toast.warning({
          heading: 'Wallet Busy',
          message: 'Your wallet has a pending request. Please complete or cancel it first, then try again.'
        });
      } else {
        const failureLabel =
          context === 'registration'
            ? 'registration staking'
            : context === 'node'
              ? 'node staking'
              : 'staking';
        toast.error({
          heading: 'Staking Failed',
          message: `Failed to complete ${failureLabel}: ${errorMessage}`
        });
      }
    } finally {
      operationInProgress.current = false;
      setIsProcessing(false);
    }
  }, [
    activeAddress,
    closeModal,
    device,
    effectiveContext,
    executeWalletRetry,
    handleStakingUpdate,
    modalName,
    product.reward.tokens?.node,
    product.reward.tokens?.register,
    product.reward.tokens?.stake,
    sendTransaction,
    session,
    stakeAmount,
    stakeType,
    toast,
    tokenName
  ]);

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
        {/* Mirror withdraw modal palette so staking dialogs stay legible in both themes. */}
        <DialogPanel className="sm:max-w-xl bg-white text-gray-900 dark:bg-gray-900 dark:text-gray-100">
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
          {/* Keep headings consistent with the withdraw modal styling for contrast. */}
          <Title className="mb-5 text-gray-900 dark:text-gray-100">{`${modalTitle}${tokenName ? ` (${tokenName})` : ''}`}</Title>
          {/* Use explicit text colors so staking controls stay readable on dark/light backgrounds. */}
          <Flex
            flexDirection="col"
            alignItems="stretch"
            justifyContent="center"
            className="gap-3 w-full mt-5 text-gray-900 dark:text-gray-100"
          >
            {effectiveContext === 'verification' ? (
              <>
                <div className="flex gap-2">
                  <p>BYOD:</p>
                  <p>{device?.byod ? 'Yes' : 'No'}</p>
                </div>

                <div className="flex items-center space-x-2 gap-16">
                  <label className="flex items-center space-x-2">
                    <input
                      type="radio"
                      name="stakeOption"
                      value="one"
                      checked={stakeType === 'one'}
                      onChange={() => setStateType('one')}
                      className="border border-red-600 text-red-600"
                    />
                    <span>24-Hour Staking(1.5x)</span>
                  </label>
                  <label className="flex items-center space-x-2">
                    <input
                      type="radio"
                      name="stakeOption"
                      value="two"
                      checked={stakeType === 'two'}
                      onChange={() => setStateType('two')}
                      className="border border-red-600 text-red-600"
                    />
                    <span>6-months Staking(3x)</span>
                  </label>
                </div>
              </>
            ) : (
              // Match callout styling from withdraw modal for clarity on staking requirements.
              requirementDescription && (
                <div className="rounded-md border border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-700 dark:border-amber-500/40 dark:bg-gray-800 dark:text-gray-100">
                  {requirementDescription}
                </div>
              )
            )}
            <div className="flex items-center w-full space-x-2">
              <label
                htmlFor="stakeAmount"
                className="text-sm font-medium text-gray-700 dark:text-gray-100 text-nowrap"
              >
                Amount to Stake:
              </label>
              <input
                id="stakeAmount"
                type="number"
                min="0"
                className="p-2 w-full border ml-2 text-gray-900 dark:text-gray-100 border-gray-500 dark:border-gray-400 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-red-600 focus:border-red-600 disabled:opacity-50 bg-white dark:bg-gray-800"
                disabled={true}
                value={stakeAmount}
                readOnly
              />
            </div>
          </Flex>
          {/* Align staking action buttons with withdraw modal button colors for uniformity. */}
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
              className={`relative flex items-center justify-center bg-transparent text-white border-red-600 hover:bg-red-600 hover:border-red-600 ${
                isProcessing ? 'cursor-not-allowed opacity-75' : 'cursor-default'
              }`}
              onClick={handleSubmit}
              disabled={isProcessing || stakeAmount <= 0}
            >
              {isProcessing ? (
                <div className="flex items-center gap-2">
                  <svg
                    className="animate-spin h-5 w-5 text-red-500"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                      className="opacity-25"
                    />
                    <path
                      fill="currentColor"
                      d="m4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      className="opacity-75"
                    />
                  </svg>
                  <span>Processing...</span>
                </div>
              ) : (
                'Stake'
              )}
            </Button>
          </Flex>
        </DialogPanel>
      </Dialog>
    </div>
  );
};

export default StakeModal;
