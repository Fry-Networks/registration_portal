'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

const STORAGE_KEY = 'genesisBannerDismissed';

type Collection = {
  key: string;
  name: string;
  app_id: number;
  total_supply: number;
  total_minted: number | null;
  degraded: boolean;
};

export default function GenesisMintBanner() {
  const [dismissed, setDismissed] = useState(true);
  const [mounted, setMounted] = useState(false);
  const [collections, setCollections] = useState<Collection[] | null>(null);

  useEffect(() => {
    setMounted(true);
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      setDismissed(raw === 'true');
    } catch {
      setDismissed(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    fetch('/api/genesis/fry-fee/config')
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (!active) return;
        setCollections(Array.isArray(json?.collections) ? json.collections : []);
      })
      .catch(() => {
        if (active) setCollections([]);
      });
    return () => {
      active = false;
    };
  }, []);

  const handleDismiss = () => {
    setDismissed(true);
    try {
      sessionStorage.setItem(STORAGE_KEY, 'true');
    } catch {
      // ignore
    }
  };

  if (!mounted || dismissed) return null;

  // A count we could not read stays unknown — rendering 0 would read as "none minted".
  const renderCollection = (c: Collection) => {
    const unknown = c.degraded || typeof c.total_minted !== 'number';
    const percent = unknown
      ? 0
      : Math.min(100, Math.round(((c.total_minted as number) / c.total_supply) * 100));
    return (
      <div key={c.key} className="flex items-center gap-3">
        <span className="text-xs font-medium text-white/60 w-[150px] shrink-0 truncate">{c.name}</span>
        <div className="flex-1 h-1.5 bg-white/20 rounded-full overflow-hidden max-w-[160px]">
          {!unknown && (
            <div
              className="h-full bg-white rounded-full transition-all duration-500"
              style={{ width: `${percent}%` }}
            />
          )}
        </div>
        <span className="text-xs font-medium text-white/70">
          {unknown
            ? 'count unavailable'
            : `${c.total_minted} / ${c.total_supply} minted (${percent}%)`}
        </span>
      </div>
    );
  };

  return (
    <div className="relative overflow-hidden rounded-token-lg bg-gradient-to-r from-primary-600 to-primary-900 text-white shadow-token-md">
      {/* Dismiss button */}
      <button
        type="button"
        onClick={handleDismiss}
        className="absolute top-2 right-2 z-10 p-1.5 rounded-token-md bg-white/10 hover:bg-white/20 transition text-white/80 hover:text-white"
        aria-label="Dismiss Genesis NFT banner"
      >
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>

      <div className="px-5 py-4 sm:px-6 sm:py-5 flex flex-col sm:flex-row items-start sm:items-center gap-4">
        {/* Left: text + scarcity */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-lg" role="img" aria-label="fire">🔥</span>
            <h2 className="font-display text-base sm:text-lg font-bold tracking-tight">
              Genesis NFT — Limited Collection
            </h2>
          </div>
          <p className="text-sm text-white/80 mb-2">
            Strictly limited supply. Claim your spot in Fry Networks history.
          </p>
          {/* Scarcity bars — one per collection, live from chain */}
          <div className="flex flex-col gap-1.5">
            {collections === null ? (
              <div className="flex items-center gap-3">
                <div className="flex-1 h-1.5 bg-white/20 rounded-full overflow-hidden max-w-[160px]" />
                <span className="text-xs font-medium text-white/50">Loading mint counts…</span>
              </div>
            ) : collections.length === 0 ? (
              <span className="text-xs font-medium text-white/70">Mint counts unavailable</span>
            ) : (
              collections.map(renderCollection)
            )}
          </div>
          <p className="text-xs text-white/60 mt-1.5">
            Genesis holders earn 10% of fry.farm fees every month, forever — completely passive income.
          </p>
        </div>

        {/* Right: CTA */}
        <div className="shrink-0">
          <Link
            href="https://fry.farm/genesis-mint"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-token-md bg-white text-primary-700 font-bold text-sm hover:bg-white/90 transition shadow-sm"
          >
            Mint Now
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
            </svg>
          </Link>
        </div>
      </div>
    </div>
  );
}
