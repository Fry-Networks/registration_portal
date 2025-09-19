import { useEffect, useState, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface FloatingTotalsWidgetProps {
  totals: {
    totals: {
      fry1: { pending: number; claimable: number; claimed: number; accruing: number };
      fnode: { pending: number; claimable: number; claimed: number; accruing: number };
      tfry: { pending: number; claimable: number; claimed: number; accruing: number };
    };
    nextUnlockAt?: string;
  } | null;
  countdown: string;
  estimatedFry1: number;
  estimatedFnode: number;
  estimatedTfry: number;
}

const FloatingTotalsWidget: React.FC<FloatingTotalsWidgetProps> = ({
  totals,
  countdown,
  estimatedFry1,
  estimatedFnode,
  estimatedTfry
}) => {
  const [isScrolled, setIsScrolled] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [scrollY, setScrollY] = useState(0);
  const [prices, setPrices] = useState<{ fry1?: number; fry2?: number; fnode?: number }>({});

  // Token amount formatting (2 decimals)
  const fmt = (v?: number) => (v ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  // Fiat formatting with up to 8 decimals, trimming trailing zeros; keep at least 2 decimals
  const fmtUSD = (v?: number) => {
    const n = Number(v || 0);
    if (!isFinite(n)) return '$0.00';
    if (n >= 1) return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    let s = n.toFixed(8); // up to 8 decimals
    s = s.replace(/0+$/,''); // strip trailing zeros
    if (s.endsWith('.')) s = s.slice(0, -1);
    if (!s.includes('.')) s = `${s}.00`;
    const [int, dec] = s.split('.');
    const dec2 = dec.length < 2 ? dec + '0'.repeat(2 - dec.length) : dec;
    return `$${int}.${dec2}`;
  };

  // Minimal scroll detection with heavy throttling
  useEffect(() => {
    let scrollTimeout: NodeJS.Timeout;
    
    const handleScroll = () => {
      // Heavy throttling to minimize updates
      clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(() => {
        const currentScrollY = window.scrollY;
        const shouldShow = currentScrollY > 400;
        
        // Only update if state actually needs to change
        if (shouldShow !== isScrolled) {
          setIsScrolled(shouldShow);
        }
        setScrollY(currentScrollY);
      }, 100); // Much less frequent updates
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', handleScroll);
      clearTimeout(scrollTimeout);
    };
  }, [isScrolled]);

  // Auto-collapse expanded state when scrolling
  useEffect(() => {
    if (isScrolled && isExpanded && scrollY > 0) {
      const timer = setTimeout(() => setIsExpanded(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [scrollY, isScrolled, isExpanded]);

  // Circular progress for countdown
  const getCountdownProgress = useMemo(() => {
    if (!countdown) return 0;
    // Extract days from countdown string (e.g., "5d 7h 29m 18s")
    const daysMatch = countdown.match(/(\d+)d/);
    const hoursMatch = countdown.match(/(\d+)h/);
    const days = daysMatch ? parseInt(daysMatch[1]) : 0;
    const hours = hoursMatch ? parseInt(hoursMatch[1]) : 0;
    
    // Calculate progress (assuming 7-day cycle)
    const totalHours = (7 * 24);
    const remainingHours = (days * 24) + hours;
    return ((totalHours - remainingHours) / totalHours) * 100;
  }, [countdown]);

  // Animation variants
  const widgetVariants = {
    full: {
      scale: 1,
      x: 0,
      y: 0,
      width: '100%',
      height: 'auto',
      borderRadius: '0.75rem',
      transition: { duration: 0.5, ease: 'easeInOut' }
    },
    compact: {
      scale: 0.8,
      x: window.innerWidth > 768 ? 'calc(50vw - 120px)' : 'calc(50vw - 100px)',
      y: window.innerWidth > 768 ? -20 : -15,
      width: window.innerWidth > 768 ? '240px' : '200px',
      height: '80px',
      borderRadius: '2rem',
      transition: { duration: 0.5, ease: 'easeInOut' }
    }
  };

  const contentVariants = {
    full: {
      opacity: 1,
      scale: 1,
      transition: { duration: 0.3, delay: 0.2 }
    },
    compact: {
      opacity: 0,
      scale: 0.8,
      transition: { duration: 0.2 }
    }
  };

  const compactContentVariants = {
    hidden: {
      opacity: 0,
      scale: 0.8,
      transition: { duration: 0.2 }
    },
    visible: {
      opacity: 1,
      scale: 1,
      transition: { duration: 0.3, delay: 0.3 }
    }
  };

  // Fetch current prices (FRY 1.0, FRY 2.0 and fNode)
  useEffect(() => {
    let active = true;
    const run = async () => {
      try {
        const res = await fetch('/api/price/get', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ asset_ids: ['924268058','2485314946', '2485202024'] }) });
        if (!res.ok) return;
        const json = await res.json();
        if (!active) return;
        setPrices({ fry1: json?.prices?.['924268058'] ?? 0, fry2: json?.prices?.['2485314946'] ?? 0, fnode: json?.prices?.['2485202024'] ?? 0 });
      } catch {}
    };
    run();
    const id = setInterval(run, 300000);
    return () => { active = false; clearInterval(id); };
  }, []);

  if (!totals?.totals) return null;

  return (
    <>
      {/* Full-width ribbon (initial state) - NO animations to prevent jumping */}
      {!isScrolled && (
        <div className="w-full">
          <div className="mx-auto max-w-7xl px-2 sm:px-20 py-3">
            {/* Live prices row */}
            <div className="text-white text-xs mb-2 flex items-center justify-center gap-4">
              <span>FRY 1.0 (924268058): {fmtUSD(prices.fry1)}</span>
              <span className="opacity-40">|</span>
              <span>FRY 2.0 (2485314946): {fmtUSD(prices.fry2)}</span>
              <span className="opacity-40">|</span>
              <span>fNode (2485202024): {fmtUSD(prices.fnode)}</span>
              <span className="opacity-40">|</span>
              <a href="https://docs.frynetworks.com/dashboard/registration" target="_blank" rel="noreferrer" className="underline text-gray-300">Registration Guide</a>
            </div>
            <div className="grid gap-3 grid-cols-1 md:grid-cols-2 lg:grid-cols-4">
              {/* FRY 1.0 Totals */}
              <div className="rounded-xl p-5 shadow-md shadow-gray-600 text-white">
                <div className="text-xs uppercase tracking-wide text-gray-300">FRY 1.0 Totals (924268058)</div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                  <div><div className="text-gray-400">Accruing</div><div className="font-semibold tabular-nums">{fmt(totals.totals.fry1.accruing)}</div></div>
                  <div><div className="text-gray-400">Pending</div><div className="font-semibold tabular-nums">{fmt(totals.totals.fry1.pending)}</div></div>
                  <div><div className="text-gray-400">Claimable</div><div className="font-semibold tabular-nums">{fmt(totals.totals.fry1.claimable)}</div></div>
                  <div><div className="text-gray-400">Claimed</div><div className="font-semibold tabular-nums">{fmt(totals.totals.fry1.claimed)}</div></div>
                </div>
              </div>

              {/* fNode Totals */}
              <div className="rounded-xl p-5 shadow-md shadow-gray-600 text-white">
                <div className="text-xs uppercase tracking-wide text-gray-300">fNode Totals (2485202024)</div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                  <div><div className="text-gray-400">Accruing</div><div className="font-semibold tabular-nums">{fmt(totals.totals.fnode.accruing)}</div></div>
                  <div><div className="text-gray-400">Pending</div><div className="font-semibold tabular-nums">{fmt(totals.totals.fnode.pending)}</div></div>
                  <div><div className="text-gray-400">Claimable</div><div className="font-semibold tabular-nums">{fmt(totals.totals.fnode.claimable)}</div></div>
                  <div><div className="text-gray-400">Claimed</div><div className="font-semibold tabular-nums">{fmt(totals.totals.fnode.claimed)}</div></div>
                </div>
              </div>

              {/* tFry Totals */}
              <div className="rounded-xl p-5 shadow-md shadow-gray-600 text-white">
                <div className="text-xs uppercase tracking-wide text-gray-300">tFry Totals 
                  <span className="ml-2 px-2 py-1 text-xs bg-gray-700/50 text-gray-300 rounded-full">Coming Soon</span>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                  <div><div className="text-gray-400">Accruing</div><div className="font-semibold tabular-nums">{fmt(totals.totals.tfry?.accruing || 0)}</div></div>
                  <div><div className="text-gray-400">Pending</div><div className="font-semibold tabular-nums">{fmt(totals.totals.tfry?.pending || 0)}</div></div>
                  <div><div className="text-gray-400">Claimable</div><div className="font-semibold tabular-nums">{fmt(totals.totals.tfry?.claimable || 0)}</div></div>
                  <div><div className="text-gray-400">Claimed</div><div className="font-semibold tabular-nums">{fmt(totals.totals.tfry?.claimed || 0)}</div></div>
                </div>
              </div>

              {/* Countdown */}
              <div className="rounded-xl p-5 shadow-md shadow-gray-600 text-white">
                <div className="text-xs uppercase tracking-wide text-gray-300">Next FRYday (UTC 00:05)</div>
                <div className="mt-1 text-2xl font-semibold tabular-nums">{(() => { const dm = countdown.match(/(\d+)d/); if (dm && parseInt(dm[1]) === 0) return countdown.replace(/^0d\s*/,''); return countdown; })()}</div>
                <div className="text-xs text-gray-400">{totals.nextUnlockAt ? new Date(totals.nextUnlockAt).toUTCString() : ''}</div>
                <div className="mt-2 text-sm text-gray-200">
                  <div className="grid grid-cols-1 gap-1">
                    <div><span className="font-semibold">Est. FRY 1.0:</span> {fmt(estimatedFry1)}</div>
                    <div><span className="font-semibold">Est. fNode:</span> {fmt(estimatedFnode)}</div>
                    <div><span className="font-semibold">Est. tFry:</span> {fmt(estimatedTfry)}</div>
                  </div>
                  <div className="text-xs text-gray-400 mt-1">Rewards accrue daily and unlock as a single weekly reward every Friday at 00:05 UTC. This countdown shows time remaining to the next weekly unlock. Estimates are projected from your current accrual pace for each asset.</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Floating compact widget */}
      <AnimatePresence>
        {isScrolled && (
          <motion.div
            className="fixed top-28 right-4 z-50 cursor-pointer"
            initial={{ opacity: 0, scale: 0.8, x: 100 }}
            animate={{ opacity: 1, scale: 1, x: 0 }}
            exit={{ opacity: 0, scale: 0.8, x: 100 }}
            transition={{ duration: 0.5, ease: 'easeInOut' }}
            onClick={() => setIsExpanded(!isExpanded)}
          >
            {/* Compact Widget */}
            <motion.div
              className="bg-gradient-to-br from-gray-800/90 to-gray-900/95 backdrop-blur-md border border-red-600/50 shadow-2xl"
              animate={isExpanded ? 'expanded' : 'compact'}
              variants={{
                compact: {
                  width: window.innerWidth > 768 ? '240px' : '200px',
                  height: '80px',
                  borderRadius: '2rem',
                  padding: '12px'
                },
                expanded: {
                  width: window.innerWidth > 768 ? '400px' : '320px',
                  height: 'auto',
                  borderRadius: '1rem',
                  padding: '20px'
                }
              }}
              transition={{ duration: 0.3 }}
            >
              {/* Compact Content */}
              <motion.div
                className={`${isExpanded ? 'hidden' : 'flex'} items-center justify-between h-full text-white`}
              >
                {/* Circular Countdown */}
                <div className="relative">
                  <svg className="w-12 h-12 transform -rotate-90" viewBox="0 0 36 36">
                    {/* Background circle */}
                    <path
                      d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                      fill="none"
                      stroke="#374151"
                      strokeWidth="2"
                    />
                    {/* Progress circle */}
                    <path
                      d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                      fill="none"
                      stroke="#dc2626"
                      strokeWidth="2"
                      strokeDasharray={`${getCountdownProgress}, 100`}
                    />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-xs font-semibold text-red-400">
                      {countdown.split(' ')[0]}
                    </span>
                  </div>
                </div>

                {/* Compact Totals - Show accruing amounts for current epoch */}
                <div className="flex-1 ml-3 text-xs">
                  <div className="flex justify-between items-center">
                    <span className="text-gray-400">FRY 1.0:</span>
                    <span className="font-semibold text-orange-400">{fmt(totals.totals.fry1.accruing)}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-gray-400">fNode:</span>
                    <span className="font-semibold text-orange-400">{fmt(totals.totals.fnode.accruing)}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-gray-400">tFry:</span>
                    <span className="font-semibold text-orange-400">{fmt(totals.totals.tfry?.accruing || 0)}</span>
                  </div>
                </div>

                {/* Expand Icon */}
                <div className="ml-2">
                  <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                  </svg>
                </div>
              </motion.div>

              {/* Expanded Content */}
              <motion.div
                className={`${isExpanded ? 'block' : 'hidden'} text-white`}
                initial={{ opacity: 0 }}
                animate={{ opacity: isExpanded ? 1 : 0 }}
                transition={{ duration: 0.3 }}
              >
                <div className="flex justify-between items-center mb-3">
                  <h3 className="text-sm font-semibold text-red-400">Rewards Summary</h3>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setIsExpanded(false);
                    }}
                    className="text-gray-400 hover:text-white"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                {/* Prices */}
                <div className="text-xs text-gray-300 mb-3 text-center">
                  FRY 1.0 (924268058): {fmtUSD(prices.fry1)} • FRY 2.0 (2485314946): {fmtUSD(prices.fry2)} • fNode (2485202024): {fmtUSD(prices.fnode)}
                </div>

                {/* Expanded Totals */}
                <div className="space-y-3 text-xs">
                  {/* FRY 1.0 */}
                  <div>
                    <div className="text-gray-400 mb-1">FRY 1.0 Totals (924268058)</div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="flex justify-between">
                        <span className="text-gray-500">Accruing:</span>
                        <span className="font-semibold">{fmt(totals.totals.fry1.accruing)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">Pending:</span>
                        <span className="font-semibold">{fmt(totals.totals.fry1.pending)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">Claimable:</span>
                        <span className="font-semibold text-green-400">{fmt(totals.totals.fry1.claimable)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">Claimed:</span>
                        <span className="font-semibold">{fmt(totals.totals.fry1.claimed)}</span>
                      </div>
                    </div>
                  </div>

                  {/* fNode */}
                  <div>
                    <div className="text-gray-400 mb-1">fNode Totals (2485202024)</div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="flex justify-between">
                        <span className="text-gray-500">Accruing:</span>
                        <span className="font-semibold">{fmt(totals.totals.fnode.accruing)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">Pending:</span>
                        <span className="font-semibold">{fmt(totals.totals.fnode.pending)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">Claimable:</span>
                        <span className="font-semibold text-green-400">{fmt(totals.totals.fnode.claimable)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">Claimed:</span>
                        <span className="font-semibold">{fmt(totals.totals.fnode.claimed)}</span>
                      </div>
                    </div>
                  </div>

                  {/* tFry */}
                  <div>
                    <div className="text-gray-400 mb-1">tFry Totals 
                      <span className="ml-2 px-1 py-0.5 text-xs bg-gray-700/50 text-gray-300 rounded">Soon</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="flex justify-between">
                        <span className="text-gray-500">Accruing:</span>
                        <span className="font-semibold">{fmt(totals.totals.tfry?.accruing || 0)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">Pending:</span>
                        <span className="font-semibold">{fmt(totals.totals.tfry?.pending || 0)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">Claimable:</span>
                        <span className="font-semibold text-green-400">{fmt(totals.totals.tfry?.claimable || 0)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">Claimed:</span>
                        <span className="font-semibold">{fmt(totals.totals.tfry?.claimed || 0)}</span>
                      </div>
                    </div>
                  </div>

                  {/* Countdown */}
                  <div className="border-t border-gray-600 pt-2">
                    <div className="text-gray-400 mb-1">Next FRYday</div>
                    <div className="text-lg font-semibold text-red-400">{countdown}</div>
                    <div className="text-xs text-gray-500 mt-1">
                      Est. weekly: {fmt(estimatedFry1)} FRY 1.0, {fmt(estimatedFnode)} fNode, {fmt(estimatedTfry)} tFry
                    </div>
                  </div>
                </div>
              </motion.div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};

export default FloatingTotalsWidget;
