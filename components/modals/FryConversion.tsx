import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Button,
  Dialog,
  DialogPanel,
  Flex,
  Title,
  Select,
  SelectItem
} from '@tremor/react';
import Image, { StaticImageData } from 'next/image';
import { FryConversion } from '../../lib/types';
import { useModal } from '../../app/modalcontext';
import { RiCloseLine } from '@remixicon/react';
import { useSession } from 'next-auth/react';
import { useToastContext } from '../../hooks/ToastContext';
import { useTheme } from 'next-themes';
import {
  BURN_WALLET,
  FRY_1,
  FRY_2,
  fNODE,
  CORE_RELEASE_DATE,
  ALL_RELEASE_DATE,
  MODS_RELEASE_DATE
} from '../../lib/utils';
import ProgressMonthBar from '../ProgressMonthBar';
import { useWalletActions } from '../../lib/wallet/useWalletActions';
import { buildAssetTransferTxn } from '../../lib/wallet/transactions';
import { WalletRequestInFlightError } from '../../lib/wallet/requestCoordinator.client';
import { useSmartRetry } from '../../lib/hooks/useSmartRetry';
import CopyAddress from '../CopyAddress';
import fry2OptInQr from '../../opt-in-qrcodes/FRY2-Opt-in.png';
import fNodeOptInQr from '../../opt-in-qrcodes/fNode-Opt-in.png';

const testMode = process.env.NEXT_PUBLIC_TEST_MODE === 'true';

