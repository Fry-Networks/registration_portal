import PageShell from "../../components/PageShell";
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import algosdk from 'algosdk';
import { useRouter } from 'next/router';
import { useWallet } from '@txnlab/use-wallet-react';
import { useTheme } from 'next-themes';
import { Button, Flex, Title } from '@tremor/react';
import { SwitchHorizontalIcon, InformationCircleIcon, RefreshIcon, ExclamationIcon, ShieldCheckIcon } from '@heroicons/react/outline';
import { useToastContext } from '../../hooks/ToastContext';
import { ASA_IDS, SOURCE_TOKENS, TARGET_TOKENS, QUOTE_TTL_MS, MAX_PRICE_IMPACT, DEFAULT_SLIPPAGE_BPS } from '../../lib/swap/constants';
import { getTokenBySymbol } from '../../lib/swap/allowlist';
import type { AggregatorQuote } from '../../lib/swap/aggregator';
import { useWalletActions } from '../../lib/wallet/useWalletActions';
import { waitForFinalConfirmation } from '../../lib/wallet/transactionConfirmation';
import { getDefaultNetwork } from '../../lib/wallet/config';
import { prepareSwapTransactions, executeSwap, checkAssetOptIn, buildAssetOptInTransaction } from '../../lib/swap/execute';
import { getAssetBalance, reportSwapOutcome } from '../../lib/swap/reportOutcome';
import Link from 'next/link';
interface GuaranteeInfo {
  eligible: boolean;
  guaranteedAmount: number;
  estimatedAmount: number;
  guaranteedAssetId: number;
  quoteExpiresAt: number;
  swapSubmissionDeadline: number;
  settlementDeadline: number;
  routeLiquidityUsd: number;
  reason: string | null;
}
function formatAmount(baseUnits: number, decimals = 6): string {
  const val = baseUnits / Math.pow(10, decimals);
  return val.toLocaleString(undefined, {
    maximumFractionDigits: decimals
  });
}
function formatPriceImpact(pi: number): string {
  return `${(pi * 100).toFixed(4)}%`;
}
export default function BuyTokenPage() {
  const router = useRouter();
  const {
    activeAccount
  } = useWallet();
  const walletActions = useWalletActions();
  const {
    resolvedTheme
  } = useTheme();
  const isDark = resolvedTheme !== 'light';
  const {
    error: toastError,
    info: toastInfo
  } = useToastContext();
  const {
    token
  } = router.query;
  const targetSymbol = typeof token === 'string' ? token.toUpperCase() : '';
  const targetToken = useMemo(() => getTokenBySymbol(targetSymbol), [targetSymbol]);
  const [sourceId, setSourceId] = useState<number>(ASA_IDS.ALGO);
  const [amountStr, setAmountStr] = useState('1');
  const [quote, setQuote] = useState<AggregatorQuote | null>(null);
  const [guarantee, setGuarantee] = useState<GuaranteeInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [lastQuoteAt, setLastQuoteAt] = useState<number | null>(null);
  const [isStale, setIsStale] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [executionStep, setExecutionStep] = useState<'quoting' | 'preparing' | 'signing' | 'confirming' | 'settling' | null>(null);
  const [claimable, setClaimable] = useState<Array<{
    quoteId: string;
    orderHash: string;
    amount: number;
    assetId: number;
    vaultAppId: number;
  }>>([]);
  const [isClaiming, setIsClaiming] = useState(false);
  const sourceToken = useMemo(() => SOURCE_TOKENS.find(t => t.id === sourceId) || SOURCE_TOKENS[0], [sourceId]);
  const amountBase = useMemo(() => {
    const val = parseFloat(amountStr);
    if (!Number.isFinite(val) || val <= 0) return 0;
    return Math.floor(val * Math.pow(10, sourceToken.decimals));
  }, [amountStr, sourceToken]);
  const fetchQuote = useCallback(async (): Promise<AggregatorQuote | null> => {
    if (!targetToken || amountBase <= 0) return null;
    setLoading(true);
    setQuoteError(null);
    try {
      const walletParam = activeAccount ? `&wallet=${activeAccount.address}` : '';
      const res = await fetch(`/api/swap/quote?fromASA=${sourceId}&toASA=${targetToken.id}&amount=${amountBase}${walletParam}`);
      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error || 'Quote failed');
      }
      setQuote(data.quote);
      setGuarantee(data.guarantee || null);
      setLastQuoteAt(Date.now());
      setIsStale(false);
      return data.quote as AggregatorQuote;
    } catch (err: any) {
      setQuoteError(err.message || 'Quote failed');
      toastError({
        heading: 'Quote Error',
        message: err.message || 'Unable to fetch quote'
      });
      return null;
    } finally {
      setLoading(false);
    }
  }, [targetToken, sourceId, amountBase, activeAccount, toastError]);
  useEffect(() => {
    const t = setTimeout(() => {
      fetchQuote();
    }, 600);
    return () => clearTimeout(t);
  }, [fetchQuote]);
  useEffect(() => {
    if (!lastQuoteAt) return;
    const t = setInterval(() => {
      if (Date.now() - lastQuoteAt > QUOTE_TTL_MS) {
        setIsStale(true);
      }
    }, 5_000);
    return () => clearInterval(t);
  }, [lastQuoteAt]);

  // Poll for claimable certificates
  useEffect(() => {
    if (!activeAccount) {
      setClaimable([]);
      return;
    }
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(`/api/swap/claim-status?wallet=${activeAccount.address}`);
        const data = await res.json();
        if (!cancelled && data.success) setClaimable(data.claimable || []);
      } catch {/* silent */}
    };
    poll();
    const id = setInterval(poll, 15_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [activeAccount]);
  const handleClaim = useCallback(async (item: typeof claimable[0]) => {
    if (!activeAccount || !targetToken || isClaiming) return;
    setIsClaiming(true);
    try {
      const orderHashBytes = new Uint8Array(item.orderHash.match(/.{2}/g)!.map(b => parseInt(b, 16)));

      // ABI: claim(byte[])void selector 0x4d6e08da
      const selector = new Uint8Array([0x4d, 0x6e, 0x08, 0xda]);
      // Encode dynamic bytes: 2-byte length prefix + data
      const lenBuf = new Uint8Array(2);
      lenBuf[0] = orderHashBytes.length >> 8 & 0xff;
      lenBuf[1] = orderHashBytes.length & 0xff;
      const orderHashArg = new Uint8Array(2 + orderHashBytes.length);
      orderHashArg.set(lenBuf, 0);
      orderHashArg.set(orderHashBytes, 2);
      const boxPrefix = new Uint8Array([0x63, 0x65, 0x72, 0x74, 0x5f]); // "cert_"
      const boxName = new Uint8Array(boxPrefix.length + orderHashBytes.length);
      boxName.set(boxPrefix, 0);
      boxName.set(orderHashBytes, boxPrefix.length);
      const algod = new algosdk.Algodv2('', 'https://mainnet-api.algonode.cloud', 443);
      const sp = await algod.getTransactionParams().do();
      sp.flatFee = true;
      sp.fee = BigInt(2000); // covers inner AssetTransfer

      const txn = algosdk.makeApplicationCallTxnFromObject({
        sender: activeAccount.address,
        appIndex: item.vaultAppId,
        onComplete: algosdk.OnApplicationComplete.NoOpOC,
        appArgs: [selector, orderHashArg],
        foreignAssets: [item.assetId],
        boxes: [{
          appIndex: item.vaultAppId,
          name: boxName
        }],
        suggestedParams: sp
      });
      const encoded = algosdk.encodeUnsignedTransaction(txn);
      const txIds = await walletActions.signAndSubmit([encoded], {
        message: 'Claim FrySwap Guarantee'
      });
      await waitForFinalConfirmation(txIds[0], {
        network: getDefaultNetwork(),
        minConfirmations: 4
      });

      // Confirm claim in DB
      await fetch('/api/swap/confirm-claim', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          quoteId: item.quoteId,
          claimTxId: txIds[0]
        })
      });
      toastInfo({
        heading: 'Claimed!',
        message: `${formatAmount(item.amount)} ${targetToken.symbol} sent to your wallet.`
      });
      setClaimable(prev => prev.filter(c => c.quoteId !== item.quoteId));
    } catch (err: any) {
      console.error('[handleClaim]', err);
      toastError({
        heading: 'Claim failed',
        message: err.message || 'Failed to claim guarantee.'
      });
    } finally {
      setIsClaiming(false);
    }
  }, [activeAccount, targetToken, isClaiming, walletActions, toastInfo, toastError]);
  const priceImpact = quote?.price_impact ?? 0;
  const priceImpactHigh = priceImpact > MAX_PRICE_IMPACT;
  const quoteValid = !!quote && !isStale && !quoteError;
  const handleExecuteSwap = useCallback(async () => {
    if (!quoteValid || !activeAccount) {
      toastInfo({
        heading: 'Swap not ready',
        message: 'Wait for a valid quote and connect your wallet.'
      });
      return;
    }
    if (!targetToken) {
      toastError({
        heading: 'Invalid token',
        message: 'Target token is not supported.'
      });
      return;
    }
    setIsExecuting(true);
    setExecutionStep('quoting');
    try {
      let currentQuote = quote;
      if (!currentQuote || isStale || lastQuoteAt && Date.now() - lastQuoteAt > QUOTE_TTL_MS) {
        const fresh = await fetchQuote();
        if (fresh) currentQuote = fresh;
      }
      if (!currentQuote) {
        toastError({
          heading: 'No quote',
          message: 'Unable to get a fresh quote.'
        });
        return;
      }
      const network = getDefaultNetwork();
      setExecutionStep('preparing');
      const optedIn = await checkAssetOptIn(activeAccount.address, targetToken.id);
      if (!optedIn) {
        toastInfo({
          heading: 'Opt-in required',
          message: `Opting into ${targetToken.symbol} before swapping...`
        });
        const encodedOptIn = await buildAssetOptInTransaction(activeAccount.address, targetToken.id);
        const optInTxIds = await walletActions.signAndSubmit([encodedOptIn], {
          message: `Authorize ${targetToken.symbol} opt-in`
        });
        await waitForFinalConfirmation(optInTxIds[0], {
          network,
          minConfirmations: 4
        });
        toastInfo({
          heading: 'Opted in',
          message: `${targetToken.symbol} opt-in confirmed. Proceeding to swap...`
        });
      }
      const slippage = DEFAULT_SLIPPAGE_BPS / 10000;
      const {
        transactions: preparedTxns,
        quoteId
      } = await prepareSwapTransactions(currentQuote, activeAccount.address, slippage);
      let preBalance = 0;
      if (quoteId) {
        try {
          preBalance = await getAssetBalance(activeAccount.address, targetToken.id);
        } catch {/* non-critical */}
      }
      setExecutionStep('signing');
      const result = await executeSwap(preparedTxns, walletActions, {
        message: 'Authorize swap',
        network
      });
      setExecutionStep('confirming');
      if (result.confirmed) {
        toastInfo({
          heading: 'Swap confirmed',
          content: <span>
              Swap complete.{' '}
              <a href={`https://allo.info/tx/${result.txIds[0]}`} target="_blank" rel="noopener noreferrer" className="underline">
                View on explorer
              </a>
            </span>
        });

        // Report outcome + trigger verification/settlement
        if (quoteId) {
          setExecutionStep('settling');
          (async () => {
            try {
              const postBalance = await getAssetBalance(activeAccount.address, targetToken.id);
              await reportSwapOutcome({
                quoteId,
                userAddress: activeAccount.address,
                outputAsset: targetToken.id,
                swapTxnIds: result.txIds,
                clientReportedPreBalance: preBalance,
                clientReportedPostBalance: postBalance
              });

              // Trigger server-side verification (which auto-triggers settlement if shortfall)
              const verifyRes = await fetch('/api/swap/verify-outcome', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                  quoteId
                })
              });
              const verifyData = await verifyRes.json();
              if (verifyData.settlement?.settled) {
                toastInfo({
                  heading: 'Guarantee settled',
                  content: <span>
                      Treasury top-up of {formatAmount(verifyData.settlement.shortfall)} {targetToken.symbol} sent.{' '}
                      <a href={`https://allo.info/tx/${verifyData.settlement.txId}`} target="_blank" rel="noopener noreferrer" className="underline">
                        View settlement
                      </a>
                    </span>
                });
              }
            } catch {/* telemetry/settlement — never break swap UX */}
          })();
        }
      } else {
        toastError({
          heading: 'Swap not confirmed',
          message: 'Transaction was submitted but not confirmed in time.'
        });
      }
    } catch (err: any) {
      console.error('[handleExecuteSwap]', err);
      let message = err.message || 'Unexpected error during swap.';
      if (err.errorType === 'QUOTE_FAILED') {
        message = 'No liquidity available for this pair right now. Try again in a few minutes.';
      } else if (err.errorType === 'TX_PREP_FAILED') {
        message = 'Swap preparation failed across all venues. Try again shortly.';
      } else if (err.errorType === 'SIGNING_FAILED') {
        message = 'Transaction signing was cancelled or failed. Please try again.';
      } else if (err.errorType === 'SUBMISSION_FAILED') {
        message = 'Transaction submitted but may have failed on-chain. Check your wallet.';
      } else if (err.errorType === 'VALIDATION_FAILED') {
        message = err.message || 'Validation failed.';
      }
      toastError({
        heading: 'Swap failed',
        message
      });
      fetch('/api/swap/log', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          errorType: err.errorType || 'UNKNOWN',
          message: err.message,
          aggregatorErrors: err.aggregatorErrors,
          fromASA: sourceId,
          toASA: targetToken.id,
          amount: amountBase,
          wallet: activeAccount?.address,
          timestamp: new Date().toISOString()
        })
      }).catch(() => {});
    } finally {
      setIsExecuting(false);
      setExecutionStep(null);
    }
  }, [quoteValid, activeAccount, quote, isStale, lastQuoteAt, fetchQuote, targetToken, walletActions, toastInfo, toastError]);
  if (!targetToken) {
    return (
      <PageShell title="Buy Token" breadcrumb={true}>
        <div className="min-h-[50vh] flex items-center justify-center px-4">
          <div className="text-center">
            <h1 className="text-2xl font-display font-bold text-ink">Invalid Token</h1>
            <p className="mt-4 text-sm text-ink-secondary">Supported: fry, fnode, fvpn</p>
          </div>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell title="Buy Token" breadcrumb={true}>
      <div className="max-w-5xl mx-auto px-4 py-space-8">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-space-6">
          {/* Left: Token info */}
          <div className="space-y-space-6">
            <div className="bg-surface-elevated border border-divider rounded-token-xl p-space-6">
              <div className="flex items-center gap-space-4 mb-4">
                <div className="w-14 h-14 rounded-token-lg bg-primary-500/10 border border-primary-500/20 flex items-center justify-center">
                  <span className="text-xl font-display font-bold text-primary-500">{targetToken.symbol[0]}</span>
                </div>
                <div>
                  <h1 className="text-2xl font-display font-bold text-ink">{targetToken.name}</h1>
                  <p className="text-sm text-primary-500 font-mono">{targetToken.symbol}</p>
                </div>
              </div>
              {activeAccount && <p className="text-xs text-ink-muted font-mono">
                  {activeAccount.address.slice(0, 8)}...{activeAccount.address.slice(-8)}
                </p>}
            </div>

            {/* Token selector pills */}
            <div className="flex gap-2">
              {[{ slug: 'fry', label: 'FRY' }, { slug: 'fnode', label: 'fNODE' }, { slug: 'fvpn', label: 'fVPN' }].map(t => (
                <Link key={t.slug} href={`/buy/${t.slug}`}
                  className={`px-4 py-2 rounded-token-md text-sm font-semibold transition border ${targetSymbol === t.label.toUpperCase() ? 'bg-primary-500 border-primary-500 text-ink shadow-token-glow' : 'bg-surface-strong border-divider text-ink-secondary hover:text-ink hover:border-primary-500/50'}`}
                >
                  {t.label}
                </Link>
              ))}
            </div>

            {claimable.length > 0 && (
              <div className="bg-success-500/10 border border-success-500/20 rounded-token-xl p-space-5">
                <div className="flex items-center gap-2 mb-3">
                  <ShieldCheckIcon className="h-5 w-5 text-success-500" />
                  <span className="font-semibold text-sm text-ink">FrySwap Guarantee Available</span>
                </div>
                {claimable.map(item => (
                  <div key={item.quoteId} className="flex items-center justify-between py-2 border-b border-divider last:border-0">
                    <span className="text-sm text-ink-secondary">
                      {formatAmount(item.amount)} {targetToken?.symbol || 'FRY'} ready to claim
                    </span>
                    <button
                      onClick={() => handleClaim(item)}
                      disabled={isClaiming}
                      className={`rounded-token-md px-4 py-1.5 text-sm font-semibold transition ${isClaiming ? 'opacity-50 cursor-not-allowed bg-surface-strong text-ink-muted' : 'bg-success-500 hover:bg-success-600 text-ink'}`}
                    >
                      {isClaiming ? 'Claiming...' : 'Claim'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Right: Swap card */}
          <div className="bg-surface-elevated border border-divider rounded-token-xl p-space-6 shadow-token-lg">
            <h2 className="text-lg font-display font-semibold text-ink mb-space-5">
              Swap
            </h2>

            <div className="space-y-space-4">
              <div>
                <label className="text-xs font-semibold text-ink-secondary uppercase tracking-wider mb-1 block">Pay with</label>
                <select
                  value={sourceId}
                  onChange={e => setSourceId(Number(e.target.value))}
                  className="w-full bg-surface-strong border border-divider rounded-token-md px-4 py-2.5 text-sm text-ink focus:border-primary-500 focus:ring-1 focus:ring-primary-500 transition"
                >
                  {SOURCE_TOKENS.map(t => (
                    <option key={t.id} value={t.id}>{t.name} ({t.symbol})</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-semibold text-ink-secondary uppercase tracking-wider mb-1 block">Amount</label>
                <input
                  type="number"
                  min="0"
                  step="0.000001"
                  value={amountStr}
                  onChange={e => setAmountStr(e.target.value)}
                  placeholder={`Enter ${sourceToken.symbol} amount`}
                  className="w-full bg-surface-strong border border-divider rounded-token-md px-4 py-2.5 text-sm text-ink focus:border-primary-500 focus:ring-1 focus:ring-primary-500 transition"
                />
              </div>

              {/* Quote display */}
              <div className="bg-surface-strong border border-divider rounded-token-lg p-4">
                {loading && !quote && (
                  <div className="flex items-center gap-2 text-sm text-ink-secondary">
                    <RefreshIcon className="h-4 w-4 animate-spin" /> Fetching quote...
                  </div>
                )}

                {quoteError && (
                  <div className="flex items-center gap-2 text-sm text-error-500">
                    <ExclamationIcon className="h-4 w-4" /> {quoteError}
                  </div>
                )}

                {quote && (
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-ink-secondary">Estimated receive</span>
                      <span className="text-lg font-semibold text-ink">
                        {formatAmount(quote.amount_out)} {targetToken.symbol}
                      </span>
                    </div>

                    {guarantee?.eligible && (
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-1 text-xs text-success-500">
                          <ShieldCheckIcon className="h-4 w-4" />
                          Guaranteed
                        </span>
                        <span className="text-lg font-semibold text-success-500">
                          {formatAmount(guarantee.guaranteedAmount)} {targetToken.symbol}
                        </span>
                      </div>
                    )}

                    {guarantee?.eligible && (
                      <div className="bg-success-500/10 border border-success-500/20 rounded-token-md px-3 py-2 text-xs text-success-500">
                        FrySwap Guarantee Active
                      </div>
                    )}

                    {guarantee && !guarantee.eligible && guarantee.reason && (
                      <div className="bg-warning-500/10 border border-warning-500/20 rounded-token-md px-3 py-2 text-xs text-warning-500">
                        {guarantee.reason}
                      </div>
                    )}

                    <div className="flex items-center justify-between">
                      <span className="text-xs text-ink-secondary">Price impact</span>
                      <span className={`text-sm ${priceImpactHigh ? 'text-error-500 font-semibold' : 'text-ink'}`}>
                        {formatPriceImpact(quote.price_impact)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-ink-secondary">Network fee</span>
                      <span className="text-sm text-ink">{quote.network_fee} uALGO</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-ink-secondary">Venue</span>
                      <span className="text-sm text-ink">{quote.aggregator === 'folks' ? 'Folks Router' : 'Vestige (SEF)'}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-ink-secondary">Slippage tolerance</span>
                      <span className="text-sm text-ink">{(DEFAULT_SLIPPAGE_BPS / 100).toFixed(2)}%</span>
                    </div>
                    {isStale && (
                      <div className="flex items-center gap-2 text-xs text-warning-500">
                        <InformationCircleIcon className="h-4 w-4" /> Quote expired — refresh to update
                      </div>
                    )}
                    {priceImpactHigh && (
                      <div className="flex items-center gap-2 text-xs text-error-500">
                        <ExclamationIcon className="h-4 w-4" /> High price impact (&gt;5%). Swap may be unfavorable.
                      </div>
                    )}
                  </div>
                )}
              </div>

              <button
                onClick={handleExecuteSwap}
                disabled={!quoteValid || isExecuting}
                className={`w-full inline-flex items-center justify-center gap-2 rounded-token-md px-6 py-3 text-sm font-semibold transition ${quoteValid && !isExecuting ? 'bg-primary-500 hover:bg-primary-600 text-ink shadow-token-glow' : 'bg-surface-strong text-ink-muted cursor-not-allowed'}`}
              >
                {isExecuting ? (
                  <>
                    <RefreshIcon className="h-4 w-4 animate-spin" />
                    {executionStep === 'quoting' && 'Fetching quote...'}
                    {executionStep === 'preparing' && 'Preparing swap...'}
                    {executionStep === 'signing' && 'Waiting for wallet signature...'}
                    {executionStep === 'confirming' && 'Confirming on-chain...'}
                    {executionStep === 'settling' && 'Checking guarantee...'}
                  </>
                ) : (
                  <>
                    <SwitchHorizontalIcon className="h-4 w-4" />
                    FrySwap {sourceToken.symbol} for {targetToken.symbol}
                  </>
                )}
              </button>

              {!activeAccount && (
                <p className="text-center text-xs text-ink-muted">
                  Connect your wallet via the header to swap.
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </PageShell>
  );
}