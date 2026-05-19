/**
 * Route liquidity check for guarantee eligibility.
 * Uses quote price impact as proxy for pool depth.
 */
import type { VestigeQuote } from './fryfarmAdapter';

export interface LiquidityCheck {
  eligible: boolean;
  routeLiquidityUsd: number;
  liquiditySource: string;
  liquidityTimestamp: number;
  reason?: string;
}

export async function checkRouteLiquidity(
  quote: VestigeQuote
): Promise<LiquidityCheck> {
  const now = Date.now();
  const priceImpact = Number(quote.price_impact) || 0;
  const amountInUsd = (Number(quote.amount) * Number(quote.asset_in_price)) / 1_000_000;

  // If price impact < 10%, the pool can handle this trade with acceptable slippage
  // This is the primary eligibility gate for guarantee
  if (priceImpact <= 0 || priceImpact >= 0.10) {
    return {
      eligible: false,
      routeLiquidityUsd: amountInUsd / Math.max(priceImpact, 0.001),
      liquiditySource: 'vestige_price_impact',
      liquidityTimestamp: now,
      reason: priceImpact >= 0.10
        ? 'Route price impact too high for guarantee'
        : 'Unable to determine route liquidity',
    };
  }

  const estimatedLiquidity = amountInUsd / priceImpact;
  return {
    eligible: true,
    routeLiquidityUsd: estimatedLiquidity,
    liquiditySource: 'vestige_price_impact',
    liquidityTimestamp: now,
  };
}
