
import axios from 'axios';
import { tFRY } from './utils';

// Basic in-process caching to avoid rate limits and noisy logs
const PRICE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const PRICE_REQUEST_TIMEOUT_MS = 4000; // fail fast so API callers do not hang
let algoCache: { lastFetched: number; price: number } = { lastFetched: 0, price: 0 };
let lastAlgoErrorAt = 0;

// User-Agent header (CoinGecko requires it; Vestige accepts it)
const USER_AGENT = 'FryNetworks-Dashboard/1.0 (https://dashboard.frynetworks.com)';

// Fetch ALGO/USD price: Vestige v4 primary, CoinGecko fallback
export const getAlgoUsdPrice = async (): Promise<number> => {
  const now = Date.now();
  if (now - algoCache.lastFetched < PRICE_TTL_MS && algoCache.price > 0) {
    return algoCache.price;
  }

  // Primary: Vestige v4 (USDC/ALGO price inverted → ALGO/USD)
  try {
    const response = await axios.get(
      'https://api.vestigelabs.org/assets/price?asset_ids=31566704',
      { timeout: PRICE_REQUEST_TIMEOUT_MS, headers: { 'User-Agent': USER_AGENT } }
    );
    const data = response.data;
    if (
      response.status === 200 &&
      Array.isArray(data) &&
      data.length > 0 &&
      data[0].asset_id === 31566704 &&
      typeof data[0].price === 'number' &&
      isFinite(data[0].price) &&
      data[0].price > 0 &&
      (data[0].confidence ?? 1) >= 0.5
    ) {
      const price = 1 / data[0].price;
      algoCache = { lastFetched: now, price };
      return price;
    }
  } catch {
    // Vestige failed — fall through to CoinGecko
  }

  // Fallback: CoinGecko
  try {
    const response = await axios.get(
      'https://api.coingecko.com/api/v3/simple/price?ids=algorand&vs_currencies=usd',
      { timeout: PRICE_REQUEST_TIMEOUT_MS, headers: { 'User-Agent': USER_AGENT } }
    );
    const price = response.data?.algorand?.usd;
    if (typeof price === 'number' && price > 0) {
      algoCache = { lastFetched: now, price };
      return price;
    }
  } catch (error) {
    if (now - lastAlgoErrorAt > 60_000) {
      console.error('[PRICE] All oracles failed for ALGO/USD:', error);
      lastAlgoErrorAt = now;
    }
  }

  // Last resort: cached value if available
  return algoCache.price || 0;
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