export default function FryConversionModal({
  modalName,
  address,
  onClose,
  rewardMode = 'FRY2'
}: {
  modalName: string;
  address: string | undefined;
  onClose: () => void;
  rewardMode?: string;
}) {
  const { activeAddress, signAndSubmit } = useWalletActions();
  const getTokenDisplayForMode = (mode: string) => {
    return mode === 'FRY3' ? 'FRY' : 'FRY 2.0';
  };
  const fryTokenName = getTokenDisplayForMode(rewardMode || 'FRY2');

  const { modals, closeModal } = useModal();
  const [account, setAccount] = useState<FryConversion | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isConverted, setIsConverted] = useState(false);
  const [selectedTokenType, setSelectedTokenType] = useState('2485314946');
  // When wallet opt-in is missing, capture a guide (ASA id + QR) to unblock the user directly.
  const [optInGuide, setOptInGuide] = useState<{
    assetId: string;
    label: string;
    src: StaticImageData;
  } | null>(null);
  
  // Support-driven reconcile UI state
  const [showReconcile, setShowReconcile] = useState(false);
  const [reconcileTxId, setReconcileTxId] = useState('');

  const { data: session } = useSession();
  const toast = useToastContext();
  const { executeWithRetry: executeWalletRetry } = useSmartRetry('wallet_signing');
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme !== 'light';


  type BurnResult =
    | { status: 'success'; txId: string }
    | { status: 'cancelled' }
    | { status: 'error'; reason?: string };

  // Detect Algod "already committed" responses so we can treat retry burns as idempotent.
  const DUPLICATE_BURN_REGEX =
    /TransactionPool\.Remember: transaction\s+([A-Z0-9]+).*already\s+(?:committed|on the queue)/i;

  // Decode byte arrays (Buffer/Uint8Array) into readable strings so logs stay useful.
  const decodeByteSequence = (value: ArrayLike<number>): string | undefined => {
    if (typeof TextDecoder === 'undefined') {
      return undefined;
    }
    try {
      return new TextDecoder().decode(Uint8Array.from(value));
    } catch {
      return undefined;
    }
  };

  // Normalize the various body shapes Algod uses (Buffer, Uint8Array, JSON) into text.
  const decodeAlgodResponseBody = (body: unknown): string | undefined => {
    if (!body) {
      return undefined;
    }

    if (typeof body === 'string') {
      return body;
    }

    if (body instanceof ArrayBuffer) {
      return decodeByteSequence(new Uint8Array(body));
    }

    if (
      typeof body === 'object' &&
      body !== null &&
      ArrayBuffer.isView(body as any)
    ) {
      // TypedArray/Buffer body; decode directly.
      return decodeByteSequence(body as ArrayLike<number>);
    }

    if (
      Array.isArray(body) &&
      body.every((value) => typeof value === 'number')
    ) {
      return decodeByteSequence(body as ArrayLike<number>);
    }

    if (typeof body === 'object' && body !== null) {
      const typedBody = body as Record<string, unknown>;

      if (typeof typedBody.message === 'string') {
        return typedBody.message;
      }

      if (
        typedBody.type === 'Buffer' &&
        Array.isArray(typedBody.data) &&
        typedBody.data.every((value) => typeof value === 'number')
      ) {
        return decodeByteSequence(typedBody.data as ArrayLike<number>);
      }

      const keys = Object.keys(typedBody);
      const allNumeric = keys.length > 0 && keys.every((key) => /^\d+$/.test(key));

      if (allNumeric) {
        const orderedBytes: number[] = [];
        for (const key of keys.sort((a, b) => Number(a) - Number(b))) {
          const value = typedBody[key];
          if (typeof value !== 'number') {
            return undefined;
          }
          orderedBytes.push(value);
        }
        return decodeByteSequence(orderedBytes);
      }
    }

    return undefined;
  };

  // Extract a readable error string plus duplicate transaction ids so UI logic stays clean.
  const extractBurnErrorDetails = (
    error: unknown
  ): { friendlyMessage?: string; duplicateTxId?: string } => {
    let baseMessage: string | undefined;
    if (typeof error === 'string') {
      baseMessage = error;
    } else if (
      error &&
      typeof error === 'object' &&
      'message' in error &&
      typeof (error as { message?: unknown }).message === 'string'
    ) {
      baseMessage = (error as { message?: string }).message;
    }

    const responseBody = (error as { response?: { body?: unknown } })?.response
      ?.body;
    const bodyMessage = decodeAlgodResponseBody(responseBody);

    // Merge the error message and Algod body for consistent parsing downstream.
    const parts = [baseMessage, bodyMessage].filter(
      (part): part is string =>
        typeof part === 'string' && part.trim().length > 0
    );
    const combinedMessage =
      parts.length > 0 ? parts.join(' | ') : baseMessage ?? bodyMessage;

    const duplicateMatch =
      combinedMessage && combinedMessage.match(DUPLICATE_BURN_REGEX);
    const duplicateTxId = duplicateMatch?.[1];

    return { friendlyMessage: combinedMessage, duplicateTxId };
  };

  // Map ASA ids to opt-in guidance so the UI can surface QR codes + ASA IDs when claims fail.
  const getOptInGuide = (assetId?: string | number) => {
    const normalized = String(assetId ?? '');
    if (!normalized) return null;
    if (normalized === FRY_2.id) {
      return { assetId: FRY_2.id, label: fryTokenName, src: fry2OptInQr };
    }
    if (normalized === fNODE.id) {
      return { assetId: fNODE.id, label: 'fNODE', src: fNodeOptInQr };
    }
    return null;
  };

  const transferToBurn = async (
    from: string | undefined,
    amount: number
  ): Promise<BurnResult> => {
    try {
      if (from === undefined) {
        return { status: 'error', reason: 'Missing sender address' };
      }

      const to = BURN_WALLET;

      toast.info({
        heading: 'Signature required',
        message: 'Approve the burn transaction in your wallet to continue.'
      });

      const encodedTxn = await buildAssetTransferTxn({
        sender: from.toString(),
        receiver: to.toString(),
        amount: testMode ? 0 : amount,
        assetId: Number(FRY_1.id),
        useRawAmount: testMode
      });

      const txId = await executeWalletRetry(
        async () => {
          const [signedTxId] = await signAndSubmit([encodedTxn], {
            message: 'Authorize FRY burn transfer'
          });
          if (!signedTxId) {
            throw new Error('Transaction id missing');
          }
          return signedTxId;
        },
        { operationType: 'FRY burn', amount }
      );

      console.log('Burn Transfer TxId: ', txId);

      if (txId) {
        return { status: 'success', txId };
      }
      return { status: 'error', reason: 'Transaction broadcast returned no txId' };
    } catch (error) {
      if (error instanceof WalletRequestInFlightError) {
        // Inform the user rather than failing silently when another wallet prompt is active.
        toast.info({
          heading: 'Wallet Request In Progress',
          message: 'Finish the current wallet prompt, then retry the conversion.'
        });
        return { status: 'error', reason: 'Wallet request already in progress' };
      }
      const { friendlyMessage, duplicateTxId } = extractBurnErrorDetails(error);

      if (duplicateTxId) {
        // Let the user know we reused their prior burn rather than spamming a failure toast.
        toast.info({
          heading: 'Burn Already Submitted',
          message: 'We found an earlier burn for this wallet and will reuse it.'
        });
        console.warn('Burn Transfer Already Committed: ', duplicateTxId);
        return { status: 'success', txId: duplicateTxId };
      }

      const normalizedMessage = friendlyMessage ?? 'Unknown error';
      // Emit the cleaned message only to keep binary payloads out of structured logs.
      console.error('Burn Transfer Error: ', normalizedMessage);

      if (/reject|denied|cancel/i.test(normalizedMessage)) {
        return { status: 'cancelled' };
      }

      return { status: 'error', reason: normalizedMessage };
    }
  };

  const modalOpen = Boolean(modals[modalName]);

  const fetchConversionStatus = useCallback(async () => {
    if (!modalOpen) {
      return;
    }

    if (!session || !session.user) {
      console.log('Session invalid');
      return;
    }

    try {
      // Use absolute path so modal works from any route.
      const response = await fetch('/api/conversion/get_fry_conversion', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          address: session.user.address,
          convertType: selectedTokenType
        })
      });

      if (!response.ok) {
        toast.error({
          heading: 'Error',
          message: 'Network error to get account status for conversion'
        });
        return;
      }

      const result = await response.json();
      setIsConverted(result.user.status === 'pending' ? true : false);
      setAccount(result.user);
    } catch (error) {}
  }, [modalOpen, selectedTokenType, session, toast]);

  // Start closed so the first render with an open modal triggers the initial fetch.
  const prevModalOpen = useRef<boolean>(false);
  const prevSelectedToken = useRef<string>(selectedTokenType);

  useEffect(() => {
    // Only clear opt-in hints when the modal newly opens or the target asset changes, not on every render.
    const justOpened = modalOpen && !prevModalOpen.current;
    const tokenChanged = modalOpen && prevSelectedToken.current !== selectedTokenType;
    const needsFirstLoad = modalOpen && !account;

    if (justOpened || tokenChanged || needsFirstLoad) {
      setOptInGuide(null);
      prevSelectedToken.current = selectedTokenType;
      void fetchConversionStatus();
    }

    // Reset state when the modal closes so the next open starts clean.
    if (!modalOpen) {
      setOptInGuide(null);
    }

    prevModalOpen.current = modalOpen;
    if (modalOpen) {
      prevSelectedToken.current = selectedTokenType;
    }
  }, [modalOpen, selectedTokenType, fetchConversionStatus, account]);

  const handleConvert = async () => {
    setIsProcessing(true);

    if (isConverted) {
      try {
        const response = await fetch('/api/conversion/transfer_reward', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            address: address,
            convertType: selectedTokenType
          })
        });

        if (!response.ok) {
          const failure = await response.json().catch(() => null);
          const failureCode = failure?.code as string | undefined;
          const failureAssetId = (failure?.assetId ?? failure?.asset_id ?? selectedTokenType) as string;
          const optInHint =
            failureCode === 'WALLET_ASSET_NOT_OPTED_IN' ||
            /opt\s*in/i.test(failure?.action || '') ||
            /opt\s*in/i.test(failure?.message || '');
          const guide = optInHint ? getOptInGuide(failureAssetId) : null;
          if (guide) {
            setOptInGuide(guide); // Show inline opt-in QR/ASA guidance for desktop/mobile.
          }
          const message =
            guide
              ? failure?.action ||
                `Your wallet must opt into ${guide.label} (ASA ${guide.assetId}) before claiming. Scan the QR below or paste the ASA ID in your wallet, then retry.`
              : failure?.action ||
                (failure && typeof failure.message === 'string' && failure.message) ||
                'Unable to process FRY conversion claim';
          toast.error({ heading: 'Claim Error', message });

          setIsProcessing(false);
          return;
        }

        const result = await response.json();
        if (result.success) {
          toast.success({
            heading: 'Claim Successful',
            message: `${result.message}`
          });
          setOptInGuide(null);
        } else {
          const failedAssetId = result?.assetId ?? result?.asset_id ?? selectedTokenType;
          const failedGuide =
            result?.code === 'WALLET_ASSET_NOT_OPTED_IN' ||
            /opt\s*in/i.test(result?.action || '') ||
            /opt\s*in/i.test(result?.message || '')
              ? getOptInGuide(failedAssetId)
              : null;
          if (failedGuide) {
            setOptInGuide(failedGuide);
          }
          toast.error({
            heading: 'Claim Error',
            message: result?.action ? `${result.message} — ${result.action}` : `${result.message}`
          });
        }

        setIsProcessing(false);
        closeModal(modalName);
        return;
      } catch (error) {
        console.error('[FryConversion] Claim flow failed', error);

        toast.error({
          heading: 'Claim Error',
          message:
            'We could not finalize your FRY conversion. Check your wallet for pending prompts, ensure the destination is opted in, then retry.'
        });
        setIsProcessing(false);
        return;
      }
    } else {
      try {
        if (account) {
          const burnResult = await transferToBurn(address, account.amount);

          if (burnResult.status === 'success') {
            const response = await fetch('/api/conversion/set_fry_conversion', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                address: session?.user.address,
                id: burnResult.txId
              })
            });

            if (!response.ok) {
              const failure = await response.json();
              toast.error({
                heading: 'Conversion Error',
                message: failure.message
              });

              setIsProcessing(false);
              return;
            }

            const result = await response.json();
            if (result.success) {
              toast.success({
                heading: 'Conversion Successful',
                message: `${result.message}`
              });
              // Quick refresh of conversion state
              if (result.user) {
                setAccount(result.user);
                setIsConverted(result.user.status === 'pending');
              } else {
                await fetchConversionStatus();
              }
            } else {
              toast.error({
                heading: 'Conversion Error',
                message: `${result.message}`
              });
            }
          } else if (burnResult.status === 'cancelled') {
            toast.info({
              heading: 'Conversion Cancelled',
              message: 'Burn transaction was cancelled in your wallet. No changes were made.'
            });
          } else {
            toast.error({
              heading: 'Conversion Error',
              message:
                burnResult.reason && burnResult.reason.length > 0
                  ? burnResult.reason
                  : 'Burn transaction failed before broadcasting. Please try again or contact support.'
            });
          }

          if (burnResult.status !== 'success') {
            setIsProcessing(false);
            return;
          }
        }

        setIsProcessing(false);
        // Keep modal open and refresh — allows immediate claiming UI
        await fetchConversionStatus();
        return;
      } catch (error) {
        console.error('[FryConversion] Burn/convert flow failed', error);

        toast.error({
          heading: 'Conversion Error',
          message:
            'Failed to set the convert. Please contact us before you try again'
        });
        setIsProcessing(false);
        return;
      }
    }
  };

  // Allow users who already burned to reconcile their state without burning again
  const handleReconcile = async () => {
    if (!session || !session.user) return;
    try {
      setIsProcessing(true);
      const response = await fetch('/api/conversion/reconcile_burn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: session.user.address, txId: reconcileTxId || undefined })
      });

      const result = await response.json();
      if (!response.ok || !result.success) {
        toast.error({ heading: 'Reconcile Error', message: result.message || 'Failed to reconcile previous burn.' });
        setIsProcessing(false);
        return;
      }

      toast.success({ heading: 'Reconciled', message: result.message || 'Previous burn verified. You can now claim.' });
      if (result.user) {
        setAccount(result.user);
        setIsConverted(result.user.status === 'pending');
      } else {
        await fetchConversionStatus();
      }
      setShowReconcile(false);
      setReconcileTxId('');
    } catch (e) {
      toast.error({ heading: 'Reconcile Error', message: 'Unexpected error while reconciling. Please try again.' });
    } finally {
      setIsProcessing(false);
    }
  };

  // Add logic to check if conversion is still allowed
  const isConversionOpen = () => {
    const now = new Date();
    const start = account?.ratio ? (account.ratio[2] === 1 ? CORE_RELEASE_DATE : MODS_RELEASE_DATE) : ALL_RELEASE_DATE;
    const diff = now.getTime() - start.getTime();
    const monthsSinceRelease = diff / (1000 * 60 * 60 * 24 * 30);
    return monthsSinceRelease > 0 && monthsSinceRelease <= 13;
  };

  return (
    <div>
      <Dialog
        open={modals[modalName]}
        onClose={onClose}
        static={true}
        className="z-[320]" // Lift above navbar + seasonal chrome on mobile
      >
        <DialogPanel
          className={`max-w-xs sm:max-w-3xl ${
            isDark
              ? 'bg-[#0b0b0f] text-white border border-gray-800 shadow-[0_18px_45px_rgba(0,0,0,0.6)]'
              : 'bg-white text-slate-900 border border-slate-200 shadow-[0_18px_45px_rgba(15,23,42,0.12)]'
          }`}
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
          <Title className={`mb-5 ${isDark ? 'text-white' : 'text-slate-900'}`}>{isConverted ? 'Conversion' : 'Conversion Preview'}</Title>
          <Flex flexDirection="row" justifyContent="start" alignItems="end">
            <p className={`${isDark ? 'text-gray-200' : 'text-slate-900'} hidden sm:block`}>
              <strong>{`Conversion Type: `}</strong>
            </p>
            <p className={`${isDark ? 'text-gray-200' : 'text-slate-900'} block sm:hidden mr-4`}>
              <strong>{`Type: `}</strong>
            </p>
            <Select
              value={selectedTokenType}
              onValueChange={(val) => setSelectedTokenType(val)}
              className="ml-1 mb-1 max-w-4 conversion-select"
            >
              <SelectItem value="2485314946">{fryTokenName}</SelectItem>
              <SelectItem value="2485202024">fNODE</SelectItem>
            </Select>
            {isDark && (
              <style jsx global>{`
                /* Dark mode select overrides for conversion modal (Headless UI listbox + trigger). */
                /* Keep the trigger scoped to the conversion select so other selects stay untouched. */
                html.dark .conversion-select button[aria-haspopup='listbox'] {
                  background-color: #0b0f1a !important;
                  color: #ffffff !important;
                  border: 1px solid #4b5563 !important;
                }
                html.dark .conversion-select button[aria-haspopup='listbox']:focus-visible {
                  outline: none !important;
                  box-shadow: 0 0 0 2px rgba(239, 68, 68, 0.6) !important;
                  border-color: #ef4444 !important;
                }
                html.dark .conversion-select button[aria-haspopup='listbox'] svg {
                  color: #d1d5db !important;
                }
                /* Listbox panel can render outside the select container; target both scoped and global dark modes. */
                html.dark .conversion-select [role='listbox'],
                html.dark [data-headlessui-state][role='listbox'] {
                  background-color: #0b0f1a !important;
                  color: #ffffff !important;
                  border: 1px solid #4b5563 !important;
                }
                html.dark .conversion-select [role='option'],
                html.dark [data-headlessui-state][role='option'] {
                  color: #ffffff !important;
                }
                html.dark .conversion-select [role='option'][data-headlessui-state~='active'],
                html.dark [data-headlessui-state][role='option'][data-headlessui-state~='active'] {
                  background-color: rgba(239, 68, 68, 0.25) !important;
                }
                html.dark .conversion-select [role='option'][data-headlessui-state~='selected'],
                html.dark [data-headlessui-state][role='option'][data-headlessui-state~='selected'] {
                  background-color: rgba(239, 68, 68, 0.35) !important;
                }
              `}</style>
            )}
          </Flex>
          {optInGuide && (
            <div
              className={`mt-3 rounded-lg border p-3 text-sm ${
                isDark
                  ? 'border-warning-300/50 bg-warning-500/10 text-warning-50'
                  : 'border-warning-200 bg-warning-50 text-warning-800'
              }`}
            >
              {/* Surface a self-serve opt-in helper when conversion claims fail due to missing ASA opt-in. */}
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="flex-1 space-y-2">
                  <div className={isDark ? 'font-semibold text-warning-50' : 'font-semibold text-warning-900'}>
                    Opt in to {optInGuide.label} (ASA #{optInGuide.assetId}) to claim
                  </div>
                  <p className={isDark ? 'text-warning-50/90' : 'text-warning-800'}>
                    Desktop: open Pera/Defly, search the ASA ID below, and opt in. Mobile: tap the scan
                    icon in your wallet and scan the QR to opt in instantly.
                  </p>
                  <div
                    className={`flex flex-wrap items-center gap-2 font-mono text-xs ${
                      isDark ? 'text-warning-100' : 'text-warning-900'
                    }`}
                  >
                    ASA #{optInGuide.assetId}
                    <CopyAddress address={optInGuide.assetId} />
                  </div>
                </div>
                <div className="flex justify-center">
                  <div className="rounded-2xl bg-white p-2 shadow">
                    <Image
                      src={optInGuide.src}
                      alt={`Opt-in QR for ${optInGuide.label}`}
                      width={180}
                      height={180}
                      className="h-40 w-40 object-contain"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}
          <p className={`${isDark ? 'text-gray-200' : 'text-slate-900'} hidden sm:block`}>
            <strong>{'Wallet address: '}</strong>
            {`${account?.address.slice(0, 12)} ... ${account?.address.slice(-12)}`}
          </p>
          <p className={`${isDark ? 'text-gray-200' : 'text-slate-900'} block sm:hidden`}>
            <strong>{'Address: '}</strong>
            {`${account?.address.slice(0, 6)} ... ${account?.address.slice(-6)}`}
          </p>
          <p className={`${isDark ? 'text-gray-200' : 'text-slate-900'}`}>
            <strong>{`FRY1.0 Amount: `}</strong>
            {account?.amount}
          </p>
          {account && account.status === 'valid' && (
            <p className={`${isDark ? 'text-gray-200' : 'text-slate-900'}`}>
              <strong>{`${selectedTokenType === FRY_2.id ? 'FRY2.0' : 'fNODE'} Amount After Conversion: `}</strong>
              {(selectedTokenType === FRY_2.id
                    ? account.amount /
                      (account?.ratio ? account.ratio[0] : 80)
                    : account.amount /
                      (account?.ratio ? account.ratio[1] : 40)
                  ).toFixed(5)}
            </p>
          )}

          {account && account.status === 'pending' && (
            <>
              <Flex
                flexDirection="col"
                alignItems="start"
                className="mt-3 w-full sm:auto"
              >
                <p className={`${isDark ? 'text-gray-200' : 'text-slate-900'}`}>
                  <strong>Remaining Converted Amount: </strong>
                  {(selectedTokenType === FRY_2.id
                    ? (account.pendingAmount /
                      (account?.ratio ? account.ratio[0] : 80)).toFixed(5) + ' FRY2.0'
                    : (account.pendingAmount /
                      (account?.ratio ? account.ratio[1] : 40)).toFixed(5) + ' fNODE'
                  )} 
                </p>
                <p className={`${isDark ? 'text-gray-200' : 'text-slate-900'}`}>
                  <strong>Claimable Amount: </strong>
                  {/* {account.claimableAmount.toFixed(5)} */}
                  {(selectedTokenType === FRY_2.id
                    ? ((account.amount /
                        (account?.ratio ? account.ratio[0] * 12 : 960)) *
                      account.claimableMonths).toFixed(5) + ' FRY2.0'
                    : ((account.amount /
                        (account?.ratio ? account.ratio[1] * 12 : 480)) *
                      account.claimableMonths).toFixed(5) + ' fNODE'
                  )}
                </p>
              </Flex>
              <ProgressMonthBar specificDate={account?.ratio ? (account.ratio[2] === 1 ? CORE_RELEASE_DATE : MODS_RELEASE_DATE) : ALL_RELEASE_DATE} pA={account.pendingAmount}/>
            </>
          )}

          {/* Claim History Table */}
          {account?.history && account.history.length > 0 && (
            <div className="mt-6">
              <h3 className="text-lg font-semibold mb-2">Claim History</h3>
              <table className="min-w-full text-sm border border-slate-300 rounded">
                <thead>
                  <tr>
                    <th className="px-2 py-1 border-b text-center">Amount</th>
                    <th className="px-2 py-1 border-b text-center">
                      Token Type
                    </th>
                    <th className="px-2 py-1 border-b text-center">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {account.history.map((item, idx) => (
                    <tr key={idx}>
                      <td className="px-2 py-1 text-center">
                        {item.amount.toFixed(5)}
                      </td>
                      <td className="px-2 py-1 text-center">
                        {item.tokenType}
                      </td>
                      <td className="px-2 py-1 text-center">
                        {new Date(item.date).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <Flex
            flexDirection="row"
            justifyContent="center"
            className="gap-3 w-full mt-5"
          >
            {!isConverted && (account && (account as any).supportReconcile === true) && (
              <Button
                className={`bg-transparent ${isDark ? 'text-white border-gray-500 hover:bg-gray-800 hover:border-gray-500' : 'text-slate-900 border-slate-400 hover:bg-slate-100 hover:border-slate-500'} ${isProcessing ? 'cursor-not-allowed' : 'cursor-default'}`}
                disabled={isProcessing}
            onClick={() => setShowReconcile(true)}
          >
            Already burned? Reconcile
          </Button>
        )}
            <Button
              className={`bg-transparent ${isDark ? 'text-white border-red-600 hover:bg-red-600 hover:border-red-600' : 'text-slate-900 border-red-600 hover:bg-red-50 hover:border-red-600'}`}
              onClick={() => !isProcessing && onClose()}
            >
              Close
            </Button>
            {isConversionOpen() && (
              <Button
                className={`relative flex items-center justify-center bg-transparent ${isDark ? 'text-white border-red-600 hover:bg-red-600 hover:border-red-600' : 'text-slate-900 border-red-600 hover:bg-red-50 hover:border-red-600'} ${isProcessing ? 'cursor-not-allowed' : 'cursor-default'}`}
                disabled={
                  isConverted === false
                    ? account && account?.amount > 0
                      ? false
                      : true
                    : account && account?.claimableAmount > 0
                      ? false
                      : true
                }
                onClick={() => handleConvert()}
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
                  `${isConverted ? 'Claim' : 'Convert'}`
                )}
              </Button>
            )}
          </Flex>
        </DialogPanel>
      </Dialog>

      {showReconcile && (
        <Dialog open={true} onClose={() => !isProcessing && setShowReconcile(false)} static={true} className="z-[330]"> {/* Keep reconcile sheet above main conversion overlay */}
          <DialogPanel className="max-w-xs sm:max-w-lg border border-red-600">
            <div className="absolute right-0 top-0 pr-3 pt-3">
              <button
                type="button"
                className="rounded-tremor-small p-2 text-tremor-content-subtle hover:bg-tremor-background-subtle hover:text-tremor-content dark:text-dark-tremor-content-subtle hover:dark:bg-dark-tremor-background-subtle hover:dark:text-tremor-content"
                onClick={() => !isProcessing && setShowReconcile(false)}
                aria-label="Close"
              >
                <RiCloseLine className="h-5 w-5 shrink-0" aria-hidden={true} />
              </button>
            </div>
            <Title className={`mb-2 ${isDark ? 'text-red-400' : 'text-red-600'}`}>Reconcile Previous Burn</Title>
            <p className={`${isDark ? 'text-gray-200' : 'text-slate-900'} mb-4`}>
              Support has enabled reconciliation for your account. If you know the FRY 1.0 burn transaction ID, paste it below. Otherwise, leave it blank and we will auto-detect a matching burn.
            </p>
            <div className="space-y-2">
              <label className={`${isDark ? 'text-gray-200' : 'text-slate-800'} text-sm`}>Burn Transaction ID (optional)</label>
              <input
                type="text"
                value={reconcileTxId}
                onChange={(e) => setReconcileTxId(e.target.value)}
                placeholder="e.g. ABCD1234..."
                className={`w-full rounded-md border border-red-600/60 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-600 ${isDark ? 'bg-gray-900 text-white placeholder:text-gray-500' : 'bg-white text-slate-900 placeholder:text-slate-500'}`}
              />
              <div className="h-0.5 w-full bg-gradient-to-r from-transparent via-red-500 to-transparent" />
            </div>
            <Flex flexDirection="row" justifyContent="end" className="gap-3 mt-5">
              <Button
                className={`bg-transparent ${isDark ? 'text-white border-gray-500 hover:bg-gray-800 hover:border-gray-500' : 'text-slate-900 border-slate-400 hover:bg-slate-100 hover:border-slate-500'}`}
                onClick={() => !isProcessing && setShowReconcile(false)}
              >
                Cancel
              </Button>
              <Button
                className={`bg-transparent ${isDark ? 'text-white border-red-600 hover:bg-red-600 hover:border-red-600' : 'text-slate-900 border-red-600 hover:bg-red-50 hover:border-red-600'} ${isProcessing ? 'cursor-not-allowed' : 'cursor-default'}`}
                onClick={handleReconcile}
                disabled={isProcessing}
              >
                {isProcessing ? 'Reconciling…' : 'Verify & Update'}
              </Button>
            </Flex>
          </DialogPanel>
        </Dialog>
      )}
    </div>
  );
}
