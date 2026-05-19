import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import algosdk from 'algosdk';
import { useRouter } from 'next/router';
import { useWallet } from '@txnlab/use-wallet-react';
import { useTheme } from 'next-themes';
import { Button, Flex, Title } from '@tremor/react';
import {
  SwitchHorizontalIcon,
  InformationCircleIcon,
  RefreshIcon,
  ExclamationIcon,
  ShieldCheckIcon,
} from '@heroicons/react/outline';
import { useToastContext } from '../../hooks/ToastContext';
import { ASA_IDS, SOURCE_TOKENS, TARGET_TOKENS, QUOTE_TTL_MS, MAX_PRICE_IMPACT, DEFAULT_SLIPPAGE_BPS } from '../../lib/swap/constants';
import { getTokenBySymbol } from '../../lib/swap/allowlist';
import type { VestigeQuote } from '../../lib/swap/fryfarmAdapter';
import { useWalletActions } from '../../lib/wallet/useWalletActions';
import { waitForFinalConfirmation } from '../../lib/wallet/transactionConfirmation';
import { getDefaultNetwork } from '../../lib/wallet/config';
import { prepareSwapTransactions, executeSwap, checkAssetOptIn, buildAssetOptInTransaction } from '../../lib/swap/execute';
import { getAssetBalance, reportSwapOutcome } from '../../lib/swap/reportOutcome';

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
  return val.toLocaleString(undefined, { maximumFractionDigits: decimals });
}

function formatPriceImpact(pi: number): string {
  return `${(pi * 100).toFixed(4)}%`;
}

