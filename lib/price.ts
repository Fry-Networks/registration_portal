
import axios from 'axios';
import { tFRY } from './utils';

// Basic in-process caching to avoid rate limits and noisy logs
const PRICE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const PRICE_REQUEST_TIMEOUT_MS = 4000; // fail fast so API callers do not hang
let algoCache: { lastFetched: number; price: number } = { lastFetched: 0, price: 0 };
let lastAlgoErrorAt = 0;

// Fetch ALGO/USD price from CoinGecko with TTL caching
export const getAlgoUsdPrice = async (): Promise<number> => {
  const now = Date.now();
  if (now - algoCache.lastFetched < PRICE_TTL_MS && algoCache.price > 0) {
    return algoCache.price;
  }
  try {
    const response = await axios.get(
      'https://api.coingecko.com/api/v3/simple/price?ids=algorand&vs_currencies=usd',
      { timeout: PRICE_REQUEST_TIMEOUT_MS }
    );
    const price = response.data?.algorand?.usd;
    if (typeof price === 'number') {
      algoCache = { lastFetched: now, price };
      return price;
    }
    throw new Error('Invalid response from CoinGecko');
  } catch (error) {
    // Throttle error logs to at most once per minute
    if (now - lastAlgoErrorAt > 60_000) {
      console.error('Error fetching ALGO/USD price from CoinGecko:', error);
      lastAlgoErrorAt = now;
    }
    // If we have a recent cached price, return it; otherwise 0
    return algoCache.price || 0;
  }
};

const FRYVerID = 924268058;
// const fryURL = `https://free-api.vestige.fi/asset/${FRYVerID}/price`;
// const algoURL = 'https://free-api.vestige.fi/currency/prices';`
// Per-asset USD price cache (via Vestige price * ALGO/USD)
const fryUsdPriceCache: Record<string, { lastFetched: number; price: number }> = {};

export const getFRYPrice = async (asset_id: string): Promise<number> => {
  const now = Date.now();
  const cached = fryUsdPriceCache[asset_id];
  if (cached && now - cached.lastFetched < PRICE_TTL_MS && cached.price > 0) {
    return cached.price;
  }
  // tFry is not yet tradeable, so skip Vestige lookups and report $0.00.
  if (asset_id === tFRY.id) {
    fryUsdPriceCache[asset_id] = { lastFetched: now, price: 0 };
    return 0;
  }
  try {
    const fryURL = `https://api.vestigelabs.org/assets/price?asset_ids=${asset_id}`;
    const response = await axios.get(fryURL, { timeout: PRICE_REQUEST_TIMEOUT_MS });
    if (!response.data || response.data.length === 0) {
      console.error(`No data found for asset ID: ${asset_id}`);
      return cached?.price || 0.0;
    }
    const algoUsd = await getAlgoUsdPrice();
    const priceAlgo = parseFloat(response.data[0].price);
    const priceUsd = priceAlgo * (algoUsd || 0);
    const usdRounded = parseFloat(priceUsd.toFixed(6));
    fryUsdPriceCache[asset_id] = { lastFetched: now, price: usdRounded };
    return usdRounded;
  } catch (error) {
    // Avoid spamming logs; rely on algo throttling and log once here per failure
    console.error(`Error fetching price for ${asset_id}:`, error);
    return cached?.price || 0.0;
  }
};
