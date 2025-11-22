import { useEffect, useState } from 'react';

export type TokenPrices = {
  fry2?: number;
  fnode?: number;
  tfry?: number | null;
};

const PRICE_ASSETS = ['2485314946', '2485202024'];

export function useTokenPrices(refreshMs: number = 300000): TokenPrices {
  const [prices, setPrices] = useState<TokenPrices>({});

  useEffect(() => {
    let active = true;
    let interval: ReturnType<typeof setInterval> | undefined;

    const fetchPrices = async () => {
      try {
        const res = await fetch('/api/price/get', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ asset_ids: PRICE_ASSETS })
        });
        if (!res.ok) return;
        const json = await res.json();
        if (!active) return;
        setPrices({
          fry2: json?.prices?.[PRICE_ASSETS[0]] ?? 0,
          fnode: json?.prices?.[PRICE_ASSETS[1]] ?? 0,
          tfry: null // tFRY is earned-only; no market price
        });
      } catch (error) {
        console.error('[useTokenPrices] Failed to fetch prices', error);
      }
    };

    fetchPrices();
    interval = setInterval(fetchPrices, refreshMs);

    return () => {
      active = false;
      if (interval) clearInterval(interval);
    };
  }, [refreshMs]);

  return prices;
}
