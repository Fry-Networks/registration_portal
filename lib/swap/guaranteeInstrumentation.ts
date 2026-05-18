/**
 * Guarantee instrumentation — quote-commit recording and post-swap telemetry.
 *
 * Disabled by default. Enable via GUARANTEE_INSTRUMENTATION_ENABLED=true.
 * This module performs NO payouts, NO treasury signing, NO user-facing changes.
 * Outcome data is CLIENT-REPORTED and non-authoritative.
 *
 * Committed quantity definition:
 *   committed = floor(amount_out * (1 - slippagePct / 100))
 *   Lock moment: timestamp when /api/swap/execute processes the quote
 *   Expiry: lockTimestamp + QUOTE_TTL_MS (30s)
 *   Data source: Vestige aggregator quote (SEF mode)
 */
import { recordGuaranteeEvent, type QuoteCommitment } from './guaranteeStore';
import { QUOTE_TTL_MS } from './constants';

export function isInstrumentationEnabled(): boolean {
  return process.env.GUARANTEE_INSTRUMENTATION_ENABLED === 'true';
}

/**
 * Record a quote commitment when /api/swap/execute prepares transactions.
 * Fire-and-forget — never throws, never blocks the swap flow.
 */
export async function recordQuoteCommitment(params: {
  quoteId: string;
  quote: Record<string, unknown>;
  sender: string;
  slippage: number;
}): Promise<void> {
  if (!isInstrumentationEnabled()) return;

  const { quoteId, quote, sender, slippage } = params;
  const now = Date.now();

  // slippage from client is a fraction (e.g. 0.01 for 1%), convert to percent
  const slippagePct = typeof slippage === 'number' && slippage > 0 && slippage < 1
    ? slippage * 100
    : typeof slippage === 'number' && slippage >= 1
      ? slippage
      : 1;

  const rawAmountOut = Number(quote.amount_out) || 0;
  const committedAmount = Math.floor(rawAmountOut * (1 - slippagePct / 100));

  const commitment: QuoteCommitment = {
    type: 'quote_commitment',
    quoteId,
    status: 'pending',
    lockTimestamp: now,
    expiryTimestamp: now + QUOTE_TTL_MS,
    inputAsset: Number(quote.asset_in) || 0,
    inputAmount: Number(quote.amount) || 0,
    outputAsset: Number(quote.asset_out) || 0,
    rawAmountOut,
    committedAmount,
    slippagePct,
    vestigeMode: String(quote.mode || 'sef'),
    userAddress: sender,
    priceImpact: Number(quote.price_impact) || 0,
    networkFee: Number(quote.network_fee) || 0,
    assetInPrice: Number(quote.asset_in_price) || 0,
    assetOutPrice: Number(quote.asset_out_price) || 0,
    createdAt: new Date(),
  };

  try {
    await recordGuaranteeEvent(commitment);
  } catch (err) {
    console.error('[guarantee-instrumentation] Failed to record quote commitment:', err);
  }
}