export default function BuyTokenPage() {
  const router = useRouter();
  const { activeAccount } = useWallet();
  const walletActions = useWalletActions();
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme !== 'light';
  const { error: toastError, info: toastInfo } = useToastContext();

  const { token } = router.query;
  const targetSymbol = typeof token === 'string' ? token.toUpperCase() : '';
  const targetToken = useMemo(() => getTokenBySymbol(targetSymbol), [targetSymbol]);

  const [sourceId, setSourceId] = useState<number>(ASA_IDS.ALGO);
  const [amountStr, setAmountStr] = useState('1');
  const [quote, setQuote] = useState<VestigeQuote | null>(null);
  const [guarantee, setGuarantee] = useState<GuaranteeInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [lastQuoteAt, setLastQuoteAt] = useState<number | null>(null);
  const [isStale, setIsStale] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [executionStep, setExecutionStep] = useState<'quoting' | 'preparing' | 'signing' | 'confirming' | 'settling' | null>(null);
  const [claimable, setClaimable] = useState<Array<{ quoteId: string; orderHash: string; amount: number; assetId: number; vaultAppId: number }>>([]);
  const [isClaiming, setIsClaiming] = useState(false);

  const sourceToken = useMemo(
    () => SOURCE_TOKENS.find((t) => t.id === sourceId) || SOURCE_TOKENS[0],
    [sourceId]
  );

  const amountBase = useMemo(() => {
    const val = parseFloat(amountStr);
    if (!Number.isFinite(val) || val <= 0) return 0;
    return Math.floor(val * Math.pow(10, sourceToken.decimals));
  }, [amountStr, sourceToken]);

  const fetchQuote = useCallback(async (): Promise<VestigeQuote | null> => {
    if (!targetToken || amountBase <= 0) return null;
    setLoading(true);
    setQuoteError(null);
    try {
      const walletParam = activeAccount ? `&wallet=${activeAccount.address}` : '';
      const res = await fetch(
        `/api/swap/quote?fromASA=${sourceId}&toASA=${targetToken.id}&amount=${amountBase}${walletParam}`
      );
      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error || 'Quote failed');
      }
      setQuote(data.quote);
      setGuarantee(data.guarantee || null);
      setLastQuoteAt(Date.now());
      setIsStale(false);
      return data.quote as VestigeQuote;
    } catch (err: any) {
      setQuoteError(err.message || 'Quote failed');
      toastError({ heading: 'Quote Error', message: err.message || 'Unable to fetch quote' });
      return null;
    } finally {
      setLoading(false);
    }
  }, [targetToken, sourceId, amountBase, activeAccount, toastError]);

  useEffect(() => {
    const t = setTimeout(() => { fetchQuote(); }, 600);
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
    if (!activeAccount) { setClaimable([]); return; }
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(`/api/swap/claim-status?wallet=${activeAccount.address}`);
        const data = await res.json();
        if (!cancelled && data.success) setClaimable(data.claimable || []);
      } catch { /* silent */ }
    };
    poll();
    const id = setInterval(poll, 15_000);
    return () => { cancelled = true; clearInterval(id); };
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
      lenBuf[0] = (orderHashBytes.length >> 8) & 0xff;
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
        boxes: [{ appIndex: item.vaultAppId, name: boxName }],
        suggestedParams: sp,
      });

      const encoded = algosdk.encodeUnsignedTransaction(txn);
      const txIds = await walletActions.signAndSubmit([encoded], { message: 'Claim FrySwap Guarantee' });
      await waitForFinalConfirmation(txIds[0], { network: getDefaultNetwork(), minConfirmations: 4 });

      // Confirm claim in DB
      await fetch('/api/swap/confirm-claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quoteId: item.quoteId, claimTxId: txIds[0] }),
      });

      toastInfo({ heading: 'Claimed!', message: `${formatAmount(item.amount)} ${targetToken.symbol} sent to your wallet.` });
      setClaimable(prev => prev.filter(c => c.quoteId !== item.quoteId));
    } catch (err: any) {
      console.error('[handleClaim]', err);
      toastError({ heading: 'Claim failed', message: err.message || 'Failed to claim guarantee.' });
    } finally {
      setIsClaiming(false);
    }
  }, [activeAccount, targetToken, isClaiming, walletActions, toastInfo, toastError]);

  const priceImpact = quote?.price_impact ?? 0;
  const priceImpactHigh = priceImpact > MAX_PRICE_IMPACT;
  const quoteValid = !!quote && !isStale && !priceImpactHigh && !quoteError;

  const handleExecuteSwap = useCallback(async () => {
    if (!quoteValid || !activeAccount) {
      toastInfo({ heading: 'Swap not ready', message: 'Wait for a valid quote and connect your wallet.' });
      return;
    }
    if (!targetToken) {
      toastError({ heading: 'Invalid token', message: 'Target token is not supported.' });
      return;
    }

    setIsExecuting(true);
    setExecutionStep('quoting');

    try {
      let currentQuote = quote;
      if (!currentQuote || isStale || (lastQuoteAt && Date.now() - lastQuoteAt > QUOTE_TTL_MS)) {
        const fresh = await fetchQuote();
        if (fresh) currentQuote = fresh;
      }

      if (!currentQuote) {
        toastError({ heading: 'No quote', message: 'Unable to get a fresh quote.' });
        return;
      }

      const network = getDefaultNetwork();

      setExecutionStep('preparing');
      const optedIn = await checkAssetOptIn(activeAccount.address, targetToken.id);
      if (!optedIn) {
        toastInfo({ heading: 'Opt-in required', message: `Opting into ${targetToken.symbol} before swapping...` });
        const encodedOptIn = await buildAssetOptInTransaction(activeAccount.address, targetToken.id);
        const optInTxIds = await walletActions.signAndSubmit([encodedOptIn], {
          message: `Authorize ${targetToken.symbol} opt-in`,
        });
        await waitForFinalConfirmation(optInTxIds[0], { network, minConfirmations: 4 });
        toastInfo({ heading: 'Opted in', message: `${targetToken.symbol} opt-in confirmed. Proceeding to swap...` });
      }

      const slippage = DEFAULT_SLIPPAGE_BPS / 10000;
      const { transactions: preparedTxns, quoteId } = await prepareSwapTransactions(currentQuote, activeAccount.address, slippage);

      let preBalance = 0;
      if (quoteId) {
        try { preBalance = await getAssetBalance(activeAccount.address, targetToken.id); } catch { /* non-critical */ }
      }

      setExecutionStep('signing');
      const result = await executeSwap(preparedTxns, walletActions, {
        message: 'Authorize swap',
        network,
      });

      setExecutionStep('confirming');
      if (result.confirmed) {
        toastInfo({
          heading: 'Swap confirmed',
          content: (
            <span>
              Swap complete.{' '}
              <a
                href={`https://allo.info/tx/${result.txIds[0]}`}
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                View on explorer
              </a>
            </span>
          ),
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
                clientReportedPostBalance: postBalance,
              });

              // Trigger server-side verification (which auto-triggers settlement if shortfall)
              const verifyRes = await fetch('/api/swap/verify-outcome', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ quoteId }),
              });
              const verifyData = await verifyRes.json();

              if (verifyData.settlement?.settled) {
                toastInfo({
                  heading: 'Guarantee settled',
                  content: (
                    <span>
                      Treasury top-up of {formatAmount(verifyData.settlement.shortfall)} {targetToken.symbol} sent.{' '}
                      <a
                        href={`https://allo.info/tx/${verifyData.settlement.txId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline"
                      >
                        View settlement
                      </a>
                    </span>
                  ),
                });
              }
            } catch { /* telemetry/settlement — never break swap UX */ }
          })();
        }
      } else {
        toastError({ heading: 'Swap not confirmed', message: 'Transaction was submitted but not confirmed in time.' });
      }
    } catch (err: any) {
      console.error('[handleExecuteSwap]', err);
      toastError({ heading: 'Swap failed', message: err.message || 'Unexpected error during swap.' });
    } finally {
      setIsExecuting(false);
      setExecutionStep(null);
    }
  }, [quoteValid, activeAccount, quote, isStale, lastQuoteAt, fetchQuote, targetToken, walletActions, toastInfo, toastError]);

  if (!targetToken) {
    return (
      <main className={`min-h-screen px-4 py-10 ${isDark ? 'bg-black text-white' : 'bg-white text-slate-900'}`}>
        <div className="mx-auto max-w-2xl">
          <Title>Invalid Token</Title>
          <p className="mt-4 text-sm opacity-70">Supported: fry, fnode, fvpn</p>
        </div>
      </main>
    );
  }

  return (
    <main
      className={`min-h-screen px-4 py-10 transition-colors ${
        isDark
          ? 'bg-gradient-to-b from-black via-[#150005] to-black text-white'
          : 'bg-gradient-to-b from-[#f8fafc] via-[#ffe8ee] to-white text-slate-900'
      }`}
    >
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
        <div className="flex items-center justify-between">
          <Title className={isDark ? 'text-white' : 'text-slate-900'}>
            FrySwap: {targetToken.name}
          </Title>
          {activeAccount && (
            <p className="text-xs opacity-60">
              {activeAccount.address.slice(0, 8)}...{activeAccount.address.slice(-8)}
            </p>
          )}
        </div>

        {claimable.length > 0 && (
          <section
            className={`rounded-2xl p-4 ${
              isDark
                ? 'border border-green-500/30 bg-green-900/20'
                : 'border border-green-600/40 bg-green-50'
            }`}
          >
            <div className="flex items-center gap-2 mb-2">
              <ShieldCheckIcon className="h-5 w-5 text-green-500" />
              <span className="font-semibold text-sm">FrySwap Guarantee Available</span>
            </div>
            {claimable.map((item) => (
              <div key={item.quoteId} className="flex items-center justify-between mt-2">
                <span className="text-sm">
                  {formatAmount(item.amount)} {targetToken?.symbol || 'FRY'} ready to claim
                </span>
                <button
                  onClick={() => handleClaim(item)}
                  disabled={isClaiming}
                  className={`rounded-lg px-4 py-1.5 text-sm font-medium transition ${
                    isClaiming
                      ? 'opacity-50 cursor-not-allowed bg-gray-400 text-white'
                      : 'bg-green-600 hover:bg-green-700 text-white'
                  }`}
                >
                  {isClaiming ? 'Claiming...' : 'Claim'}
                </button>
              </div>
            ))}
          </section>
        )}

        <section
          className={`relative rounded-3xl p-6 shadow-[0_25px_60px_rgba(0,0,0,0.45)] backdrop-blur-2xl sm:p-8 ${
            isDark
              ? 'border border-white/10 bg-white/5'
              : 'border border-red-500/50 bg-gradient-to-r from-[#e54152] via-[#d92b3c] to-[#e75b66]'
          }`}
        >
          <div className="flex flex-col gap-4">
            {/* Source selector */}
            <div className="flex flex-col gap-2">
              <label className="text-xs font-semibold uppercase tracking-wider opacity-80">Pay with</label>
              <select
                value={sourceId}
                onChange={(e) => setSourceId(Number(e.target.value))}
                className={`rounded-xl border px-4 py-3 text-sm outline-none transition ${
                  isDark
                    ? 'border-white/20 bg-black/30 text-white focus:border-red-500'
                    : 'border-white/40 bg-white/30 text-slate-900 focus:border-red-600'
                }`}
              >
                {SOURCE_TOKENS.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.symbol})
                  </option>
                ))}
              </select>
            </div>

            {/* Amount input */}
            <div className="flex flex-col gap-2">
              <label className="text-xs font-semibold uppercase tracking-wider opacity-80">Amount</label>
              <input
                type="number"
                min="0"
                step="0.000001"
                value={amountStr}
                onChange={(e) => setAmountStr(e.target.value)}
                placeholder={`Enter ${sourceToken.symbol} amount`}
                className={`rounded-xl border px-4 py-3 text-sm outline-none transition ${
                  isDark
                    ? 'border-white/20 bg-black/30 text-white placeholder-white/40 focus:border-red-500'
                    : 'border-white/40 bg-white/30 text-slate-900 placeholder-slate-500 focus:border-red-600'
                }`}
              />
            </div>

            {/* Quote display */}
            <div className={`rounded-2xl p-4 ${isDark ? 'bg-black/40' : 'bg-white/40'}`}>
              {loading && !quote && (
                <div className="flex items-center gap-2 text-sm opacity-70">
                  <RefreshIcon className="h-4 w-4 animate-spin" /> Fetching quote...
                </div>
              )}

              {quoteError && (
                <div className="flex items-center gap-2 text-sm text-red-400">
                  <ExclamationIcon className="h-4 w-4" /> {quoteError}
                </div>
              )}

              {quote && (
                <div className="flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs opacity-70">Estimated receive</span>
                    <span className="text-lg font-semibold">
                      {formatAmount(quote.amount_out)} {targetToken.symbol}
                    </span>
                  </div>

                  {/* Guarantee display */}
                  {guarantee?.eligible && (
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1 text-xs text-green-400">
                        <ShieldCheckIcon className="h-4 w-4" />
                        Guaranteed receive
                      </span>
                      <span className="text-lg font-semibold text-green-400">
                        {formatAmount(guarantee.guaranteedAmount)} {targetToken.symbol}
                      </span>
                    </div>
                  )}

                  {guarantee?.eligible && (
                    <div className={`rounded-xl px-3 py-2 text-xs ${isDark ? 'bg-green-900/30 text-green-300' : 'bg-green-100 text-green-800'}`}>
                      FrySwap Guarantee Active
                    </div>
                  )}

                  {guarantee && !guarantee.eligible && guarantee.reason && (
                    <div className={`rounded-xl px-3 py-2 text-xs ${isDark ? 'bg-yellow-900/20 text-yellow-400' : 'bg-yellow-50 text-yellow-700'}`}>
                      {guarantee.reason}
                    </div>
                  )}

                  <div className="flex items-center justify-between">
                    <span className="text-xs opacity-70">Price impact</span>
                    <span className={`text-sm ${priceImpactHigh ? 'text-red-400 font-semibold' : 'opacity-90'}`}>
                      {formatPriceImpact(quote.price_impact)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs opacity-70">Network fee</span>
                    <span className="text-sm opacity-90">{quote.network_fee} uALGO</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs opacity-70">Venue</span>
                    <span className="text-sm opacity-90">Vestige (SEF)</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs opacity-70">Slippage tolerance</span>
                    <span className="text-sm opacity-90">{(DEFAULT_SLIPPAGE_BPS / 100).toFixed(2)}%</span>
                  </div>
                  {isStale && (
                    <div className="flex items-center gap-2 text-xs text-yellow-400">
                      <InformationCircleIcon className="h-4 w-4" /> Quote expired - refresh to update
                    </div>
                  )}
                  {priceImpactHigh && (
                    <div className="flex items-center gap-2 text-xs text-red-400">
                      <ExclamationIcon className="h-4 w-4" /> High price impact (&gt;5%). Swap may be unfavorable.
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* CTA */}
            <button
              onClick={handleExecuteSwap}
              disabled={!quoteValid || isExecuting}
              className={`inline-flex items-center justify-center gap-2 rounded-xl px-6 py-3 text-sm font-semibold transition ${
                quoteValid && !isExecuting
                  ? isDark
                    ? 'bg-red-600 text-white hover:bg-red-500'
                    : 'bg-white text-red-600 hover:bg-red-50'
                  : 'cursor-not-allowed opacity-50'
              }`}
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
              <p className="text-center text-xs opacity-60">
                Connect your wallet via the header to see your address.
              </p>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
