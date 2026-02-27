import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTheme } from 'next-themes';
// Shared breakdown category keys keep explorer stats aligned with backend grouping.
import type { OtherBreakdownCategory } from '../../lib/minerKeyCategories';

export type ExplorerGlobalStats = {
  totalRegistered: number;
  nodes: number;
  aem: number;
  bm: number;
  other: number;
  breakdown: Record<OtherBreakdownCategory, number>;
  online: number | null;
  offline: number | null;
  onlineReady: boolean;
};

interface ExplorerStatsProps {
  stats: ExplorerGlobalStats | null;
  loading: boolean;
  onCollapse?: () => void;
}

const formatCompact = (value: number) =>
  new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
const formatNumber = (value: number) => new Intl.NumberFormat('en-US').format(value);

export default function ExplorerStats({ stats, loading, onCollapse }: ExplorerStatsProps) {
  const { resolvedTheme } = useTheme();
  // Keep the stats panel readable over the map regardless of theme.
  const isDark = resolvedTheme !== 'light';
  const isReady = Boolean(stats) && !loading;
  // Track the "Other" popover anchor so clicks outside can dismiss it.
  const otherPopoverRef = useRef<HTMLDivElement | null>(null);
  const [otherPopoverOpen, setOtherPopoverOpen] = useState(false);

  const breakdownItems = useMemo(
    () => [
      { key: 'camera', label: 'Cameras' },
      { key: 'weather', label: 'Weather' },
      { key: 'water', label: 'Water' },
      { key: 'air', label: 'Air' },
      { key: 'radiation', label: 'Radiation' },
      { key: 'energy', label: 'Energy' },
      // Flag hardware with asterisk so users know it excludes nodes/AEM/BM.
      { key: 'hardware', label: 'Hardware*' },
      { key: 'unknown', label: 'Unknown' }
    ] as const,
    []
  );
  const sortedBreakdownItems = useMemo(() => {
    // Sort by live counts so the "Other" grid always descends by size.
    return [...breakdownItems].sort((a, b) => {
      const aValue = stats?.breakdown?.[a.key] ?? 0;
      const bValue = stats?.breakdown?.[b.key] ?? 0;
      if (bValue !== aValue) {
        return bValue - aValue;
      }
      return a.label.localeCompare(b.label);
    });
  }, [breakdownItems, stats]);

  const handleOtherToggle = useCallback(() => {
    // Toggle the "Other" breakdown popover on tap/click.
    setOtherPopoverOpen((prev) => !prev);
  }, []);

  const handleOtherOpen = useCallback(() => {
    // Open the popover on hover for desktop users.
    setOtherPopoverOpen(true);
  }, []);

  const handleOtherClose = useCallback(() => {
    // Close the popover when the pointer leaves the icon area.
    setOtherPopoverOpen(false);
  }, []);

  useEffect(() => {
    if (!otherPopoverOpen) return;
    const handleOutside = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (!target || !otherPopoverRef.current) return;
      if (!otherPopoverRef.current.contains(target)) {
        setOtherPopoverOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('touchstart', handleOutside);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('touchstart', handleOutside);
    };
  }, [otherPopoverOpen]);

  return (
    <div
      className={`pointer-events-auto w-full max-w-sm rounded-[28px] border px-5 py-6 shadow-2xl backdrop-blur ${
        isDark
          ? 'border-white/10 bg-slate-950/80 text-slate-100'
          : 'border-slate-200 bg-white/85 text-slate-900'
      }`}
    >
      {/* Title block mirrors the "World" panel from the reference UI. */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-2xl font-semibold tracking-tight">World</div>
          <div className={`mt-1 text-sm ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>
            Global Fry device coverage with hex-only privacy.
          </div>
        </div>
        {/* Optional collapse control keeps the panel out of the way when needed. */}
        {onCollapse && (
          <button
            type="button"
            onClick={onCollapse}
            className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
              isDark
                ? 'border-white/10 bg-white/10 text-slate-200 hover:bg-white/20'
                : 'border-slate-200 bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
            aria-label="Collapse stats panel"
          >
            Hide
          </button>
        )}
      </div>

      <div className={`mt-4 rounded-2xl border px-4 py-3 ${isDark ? 'border-white/10 bg-white/5' : 'border-slate-200 bg-slate-50'}`}>
        <div className="text-xs uppercase tracking-wide text-slate-400">Total registered</div>
        <div className="mt-1 text-2xl font-semibold">
          {isReady ? formatNumber(stats!.totalRegistered) : 'Loading...'}
        </div>
      </div>

      {/* Break out primary device categories without overloading the panel. */}
      <div className="mt-4 grid grid-cols-2 gap-3">
        {[
          { label: 'Nodes', value: stats?.nodes ?? 0 },
          { label: 'AEM', value: stats?.aem ?? 0 },
          { label: 'BM', value: stats?.bm ?? 0 }
        ].map((item) => (
          <div
            key={item.label}
            className={`rounded-2xl border px-3 py-3 ${isDark ? 'border-white/10 bg-white/5' : 'border-slate-200 bg-slate-50'}`}
          >
            <div className="text-xs uppercase tracking-wide text-slate-400">{item.label}</div>
            <div className="mt-1 text-lg font-semibold">
              {isReady ? formatCompact(item.value) : '...'}
            </div>
          </div>
        ))}
        <div
          className={`relative rounded-2xl border px-3 py-3 ${
            isDark
              ? 'border-white/10 bg-white/5'
              : 'border-slate-200 bg-slate-50'
          }`}
        >
          {/* Keep the "Other" card passive; the icon triggers the breakdown popover. */}
          <div className="text-xs uppercase tracking-wide text-slate-400">Other</div>
          <div className="mt-1 flex items-center justify-between gap-2 text-lg font-semibold">
            <span>{isReady ? formatCompact(stats?.other ?? 0) : '...'}</span>
            <div
              ref={otherPopoverRef}
              onMouseEnter={handleOtherOpen}
              onMouseLeave={handleOtherClose}
              className="relative"
            >
              <button
                type="button"
                onClick={handleOtherToggle}
                className={`flex h-6 w-6 items-center justify-center rounded-full border text-[10px] font-semibold ${
                  isDark
                    ? 'border-white/20 text-slate-200 hover:bg-white/10'
                    : 'border-slate-300 text-slate-700 hover:bg-slate-200'
                }`}
                aria-label="Show other device types"
              >
                i
              </button>
              {otherPopoverOpen && (
                <div
                  className={`absolute bottom-8 right-0 z-30 w-56 rounded-2xl border px-3 py-3 text-sm shadow-2xl backdrop-blur ${
                    isDark
                      ? 'border-white/10 bg-slate-950/95 text-slate-100'
                      : 'border-slate-200 bg-white/95 text-slate-900'
                  }`}
                >
                  {/* Compact popover for the "Other" device breakdown. */}
                  <div className={`text-[10px] uppercase tracking-wide ${isDark ? 'text-slate-300' : 'text-slate-500'}`}>
                    Other device types
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                    {sortedBreakdownItems.map((item) => (
                      <div
                        key={item.key}
                        className={`rounded-xl border px-2 py-2 ${
                          isDark
                            ? 'border-white/10 bg-white/5'
                            : 'border-slate-200 bg-slate-50'
                        }`}
                      >
                        <div className="text-[10px] uppercase tracking-wide text-slate-400">{item.label}</div>
                        <div className="mt-1 text-sm font-semibold">
                          {isReady ? formatCompact(stats?.breakdown?.[item.key] ?? 0) : '...'}
                        </div>
                        {/* Clarify which prefixes are included in the hardware bucket. */}
                        {item.key === 'hardware' && (
                          <div className={`mt-1 text-[9px] ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>
                            ISM/OSM/IDM/ODM
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Online/offline stats are placeholders until telemetry lands. */}
      <div className={`mt-4 rounded-2xl border px-4 py-3 ${isDark ? 'border-white/10 bg-white/5' : 'border-slate-200 bg-slate-50'}`}>
        <div className="flex items-center justify-between">
          <div className="text-xs uppercase tracking-wide text-slate-400">Online status</div>
          <div className={`text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
            {stats?.onlineReady ? 'Live' : 'Pending'}
          </div>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-3 text-sm">
          <div>
            <div className="text-xs uppercase tracking-wide text-slate-400">Online</div>
            <div className="mt-1 font-semibold">
              {stats?.onlineReady && stats?.online != null ? formatNumber(stats.online) : 'TBD'}
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-slate-400">Offline</div>
            <div className="mt-1 font-semibold">
              {stats?.onlineReady && stats?.offline != null ? formatNumber(stats.offline) : 'TBD'}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
