import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Button,
  Dialog,
  DialogPanel,
  Flex,
  Title
} from '@tremor/react';
import { useModal } from '../../app/modalcontext';
import { RiCloseLine } from '@remixicon/react';
import { useSession } from 'next-auth/react';
import { useToastContext } from '../../hooks/ToastContext';
import { useTheme } from 'next-themes';
import {
  BURN_WALLET,
  FRY_1,
  tFRY
} from '../../lib/utils';
import { useWalletActions } from '../../lib/wallet/useWalletActions';
import { buildAssetTransferTxn } from '../../lib/wallet/transactions';
import { WalletRequestInFlightError } from '../../lib/wallet/requestCoordinator.client';
import { useSmartRetry } from '../../lib/hooks/useSmartRetry';

const testMode = process.env.NEXT_PUBLIC_TEST_MODE === 'true';

// Post-snapshot state type
interface PostSnapshotState {
  eligible_fry1: number;
  eligible_tFRY: number;
  burned: boolean;
  claimed: boolean;
  claim_txId: string | null;
  claimed_at: Date | null;
}

export default function PostSnapshotConversionModal({
  modalName,
  address,
  onClose
}: {
  modalName: string;
  address: string | undefined;
  onClose: () => void;
}) {
  const { activeAddress, signAndSubmit } = useWalletActions();
  const { modals, closeModal } = useModal();
  const [postSnapshot, setPostSnapshot] = useState<PostSnapshotState | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

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
        toast.info({
          heading: 'Wallet Request In Progress',
          message: 'Finish the current wallet prompt, then retry the conversion.'
        });
        return { status: 'error', reason: 'Wallet request already in progress' };
      }
      const { friendlyMessage, duplicateTxId } = extractBurnErrorDetails(error);

      if (duplicateTxId) {
        toast.info({
          heading: 'Burn Already Submitted',
          message: 'We found an earlier burn for this wallet and will reuse it.'
        });
        console.warn('Burn Transfer Already Committed: ', duplicateTxId);
        return { status: 'success', txId: duplicateTxId };
      }

      const normalizedMessage = friendlyMessage ?? 'Unknown error';
      console.error('Burn Transfer Error: ', normalizedMessage);

      if (/reject|denied|cancel/i.test(normalizedMessage)) {
        return { status: 'cancelled' };
      }

      return { status: 'error', reason: normalizedMessage };
    }
  };

  const modalOpen = Boolean(modals[modalName]);

  const fetchPostSnapshotStatus = useCallback(async () => {
    if (!modalOpen) {
      return;
    }

    if (!session || !session.user) {
      console.log('Session invalid');
      return;
    }

    try {
      const response = await fetch('/api/conversion/get_post_snapshot', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          address: session.user.address
        })
      });

      if (!response.ok) {
        toast.error({
          heading: 'Error',
          message: 'Network error fetching post-snapshot status'
        });
        return;
      }

      const result = await response.json();
      if (result.post_snapshot) {
        setPostSnapshot(result.post_snapshot);
      }
    } catch (error) {
      console.error('Failed to fetch post-snapshot status', error);
    }
  }, [modalOpen, session, toast]);

  const prevModalOpen = useRef<boolean>(false);

  useEffect(() => {
    const justOpened = modalOpen && !prevModalOpen.current;
    const needsFirstLoad = modalOpen && !postSnapshot;

    if (justOpened || needsFirstLoad) {
      void fetchPostSnapshotStatus();
    }

    prevModalOpen.current = modalOpen;
  }, [modalOpen, fetchPostSnapshotStatus, postSnapshot]);

  // Handle post-snapshot burn
  const handleBurn = async () => {
    if (!session || !session.user || !postSnapshot) return;
    
    setIsProcessing(true);
    
    try {
      const burnResult = await transferToBurn(address, postSnapshot.eligible_fry1);
      
      if (burnResult.status === 'success') {
        const response = await fetch('/api/conversion/set_post_snapshot', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            address: session.user.address,
            txId: burnResult.txId
          })
        });

        if (!response.ok) {
          const failure = await response.json();
          toast.error({
            heading: 'Post-Snapshot Burn Error',
            message: failure.message || 'Failed to verify post-snapshot burn.'
          });
          setIsProcessing(false);
          return;
        }

        const result = await response.json();
        if (result.success) {
          toast.success({
            heading: 'Post-Snapshot Burn Complete',
            message: result.message
          });
          if (result.post_snapshot) {
            setPostSnapshot(result.post_snapshot);
          }
        } else {
          toast.error({
            heading: 'Post-Snapshot Burn Error',
            message: result.message
          });
        }
      } else if (burnResult.status === 'cancelled') {
        toast.info({
          heading: 'Burn Cancelled',
          message: 'Post-snapshot burn was cancelled. No changes were made.'
        });
      } else {
        toast.error({
          heading: 'Burn Error',
          message: burnResult.reason || 'Post-snapshot burn failed. Please try again.'
        });
      }
    } catch (error) {
      console.error('[PostSnapshotConversion] Burn failed', error);
      toast.error({
        heading: 'Burn Error',
        message: 'Failed to process post-snapshot burn. Please try again.'
      });
    } finally {
      setIsProcessing(false);
    }
  };

  // Handle post-snapshot tFRY claim
  const handleClaim = async () => {
    if (!session || !session.user || !postSnapshot) return;
    
    setIsProcessing(true);
    
    try {
      const response = await fetch('/api/conversion/transfer_post_snapshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address: session.user.address
        })
      });

      const result = await response.json();
      
      if (!response.ok) {
        const optInHint =
          result?.code === 'WALLET_ASSET_NOT_OPTED_IN' ||
          /opt\s*in/i.test(result?.action || '') ||
          /opt\s*in/i.test(result?.message || '');
        
        if (optInHint) {
          toast.error({
            heading: 'Opt-In Required',
            message: `Please opt into tFRY (ASA ${tFRY.id}) in your wallet, then retry.`
          });
        } else {
          toast.error({
            heading: 'Claim Error',
            message: result.message || 'Failed to claim post-snapshot tFRY.'
          });
        }
        setIsProcessing(false);
        return;
      }

      if (result.success) {
        toast.success({
          heading: 'tFRY Claimed!',
          message: result.message
        });
        if (result.post_snapshot) {
          setPostSnapshot(result.post_snapshot);
        }
      } else {
        toast.error({
          heading: 'Claim Error',
          message: result.message
        });
      }
    } catch (error) {
      console.error('[PostSnapshotConversion] Claim failed', error);
      toast.error({
        heading: 'Claim Error',
        message: 'Failed to claim post-snapshot tFRY. Please try again.'
      });
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div>
      <Dialog
        open={modals[modalName]}
        onClose={onClose}
        static={true}
        className="z-[320]"
      >
        <DialogPanel
          className={`max-w-xs sm:max-w-xl ${
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
          <Title className={`mb-4 ${isDark ? 'text-warning-400' : 'text-warning-600'}`}>
            August 2025 FRY 1.0 Conversion
          </Title>
          
          <p className={`text-sm mb-4 ${isDark ? 'text-gray-300' : 'text-slate-600'}`}>
            Convert FRY 1.0 acquired after the December 2024 snapshot into tFRY at a 40:1 ratio with no vesting period.
          </p>

          <p className={`mb-2 ${isDark ? 'text-gray-200' : 'text-slate-900'}`}>
            <strong>Wallet: </strong>
            <span className="font-mono text-sm">
              {address ? `${address.slice(0, 8)}...${address.slice(-8)}` : 'Not connected'}
            </span>
          </p>

          {!postSnapshot && (
            <div className={`rounded-lg border p-4 mt-4 ${
              isDark 
                ? 'border-gray-700 bg-gray-800/50' 
                : 'border-slate-200 bg-slate-50'
            }`}>
              <p className={`text-sm ${isDark ? 'text-gray-300' : 'text-slate-600'}`}>
                Loading your post-snapshot eligibility...
              </p>
            </div>
          )}

          {postSnapshot && postSnapshot.eligible_fry1 === 0 && (
            <div className={`rounded-lg border p-4 mt-4 ${
              isDark 
                ? 'border-gray-700 bg-gray-800/50' 
                : 'border-slate-200 bg-slate-50'
            }`}>
              <p className={`text-sm ${isDark ? 'text-gray-300' : 'text-slate-600'}`}>
                This wallet has no post-snapshot FRY 1.0 eligible for conversion. 
                Only FRY 1.0 acquired after December 1, 2024 qualifies for this conversion.
              </p>
            </div>
          )}

          {postSnapshot && postSnapshot.eligible_fry1 > 0 && (
            <div className={`rounded-lg border p-4 mt-4 ${
              isDark 
                ? 'border-warning-500/30 bg-warning-500/5' 
                : 'border-warning-200 bg-warning-50'
            }`}>
              <p className={`mb-2 ${isDark ? 'text-gray-200' : 'text-slate-900'}`}>
                <strong>Eligible FRY 1.0: </strong>
                {postSnapshot.eligible_fry1.toLocaleString()}
              </p>
              <p className={`mb-3 ${isDark ? 'text-gray-200' : 'text-slate-900'}`}>
                <strong>tFRY to Receive: </strong>
                {postSnapshot.eligible_tFRY.toFixed(5)}
                <span className={`ml-2 text-sm ${isDark ? 'text-gray-400' : 'text-slate-500'}`}>
                  (40:1 ratio, no vesting)
                </span>
              </p>

              {/* State 1: Not burned yet */}
              {!postSnapshot.burned && !postSnapshot.claimed && (
                <div className="mt-3">
                  <p className={`text-sm mb-3 ${isDark ? 'text-gray-300' : 'text-slate-600'}`}>
                    Burn your post-snapshot FRY 1.0 to unlock instant tFRY claim.
                  </p>
                  <Button
                    className={`bg-transparent ${
                      isDark
                        ? 'text-white border-red-600 hover:bg-red-600 hover:border-red-600'
                        : 'text-slate-900 border-red-600 hover:bg-red-50 hover:border-red-600'
                    } ${isProcessing ? 'cursor-not-allowed opacity-50' : ''}`}
                    onClick={handleBurn}
                    disabled={isProcessing}
                  >
                    {isProcessing ? (
                      <span className="flex items-center gap-2">
                        <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" strokeLinecap="round" />
                        </svg>
                        Processing...
                      </span>
                    ) : (
                      `Burn ${postSnapshot.eligible_fry1.toLocaleString()} FRY 1.0`
                    )}
                  </Button>
                </div>
              )}

              {/* State 2: Burned, not claimed */}
              {postSnapshot.burned && !postSnapshot.claimed && (
                <div className="mt-3">
                  <p className={`text-sm mb-3 ${isDark ? 'text-green-400' : 'text-green-600'}`}>
                    Burn verified! Claim your tFRY now.
                  </p>
                  <Button
                    className={`bg-transparent ${
                      isDark
                        ? 'text-white border-red-600 hover:bg-red-600 hover:border-red-600'
                        : 'text-slate-900 border-red-600 hover:bg-red-50 hover:border-red-600'
                    } ${isProcessing ? 'cursor-not-allowed opacity-50' : ''}`}
                    onClick={handleClaim}
                    disabled={isProcessing}
                  >
                    {isProcessing ? (
                      <span className="flex items-center gap-2">
                        <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" strokeLinecap="round" />
                        </svg>
                        Claiming...
                      </span>
                    ) : (
                      `Claim ${postSnapshot.eligible_tFRY.toFixed(5)} tFRY`
                    )}
                  </Button>
                </div>
              )}

              {/* State 3: Claimed */}
              {postSnapshot.claimed && postSnapshot.claim_txId && (
                <div className="mt-3">
                  <p className={`text-sm mb-2 ${isDark ? 'text-green-400' : 'text-green-600'}`}>
                    tFRY claimed successfully!
                  </p>
                  <p className={`text-sm ${isDark ? 'text-gray-300' : 'text-slate-600'}`}>
                    <strong>Transaction: </strong>
                    <a 
                      href={`https://allo.info/tx/${postSnapshot.claim_txId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`underline ${isDark ? 'text-blue-400 hover:text-blue-300' : 'text-blue-600 hover:text-blue-500'}`}
                    >
                      {postSnapshot.claim_txId.slice(0, 8)}...{postSnapshot.claim_txId.slice(-8)}
                    </a>
                  </p>
                  {postSnapshot.claimed_at && (
                    <p className={`text-xs mt-1 ${isDark ? 'text-gray-400' : 'text-slate-500'}`}>
                      Claimed: {new Date(postSnapshot.claimed_at).toLocaleString()}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          <Flex
            flexDirection="row"
            justifyContent="center"
            className="gap-3 w-full mt-5"
          >
            <Button
              className={`bg-transparent ${isDark ? 'text-white border-red-600 hover:bg-red-600 hover:border-red-600' : 'text-slate-900 border-red-600 hover:bg-red-50 hover:border-red-600'}`}
              onClick={() => !isProcessing && onClose()}
            >
              Close
            </Button>
          </Flex>
        </DialogPanel>
      </Dialog>
    </div>
  );
}
