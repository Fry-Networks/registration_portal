import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Tooltip from './Tooltip';
import { REWARD_STATUS_DESCRIPTIONS } from '../lib/utils';
import { useTheme } from 'next-themes';

interface FloatingTotalsWidgetProps {
  totals: {
    totals: {
      fnode: { pending: number; claimable: number; claimed: number; accruing: number };
      tfry: { pending: number; claimable: number; claimed: number; accruing: number };
    };
    nextUnlockAt?: string;
    nextClaimableAt?: string | null;
    pendingWindowLabel?: string | null;
  } | null;
  countdown: string;
  claimCountdown: string;
  estimatedFnode: number;
  estimatedTfry: number;
  legacyFryClaimedSnapshot?: number;
}

const FloatingTotalsWidget: React.FC<FloatingTotalsWidgetProps> = ({
  totals,
  countdown,
  claimCountdown,
  estimatedFnode,
  estimatedTfry,
  legacyFryClaimedSnapshot
}) => {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme !== 'light';
  const ACCRUING_LABEL = 'Accruing (weekly preview)';
  const [isScrolled, setIsScrolled] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [scrollY, setScrollY] = useState(0);
  const [prices, setPrices] = useState<{ fry2?: number; fnode?: number }>({});
  const [isRibbonExpanded, setIsRibbonExpanded] = useState(false);
  const ribbonRef = useRef<HTMLDivElement | null>(null);
  const [collapseOffset, setCollapseOffset] = useState(650); // Threshold before switching to floating widget
  const legacySnapshot = legacyFryClaimedSnapshot ?? 0;
  const hasLegacySnapshot = legacySnapshot > 0;
  const totalPending = useMemo(
    () => (totals?.totals?.tfry?.pending ?? 0) + (totals?.totals?.fnode?.pending ?? 0),
    [totals?.totals?.fnode?.pending, totals?.totals?.tfry?.pending]
  );
  const pendingWindowLabel = totals?.pendingWindowLabel ?? null;

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
        const threshold = collapseOffset;
        const shouldShow = currentScrollY > threshold;
        
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
  }, [collapseOffset, isScrolled]);

  // Recalculate when the ribbon size changes (e.g., expanded view on small screens) so it stays visible longer.
  useEffect(() => {
    const recomputeThreshold = () => {
      const el = ribbonRef.current;
      if (!el) {
        setCollapseOffset((prev) => Math.max(prev, 700));
        return;
      }
      const rect = el.getBoundingClientRect();
      const scrollTop = window.scrollY || window.pageYOffset || 0;
      const bottom = rect.top + scrollTop + rect.height;
      // Add a small buffer so users can finish reading the expanded card before it collapses.
      setCollapseOffset(Math.max(650, bottom + 120));
    };

    recomputeThreshold();
    const onResize = () => recomputeThreshold();
    window.addEventListener('resize', onResize, { passive: true });
    return () => window.removeEventListener('resize', onResize);
  }, [totals, isRibbonExpanded]);

  // Auto-collapse expanded state when scrolling
  useEffect(() => {
    if (isScrolled && isExpanded && scrollY > 0) {
      const timer = setTimeout(() => setIsExpanded(false), 15000);
      return () => clearTimeout(timer);
    }
  }, [scrollY, isScrolled, isExpanded]);

  useEffect(() => {
    if (isScrolled) {
      setIsRibbonExpanded(false);
    }
  }, [isScrolled]);

  const normalizeCountdownLabel = useCallback((label: string) => {
    if (!label) return '--';
    const daysMatch = label.match(/(\d+)d/);
    if (daysMatch && parseInt(daysMatch[1]) === 0) {
      return label.replace(/^0d\s*/, '');
    }
    return label;
  }, []);

  // Countdown progress percentage (0-100)
  const countdownProgress = useMemo(() => {
    if (!countdown) return 0;
    // Extract days from countdown string (e.g., "5d 7h 29m 18s")
    const daysMatch = countdown.match(/(\d+)d/);
    const hoursMatch = countdown.match(/(\d+)h/);
    const days = daysMatch ? parseInt(daysMatch[1]) : 0;
    const hours = hoursMatch ? parseInt(hoursMatch[1]) : 0;
    
    // Calculate progress (assuming 7-day cycle)
    const totalHours = 7 * 24;
    const remainingHours = days * 24 + hours;
    const pct = ((totalHours - remainingHours) / totalHours) * 100;
    return Math.min(100, Math.max(0, pct));
  }, [countdown]);
  const nextUnlockLabel = useMemo(
    () => normalizeCountdownLabel(countdown),
    [countdown, normalizeCountdownLabel]
  );
  const nextClaimableLabel = useMemo(() => {
    if (totalPending <= 0) return 'No pending rewards in queue';
    if (!totals?.nextClaimableAt) return '--';
    return normalizeCountdownLabel(claimCountdown || '--');
  }, [claimCountdown, normalizeCountdownLabel, totalPending, totals?.nextClaimableAt]);

  const compactCountdownLabel = useMemo(() => {
    if (!countdown) return '--';
    const daysMatch = countdown.match(/(\d+)d/);
    const hoursMatch = countdown.match(/(\d+)h/);
    const minutesMatch = countdown.match(/(\d+)m/);

    const days = daysMatch ? parseInt(daysMatch[1]) : 0;
    const hours = hoursMatch ? parseInt(hoursMatch[1]) : 0;
    const minutes = minutesMatch ? parseInt(minutesMatch[1]) : 0;

    if (days > 0) {
      return `${days}d`;
    }

    if (hours > 0) {
      return `${hours}h`;
    }

    return `${minutes}m`;
  }, [countdown]);
  const compactClaimCountdownLabel = useMemo(() => {
    if (nextClaimableLabel === 'No pending rewards in queue') return 'No pending';
    if (nextClaimableLabel === '--') return '--';
    return nextClaimableLabel;
  }, [nextClaimableLabel]);

  // Animation variants
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

  // Fetch current prices (FRY 2.0 and fNode)
  useEffect(() => {
    let active = true;
    const run = async () => {
      try {
        const res = await fetch('/api/price/get', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ asset_ids: ['2485314946', '2485202024'] })
        });
        if (!res.ok) return;
        const json = await res.json();
        if (!active) return;
        setPrices({
          fry2: json?.prices?.['2485314946'] ?? 0,
          fnode: json?.prices?.['2485202024'] ?? 0
        });
      } catch {}
    };
    run();
    const id = setInterval(run, 300000);
    return () => { active = false; clearInterval(id); };
  }, []);

  const toggleRibbon = useCallback(() => {
    setIsRibbonExpanded((prev) => !prev);
  }, []);

  const collapsedAssets = useMemo(() => {
    if (!totals?.totals) {
      return [] as Array<{ key: string; name: string; claimable: string; pending: string }>;
    }
    return [
      {
        key: 'fnode',
        name: 'fNode',
        claimable: fmt(totals.totals.fnode.claimable),
        pending: fmt(totals.totals.fnode.pending)
      },
      {
        key: 'tfry',
        name: 'tFry',
        claimable: fmt(totals.totals.tfry?.claimable || 0),
        pending: fmt(totals.totals.tfry?.pending || 0)
      }
    ];
  }, [totals?.totals]);

  if (!totals?.totals) return null;

  return (
    <>
      {/* Full-width ribbon (initial state) - keep layout height while scrolled */}
      <div
        className="w-full transition-opacity duration-300"
        style={{
          opacity: isScrolled ? 0 : 1,
          visibility: isScrolled ? 'hidden' : 'visible',
          pointerEvents: isScrolled ? 'none' : 'auto'
        }}
        ref={ribbonRef}
      >
          <div className="mx-auto max-w-7xl px-2 sm:px-20 py-2">
            <div className={`rounded-2xl border p-4 shadow-lg ${isDark ? 'border-gray-800/70 bg-black/70 text-white shadow-black/40' : 'border-red-200 bg-white/95 text-slate-900 shadow-[0_10px_30px_rgba(0,0,0,0.12)]'}`}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className={`text-xs uppercase tracking-[0.25em] ${isDark ? 'text-gray-500' : 'text-slate-500'}`}>Weekly rewards</div>
                  <div className="mt-1 text-lg font-semibold">Totals overview</div>
                </div>
                <button
                  type="button"
                  onClick={toggleRibbon}
                  className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs uppercase tracking-wide transition-colors ${
                    isDark
                      ? 'border-gray-800 bg-black/60 text-gray-300 hover:border-red-500 hover:text-red-300'
                      : 'border-red-200 bg-white text-slate-800 hover:border-red-400 hover:text-red-700'
                  }`}
                >
                  {isRibbonExpanded ? 'Collapse' : 'Expand'}
                </button>
              </div>
              <AnimatePresence initial={false} mode="wait">
                {isRibbonExpanded ? (
                  <motion.div
                    key="ribbon-expanded"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.25 }}
                    className="mt-4 space-y-4"
                  >
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      <div className={`rounded-xl border p-3 ${isDark ? 'border-gray-800/70 bg-black/70' : 'border-red-200 bg-white'}`}>
                        <div className={`text-xs uppercase tracking-wide ${isDark ? 'text-gray-400' : 'text-slate-600'}`}>tFry Totals</div>
                        <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                          <div>
                            <div className={isDark ? 'text-gray-500' : 'text-slate-600'}>
                              <Tooltip text={REWARD_STATUS_DESCRIPTIONS.accruing}>
                                <span>{ACCRUING_LABEL}</span>
                              </Tooltip>
                            </div>
                            <div className="font-semibold tabular-nums">{fmt(totals.totals.tfry.accruing)}</div>
                          </div>
                          <div><div className={isDark ? 'text-gray-500' : 'text-slate-600'}>Pending</div><div className="font-semibold tabular-nums">{fmt(totals.totals.tfry.pending)}</div></div>
                          <div><div className={isDark ? 'text-gray-500' : 'text-slate-600'}>Claimable</div><div className={`font-semibold tabular-nums ${isDark ? 'text-green-300' : 'text-green-700'}`}>{fmt(totals.totals.tfry.claimable)}</div></div>
                          <div><div className={isDark ? 'text-gray-500' : 'text-slate-600'}>Claimed</div><div className="font-semibold tabular-nums">{fmt(totals.totals.tfry.claimed)}</div></div>
                        </div>
                        {hasLegacySnapshot && (
                          <div className="mt-4">
                            <div className={`rounded-2xl border px-4 py-3 text-sm shadow-inner ${isDark ? 'border-amber-400/70 bg-gradient-to-br from-amber-500/20 via-amber-400/10 to-transparent text-amber-100 shadow-amber-900/40' : 'border-amber-300 bg-gradient-to-br from-amber-100 via-amber-50 to-transparent text-amber-800 shadow-amber-200/60'}`}>
                              <div className={`text-xs uppercase tracking-[0.3em] ${isDark ? 'text-amber-200/80' : 'text-amber-700'}`}>Legacy FRY 1.0</div>
                              <div className={`mt-1 text-xl font-semibold tabular-nums ${isDark ? 'text-white' : 'text-amber-900'}`}>{fmt(legacySnapshot)} <span className={`text-sm font-normal ${isDark ? 'text-amber-200' : 'text-amber-700'}`}>claimed</span></div>
                              <p className={`mt-1 text-[0.7rem] ${isDark ? 'text-amber-100/80' : 'text-amber-700'}`}>Conversion to tFRY tool coming soon.</p>
                            </div>
                          </div>
                        )}
                      </div>
                      <div className={`rounded-xl border p-3 ${isDark ? 'border-gray-800/70 bg-black/70' : 'border-red-200 bg-white'}`}>
                        <div className={`text-xs uppercase tracking-wide ${isDark ? 'text-gray-400' : 'text-slate-600'}`}>fNode Totals</div>
                        <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                          <div>
                            <div className={isDark ? 'text-gray-500' : 'text-slate-600'}>
                              <Tooltip text={REWARD_STATUS_DESCRIPTIONS.accruing}>
                                <span>{ACCRUING_LABEL}</span>
                              </Tooltip>
                            </div>
                            <div className="font-semibold tabular-nums">{fmt(totals.totals.fnode.accruing)}</div>
                          </div>
                          <div><div className={isDark ? 'text-gray-500' : 'text-slate-600'}>Pending</div><div className="font-semibold tabular-nums">{fmt(totals.totals.fnode.pending)}</div></div>
                          <div><div className={isDark ? 'text-gray-500' : 'text-slate-600'}>Claimable</div><div className={`font-semibold tabular-nums ${isDark ? 'text-green-300' : 'text-green-700'}`}>{fmt(totals.totals.fnode.claimable)}</div></div>
                          <div><div className={isDark ? 'text-gray-500' : 'text-slate-600'}>Claimed</div><div className="font-semibold tabular-nums">{fmt(totals.totals.fnode.claimed)}</div></div>
                        </div>
                      </div>
                      <div className={`rounded-xl border p-3 ${isDark ? 'border-gray-800/70 bg-black/70' : 'border-red-200 bg-white'}`}>
                        <div className={`text-xs uppercase tracking-wide ${isDark ? 'text-gray-400' : 'text-slate-600'}`}>Next unlock & maturity</div>
                        <div className="mt-3 flex flex-wrap items-center gap-4 sm:gap-6">
                          <div className="flex flex-col items-start">
                            <div className="text-2xl font-semibold tabular-nums">{nextUnlockLabel}</div>
                            <div className={`text-[11px] uppercase tracking-[0.15em] ${isDark ? 'text-gray-500' : 'text-slate-600'}`}>Unlock</div>
                          </div>
                          <div className={`h-10 w-px ${isDark ? 'bg-gray-800' : 'bg-red-100'}`} aria-hidden />
                          <div className="flex flex-col items-start">
                            <div className="text-2xl font-semibold tabular-nums">{nextClaimableLabel}</div>
                            <div className={`text-[11px] uppercase tracking-[0.15em] ${isDark ? 'text-gray-500' : 'text-slate-600'}`}>Pending → Claimable</div>
                            <div className={`text-[11px] ${isDark ? 'text-green-200/80' : 'text-green-700'}`}>
                              {pendingWindowLabel ? `Period ${pendingWindowLabel}` : 'Period —'}
                            </div>
                          </div>
                        </div>
                        <div className={`mt-3 space-y-1 text-xs ${isDark ? 'text-gray-300' : 'text-slate-700'}`}>
                          <div><span className={isDark ? 'text-gray-500' : 'text-slate-600'}>Projected tFry:</span> <span className="font-semibold">{fmt(estimatedTfry)}</span></div>
                          <div><span className={isDark ? 'text-gray-500' : 'text-slate-600'}>Projected fNode:</span> <span className="font-semibold">{fmt(estimatedFnode)}</span></div>
                        </div>
                      </div>
                    </div>
                    <div className={`rounded-lg border px-3 py-2 text-xs leading-relaxed ${isDark ? 'border-gray-800/70 bg-black/60 text-gray-300' : 'border-red-200 bg-white text-slate-700'}`}>
                      Rewards accrue daily and unlock as a single weekly reward every Friday at 00:05 UTC. Unlocked rewards sit in Pending for 30 days before becoming Claimable. The unlock timer tracks the Friday cutover; the maturity timer tracks when the oldest pending batch will become claimable.
                    </div>
                  </motion.div>
                ) : (
                  <motion.div
                    key="ribbon-collapsed"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.25 }}
                    className={`mt-3 space-y-3 text-xs ${isDark ? 'text-gray-300' : 'text-slate-700'}`}
                  >
                    <div className="flex flex-wrap gap-2">
                      {collapsedAssets.map((asset) => (
                        <span
                          key={asset.key}
                          className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 font-semibold ${isDark ? 'border-gray-800/70 bg-black/70 text-gray-100' : 'border-red-200 bg-white text-slate-800'}`}
                        >
                          <span className={`text-[0.65rem] uppercase tracking-[0.2em] ${isDark ? 'text-gray-500' : 'text-slate-600'}`}>{asset.name}</span>
                          <span className={isDark ? 'text-white' : 'text-slate-900'}>{asset.claimable}</span>
                          <span className={isDark ? 'text-gray-400' : 'text-slate-600'}>claimable</span>
                          <span className={isDark ? 'text-gray-600' : 'text-slate-500'}>/ {asset.pending} pending</span>
                        </span>
                      ))}
                    </div>
                    <div className={`flex flex-wrap items-center gap-3 text-[0.7rem] ${isDark ? 'text-gray-500' : 'text-slate-600'}`}>
                      <span className="flex items-center gap-1">
                        <span className={`font-semibold ${isDark ? 'text-white' : 'text-slate-900'}`}>{nextUnlockLabel || '--'}</span>
                        <span className={isDark ? 'text-gray-500' : 'text-slate-600'}>Unlock</span>
                      </span>
                      <span aria-hidden className={isDark ? 'text-gray-700' : 'text-slate-300'}>|</span>
                      <span className="flex items-center gap-1">
                        <span className={`font-semibold ${isDark ? 'text-white' : 'text-slate-900'}`}>{nextClaimableLabel}</span>
                        <span className={isDark ? 'text-gray-500' : 'text-slate-600'}>Pending → Claimable</span>
                      </span>
                      {pendingWindowLabel && (
                        <span className={isDark ? 'text-green-200/80' : 'text-green-700'}>
                          {pendingWindowLabel}
                        </span>
                      )}
                      <span className={`hidden sm:inline ${isDark ? 'text-gray-600' : 'text-slate-500'}`}>Expand for the full breakdown and estimates</span>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>

      {/* Floating compact widget */}
      <AnimatePresence>
        {isScrolled && (
          <motion.div
            className="fixed right-3 top-24 z-50 cursor-pointer sm:right-4 sm:top-28"
            initial={{ opacity: 0, scale: 0.8, x: 100 }}
            animate={{ opacity: 1, scale: 1, x: 0 }}
            exit={{ opacity: 0, scale: 0.8, x: 100 }}
            transition={{ duration: 0.5, ease: 'easeInOut' }}
            onClick={() => setIsExpanded(!isExpanded)}
          >
            <motion.div
              className="backdrop-blur-md"
              animate={isExpanded ? 'expanded' : 'compact'}
              variants={{
                compact: {
                  width: '58px',
                  height: '58px',
                  borderRadius: '9999px',
                  padding: '6px',
                  background: isDark
                    ? 'radial-gradient(circle at 30% 30%, rgba(255,255,255,0.08), rgba(23,4,10,0.95))'
                    : 'radial-gradient(circle at 30% 30%, rgba(255,255,255,0.65), rgba(227,231,237,0.95))',
                  border: isDark ? '1px solid rgba(239,68,68,0.35)' : '1px solid rgba(239,68,68,0.25)',
                  boxShadow: isDark ? '0 10px 25px rgba(239,68,68,0.18)' : '0 10px 25px rgba(0,0,0,0.08)'
                },
                expanded: {
                  width:
                    (typeof window !== 'undefined' && window.innerWidth <= 768)
                      ? '300px'
                      : '360px',
                  height: 'auto',
                  borderRadius: '1rem',
                  padding: '20px',
                  background: isDark
                    ? 'linear-gradient(135deg, rgba(23,4,10,0.95), rgba(34,6,15,0.95))'
                    : 'linear-gradient(135deg, rgba(255,255,255,0.98), rgba(230,234,240,0.98))',
                  border: isDark ? '1px solid rgba(239,68,68,0.35)' : '1px solid rgba(239,68,68,0.25)',
                  boxShadow: isDark ? '0 18px 45px rgba(239,68,68,0.22)' : '0 18px 45px rgba(0,0,0,0.12)'
                }
              }}
              transition={{ duration: 0.3 }}
            >
              {!isExpanded && (
                <motion.div
                  key="compact"
                  className={`relative flex h-full items-center justify-center ${isDark ? 'text-white' : 'text-slate-900'}`}
                  initial={{ opacity: 0, scale: 0.92 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.92 }}
                >
                  <svg className="h-12 w-12 -rotate-90" viewBox="0 0 36 36">
                    <path
                      d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                      fill="none"
                      stroke="rgba(255,255,255,0.08)"
                      strokeWidth="3"
                    />
                    <path
                      d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                      fill="none"
                      stroke="url(#countdown-gradient)"
                      strokeLinecap="round"
                      strokeWidth="3"
                      strokeDasharray={`${Math.max(1, Math.min(99, countdownProgress || 0))}, 100`}
                    />
                    <defs>
                      <linearGradient id="countdown-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stopColor="#f87171" />
                        <stop offset="100%" stopColor="#f43f5e" />
                      </linearGradient>
                    </defs>
                  </svg>
                  <span className={`absolute text-sm font-semibold ${isDark ? 'text-white' : 'text-slate-900'}`}>
                    {compactCountdownLabel}
                  </span>
                </motion.div>
              )}

              {/* Expanded Content */}
              <motion.div
              className={`${isExpanded ? 'block' : 'hidden'} ${isDark ? 'text-white' : 'text-slate-900'}`}
                initial={{ opacity: 0 }}
                animate={{ opacity: isExpanded ? 1 : 0 }}
                transition={{ duration: 0.3 }}
              >
                <div className="flex justify-between items-center mb-3">
                  <h3 className={`text-sm font-semibold ${isDark ? 'text-red-400' : 'text-red-700'}`}>Rewards Summary</h3>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setIsExpanded(false);
                    }}
                    className={isDark ? 'text-gray-400 hover:text-white' : 'text-slate-500 hover:text-slate-900'}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                {/* Prices */}
                <div className={`text-xs mb-3 text-center space-y-1 ${isDark ? 'text-gray-300' : 'text-slate-700'}`}>
                  <div>
                    FRY 2.0 (2485314946): {fmtUSD(prices.fry2)} • fNode (2485202024): {fmtUSD(prices.fnode)}
                  </div>
                  <div className={`text-[0.6rem] ${isDark ? 'text-amber-200/90' : 'text-amber-700'}`}>
                    tFry (2681521901) is earned-only, not tradeable. Each tFry converts 1:1 into its product&rsquo;s token once that monetization tier goes live.
                  </div>
                </div>
                {/* Expanded Totals */}
                <div className="space-y-3 text-xs">
                  <div>
                    <div className={`mb-1 ${isDark ? 'text-gray-400' : 'text-slate-600'}`}>tFry Totals (2681521901)</div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="flex justify-between">
                        <span className={isDark ? 'text-gray-500' : 'text-slate-600'} title={REWARD_STATUS_DESCRIPTIONS.accruing}>{ACCRUING_LABEL}:</span>
                        <span className="font-semibold">{fmt(totals.totals.tfry.accruing)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className={isDark ? 'text-gray-500' : 'text-slate-600'}>Pending:</span>
                        <span className="font-semibold">{fmt(totals.totals.tfry.pending)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className={isDark ? 'text-gray-500' : 'text-slate-600'}>Claimable:</span>
                        <span className={`font-semibold ${isDark ? 'text-green-400' : 'text-green-700'}`}>{fmt(totals.totals.tfry.claimable)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className={isDark ? 'text-gray-500' : 'text-slate-600'}>Claimed:</span>
                        <span className="font-semibold">{fmt(totals.totals.tfry.claimed)}</span>
                      </div>
                    </div>
                    {hasLegacySnapshot && (
                      <div className={`mt-3 rounded-xl border px-3 py-2 text-[0.7rem] ${isDark ? 'border-amber-400/50 bg-gradient-to-r from-amber-600/20 via-amber-400/10 to-transparent text-amber-100' : 'border-amber-300 bg-gradient-to-r from-amber-100 via-amber-50 to-transparent text-amber-800'}`}>
                        <div className={`font-semibold ${isDark ? 'text-white' : 'text-amber-900'}`}>{fmt(legacySnapshot)} FRY 1.0 claimed</div>
                        <div className={isDark ? 'text-amber-200/80' : 'text-amber-700'}>Conversion to tFry tool coming soon.</div>
                      </div>
                    )}
                  </div>

                  <div>
                    <div className={`mb-1 ${isDark ? 'text-gray-400' : 'text-slate-600'}`}>fNode Totals (2485202024)</div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="flex justify-between">
                        <span className={isDark ? 'text-gray-500' : 'text-slate-600'} title={REWARD_STATUS_DESCRIPTIONS.accruing}>{ACCRUING_LABEL}:</span>
                        <span className="font-semibold">{fmt(totals.totals.fnode.accruing)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className={isDark ? 'text-gray-500' : 'text-slate-600'}>Pending:</span>
                        <span className="font-semibold">{fmt(totals.totals.fnode.pending)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className={isDark ? 'text-gray-500' : 'text-slate-600'}>Claimable:</span>
                        <span className={`font-semibold ${isDark ? 'text-green-400' : 'text-green-700'}`}>{fmt(totals.totals.fnode.claimable)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className={isDark ? 'text-gray-500' : 'text-slate-600'}>Claimed:</span>
                        <span className="font-semibold">{fmt(totals.totals.fnode.claimed)}</span>
                      </div>
                    </div>
                  </div>

                  {/* Countdown */}
                  <div className={`border-t pt-2 ${isDark ? 'border-gray-600' : 'border-red-200'}`}>
                    <div className={`mb-1 ${isDark ? 'text-gray-400' : 'text-slate-600'}`}>Next FRYday</div>
                    <div className="flex items-center gap-2">
                      <div className="flex flex-col items-start">
                        <div className={`text-lg font-semibold ${isDark ? 'text-red-400' : 'text-red-700'}`}>{nextUnlockLabel}</div>
                        <div className={`text-[11px] uppercase tracking-[0.15em] ${isDark ? 'text-gray-500' : 'text-slate-600'}`}>Unlock</div>
                      </div>
                      <div className={`h-10 w-px ${isDark ? 'bg-gray-700' : 'bg-red-100'}`} aria-hidden />
                      <div className="flex flex-col items-start">
                        <div className={`text-lg font-semibold ${isDark ? 'text-green-300' : 'text-green-700'}`}>{compactClaimCountdownLabel}</div>
                        <div className={`text-[11px] uppercase tracking-[0.15em] ${isDark ? 'text-gray-500' : 'text-slate-600'}`}>Pending → Claimable</div>
                        <div className={`text-[11px] ${isDark ? 'text-green-200/80' : 'text-green-700'}`}>{pendingWindowLabel ? pendingWindowLabel : 'Period —'}</div>
                      </div>
                    </div>
                    <div className={`text-xs mt-2 ${isDark ? 'text-gray-500' : 'text-slate-700'}`}>
                      Est. weekly: {fmt(estimatedTfry)} tFry, {fmt(estimatedFnode)} fNode
                    </div>
                    <div className={`mt-2 text-[0.65rem] leading-relaxed ${isDark ? 'text-gray-500' : 'text-slate-700'}`}>
                      Rewards accrue daily and unlock as a single weekly reward every Friday at 00:05 UTC. Unlock shows when accrual shifts to Pending; the maturity timer shows when that pending batch turns Claimable.
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
