import { useTheme } from 'next-themes';
import { EXPLORER_STATUS_COLORS } from './mapLayers';

interface ExplorerLegendProps {
  tilesReady: boolean;
  // Allow a smaller footprint when the legend is docked at the bottom.
  compact?: boolean;
  onCollapse?: () => void;
}

export default function ExplorerLegend({ tilesReady, compact = false, onCollapse }: ExplorerLegendProps) {
  const { resolvedTheme } = useTheme();
  // Respect the current theme so the legend matches the dashboard chrome.
  const isDark = resolvedTheme !== 'light';
  // Shrink padding and text when the legend is docked to save map real estate.
  const containerSize = compact ? 'max-w-[230px] p-3 text-xs' : 'max-w-xs p-4 text-sm';
  const dotSize = compact ? 'h-2.5 w-2.5' : 'h-3 w-3';
  // Match sample sizes to the compact legend mode.
  const lineSampleSize = compact ? 'h-0.5 w-5' : 'h-0.5 w-6';
  // Use a blue-to-orange gradient chip to hint at global density colors.
  const densitySwatchStyle = {
    background: isDark
      ? 'linear-gradient(90deg, #1e40af, #0ea5e9, #f59e0b, #f97316)'
      : 'linear-gradient(90deg, #bfdbfe, #67e8f9, #fbbf24, #fb923c)'
  };
  const rowGap = compact ? 'space-y-1.5' : 'space-y-2';

  return (
    <div
      className={`pointer-events-auto w-full ${containerSize} rounded-2xl border shadow-xl backdrop-blur ${
        isDark
          ? 'border-white/10 bg-black/60 text-slate-100'
          : 'border-slate-200 bg-white/80 text-slate-900'
      }`}
    >
      {/* Inline legend keeps the map UI self-explanatory. */}
      {/* Use theme-aware subtext colors for legibility on both themes. */}
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className={`text-xs uppercase tracking-wide ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>
          Explorer legend
        </div>
        {/* Optional collapse control to dock the legend as an icon. */}
        {onCollapse && (
          <button
            type="button"
            onClick={onCollapse}
            className={`rounded-full border px-2 py-1 text-[10px] font-semibold transition ${
              isDark
                ? 'border-white/10 bg-white/10 text-slate-200 hover:bg-white/20'
                : 'border-slate-200 bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
            aria-label="Collapse legend"
          >
            Hide
          </button>
        )}
      </div>
      <div className={rowGap}>
        {/* Global coverage legend focuses on the multi-resolution tiles. */}
        <div className={`text-[10px] uppercase tracking-wide ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>
          Global coverage
        </div>
        <div className="flex items-center gap-2">
          <span className={`${dotSize} rounded-full`} style={densitySwatchStyle} />
          <span>Device density (blue to orange)</span>
        </div>
        <div className="flex items-center gap-2">
          <span className={`${lineSampleSize} rounded-full`} style={{ backgroundColor: isDark ? '#22c55e' : '#16a34a' }} />
          <span>Online telemetry present</span>
        </div>
        <div className="flex items-center gap-2">
          <span className={`${lineSampleSize} rounded-full`} style={{ backgroundColor: isDark ? '#ef4444' : '#dc2626' }} />
          <span>Offline telemetry present</span>
        </div>
        <div className="flex items-center gap-2">
          <span className={`${lineSampleSize} rounded-full`} style={{ backgroundColor: isDark ? '#e2e8f0' : '#0f172a' }} />
          <span>No telemetry yet</span>
        </div>
        {/* Wallet overlays use the registered/unregistered/offline colors. */}
        <div className={`pt-2 text-[10px] uppercase tracking-wide ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>
          Your devices
        </div>
        <div className="flex items-center gap-2">
          <span className={`${dotSize} rounded-full`} style={{ backgroundColor: EXPLORER_STATUS_COLORS.registered }} />
          <span>Registered device hex</span>
        </div>
        <div className="flex items-center gap-2">
          <span className={`${dotSize} rounded-full`} style={{ backgroundColor: EXPLORER_STATUS_COLORS.unregistered }} />
          <span>Unregistered device hex</span>
        </div>
        <div className="flex items-center gap-2">
          <span className={`${dotSize} rounded-full`} style={{ backgroundColor: EXPLORER_STATUS_COLORS.offline }} />
          {/* Offline only shows when PoC telemetry is available for a device. */}
          <span>Offline device hex (telemetry)</span>
        </div>
      </div>
      <div className={`mt-3 text-xs ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>
        {/* Privacy callout to reinforce the hex-only policy. */}
        Hexes only: exact locations are never shown.
      </div>
      {!tilesReady && (
        <div className="mt-3 rounded-lg border border-amber-400/40 bg-amber-400/10 px-2 py-2 text-xs text-amber-200">
          {/* Surface missing tile config so QA can catch it quickly. */}
          Global coverage tiles are not configured (set NEXT_PUBLIC_TILES_URL).
        </div>
      )}
    </div>
  );
}
