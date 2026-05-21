import type { AggregatorQuote } from './aggregator';
/**
 * Route liquidity check for guarantee eligibility.
 * Uses quote price impact as proxy for pool depth.
 */
import type { VestigeQuote } from './fryfarmAdapter';
import { getMinLpUsd } from './guaranteeConfig';

export interface LiquidityCheck {
  eligible: boolean;
  routeLiquidityUsd: number;
  liquiditySource: string;
  liquidityTimestamp: number;
  reason?: string;
}

export async function checkRouteLiquidity(
  quote: AggregatorQuote | VestigeQuote
): Promise<LiquidityCheck> {
  const now = Date.now();
  const priceImpact = Number(quote.price_impact) || 0;
  const amountInUsd = (Number(quote.amount) * Number(quote.asset_in_price)) / 1_000_000;

  // If price impact < 10%, the pool can handle this trade with acceptable slippage
  // This is the primary eligibility gate for guarantee
  if (priceImpact <= 0) {
    return {
      eligible: false,
      routeLiquidityUsd: 0,
      liquiditySource: 'vestige_price_impact',
      liquidityTimestamp: now,
      reason: 'Unable to determine route liquidity',
    };
  }

  const estimatedLiquidity = amountInUsd / priceImpact;
  
  // Check minimum estimated liquidity threshold
  const minLpUsd = getMinLpUsd();
  if (estimatedLiquidity < minLpUsd) {
    return {
      eligible: false,
      routeLiquidityUsd: estimatedLiquidity,
      liquiditySource: 'vestige_price_impact',
      liquidityTimestamp: now,
      reason: `Estimated route liquidity (${estimatedLiquidity.toFixed(2)} USD) below minimum threshold (${minLpUsd} USD)`,
    };
  }

  return {
    eligible: true,
    routeLiquidityUsd: estimatedLiquidity,
    liquiditySource: 'vestige_price_impact',
    liquidityTimestamp: now,
  };
}
