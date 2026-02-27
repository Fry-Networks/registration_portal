import dynamic from 'next/dynamic';
import { useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { secureFetch } from '../lib/api/secureFetch';
import { fetchWithFingerprintRetry } from '../lib/api/fetchWithFingerprintRetry';
import { refreshClientToken } from '../lib/clientToken';
import { useFingerprintReady } from '../app/fingerprintcontext';
import { useToastContext } from '../hooks/ToastContext';
import ExplorerLegend from '../components/explorer/ExplorerLegend';
import ExplorerStats, { type ExplorerGlobalStats } from '../components/explorer/ExplorerStats';
// ExplorerPanel exports typed summaries for selected-hex and wallet device lists.
import ExplorerPanel, { type ExplorerDevice, type ExplorerWalletDevice } from '../components/explorer/ExplorerPanel';
import type { WalletHexSummary } from '../components/explorer/mapLayers';

// ExplorerMap depends on browser-only Mapbox GL, so we disable SSR.
const ExplorerMap = dynamic(() => import('../components/explorer/ExplorerMap'), { ssr: false });

const EMPTY_HEXES: WalletHexSummary[] = [];
const EMPTY_DEVICES: ExplorerDevice[] = [];
const EMPTY_WALLET_DEVICES: ExplorerWalletDevice[] = [];
const EMPTY_GLOBAL_STATS: ExplorerGlobalStats | null = null;

export default function ExplorerPage() {
  const { status } = useSession();
  const { refresh: refreshFingerprint } = useFingerprintReady();
  const toast = useToastContext();

  const [walletHexes, setWalletHexes] = useState<WalletHexSummary[]>(EMPTY_HEXES);
  const [hexLoading, setHexLoading] = useState(false);
  const [selectedHex, setSelectedHex] = useState<string | null>(null);
  const [hexDevices, setHexDevices] = useState<ExplorerDevice[]>(EMPTY_DEVICES);
  const [devicesLoading, setDevicesLoading] = useState(false);
  // Cache the wallet device list so users can jump to any hex quickly.
  const [walletDevices, setWalletDevices] = useState<ExplorerWalletDevice[]>(EMPTY_WALLET_DEVICES);
  const [walletDevicesLoading, setWalletDevicesLoading] = useState(false);
  const [focusHexId, setFocusHexId] = useState<string | null>(null);
  // Global stats for the explorer hero panel.
  const [globalStats, setGlobalStats] = useState<ExplorerGlobalStats | null>(EMPTY_GLOBAL_STATS);
  const [globalStatsLoading, setGlobalStatsLoading] = useState(false);
  // Collapse toggles for the stats and legend panels.
  const [statsCollapsed, setStatsCollapsed] = useState(false);
  // Hide the legend by default so the stats panel is the first focus.
  const [legendCollapsed, setLegendCollapsed] = useState(true);
  // Collapse toggle for the selected-hex panel (bottom sheet).
  // Start with the selected-hex panel hidden until the user opens it.
  const [selectedPanelCollapsed, setSelectedPanelCollapsed] = useState(true);
  // Show the unified collapsed-icon dock whenever any panel is hidden.
  const collapsedDockVisible = statsCollapsed || legendCollapsed || selectedPanelCollapsed;
  // Dock right-side panels under the collapsed icon stack when it is visible.
  const dockedRightTopClass = collapsedDockVisible ? 'top-16' : 'top-4';

  const tilesUrl = useMemo(() => {
    // Normalize the base URL so tile paths don't double up slashes or keep stray quotes.
    const raw = process.env.NEXT_PUBLIC_TILES_URL;
    if (!raw) return null;
    const trimmed = raw.trim().replace(/^['"]+|['"]+$/g, '');
    return trimmed ? trimmed.replace(/\/+$/, '') : null;
  }, []);
  const tilesReady = Boolean(tilesUrl);

  useEffect(() => {
    // Load the global explorer stats that drive the left-side panel.
    if (status !== 'authenticated') return;

    let cancelled = false;
    const loadHexes = async () => {
      setHexLoading(true);
      const response = await fetchWithFingerprintRetry(
        () => secureFetch('/api/map/my-hexes', {}, { method: 'POST' }),
        refreshFingerprint,
        { refreshClientToken: async () => {
          await refreshClientToken();
          return true;
        } }
      );

      if (cancelled) return;

      if (!response.ok) {
        const errorPayload = await response.json().catch(() => null);
        toast.error({
          heading: 'Explorer unavailable',
          message: errorPayload?.message || 'Unable to load your device map data.'
        });
        setWalletHexes(EMPTY_HEXES);
        setHexLoading(false);
        return;
      }

      const data = await response.json().catch(() => null);
      setWalletHexes(Array.isArray(data?.hexes) ? data.hexes : EMPTY_HEXES);
      setHexLoading(false);
    };

    void loadHexes();
    return () => {
      cancelled = true;
    };
  }, [refreshFingerprint, status, toast]);

  useEffect(() => {
    // Load the wallet device list for the quick-jump panel.
    if (status !== 'authenticated') return;

    let cancelled = false;
    const loadWalletDevices = async () => {
      setWalletDevicesLoading(true);
      const response = await fetchWithFingerprintRetry(
        () => secureFetch('/api/map/my-devices', {}, { method: 'POST' }),
        refreshFingerprint,
        { refreshClientToken: async () => {
          await refreshClientToken();
          return true;
        } }
      );

      if (cancelled) return;

      if (!response.ok) {
        const errorPayload = await response.json().catch(() => null);
        toast.error({
          heading: 'Explorer unavailable',
          message: errorPayload?.message || 'Unable to load your device list.'
        });
        setWalletDevices(EMPTY_WALLET_DEVICES);
        setWalletDevicesLoading(false);
        return;
      }

      const data = await response.json().catch(() => null);
      setWalletDevices(Array.isArray(data?.devices) ? data.devices : EMPTY_WALLET_DEVICES);
      setWalletDevicesLoading(false);
    };

    void loadWalletDevices();
    return () => {
      cancelled = true;
    };
  }, [refreshFingerprint, status, toast]);

  useEffect(() => {
    if (status !== 'authenticated') return;

    let cancelled = false;
    const loadGlobalStats = async () => {
      setGlobalStatsLoading(true);
      const response = await fetchWithFingerprintRetry(
        () => secureFetch('/api/map/stats', {}, { method: 'POST' }),
        refreshFingerprint,
        { refreshClientToken: async () => {
          await refreshClientToken();
          return true;
        } }
      );

      if (cancelled) return;

      if (!response.ok) {
        const errorPayload = await response.json().catch(() => null);
        toast.error({
          heading: 'Explorer unavailable',
          message: errorPayload?.message || 'Unable to load global explorer stats.'
        });
        setGlobalStats(EMPTY_GLOBAL_STATS);
        setGlobalStatsLoading(false);
        return;
      }

      const data = await response.json().catch(() => null);
      setGlobalStats(data?.stats ?? EMPTY_GLOBAL_STATS);
      setGlobalStatsLoading(false);
    };

    void loadGlobalStats();
    return () => {
      cancelled = true;
    };
  }, [refreshFingerprint, status, toast]);

  useEffect(() => {
    if (status !== 'authenticated') return;
    if (!selectedHex) {
      setHexDevices(EMPTY_DEVICES);
      return;
    }

    let cancelled = false;
    const loadHexDevices = async () => {
      setDevicesLoading(true);
      const response = await fetchWithFingerprintRetry(
        () => secureFetch('/api/map/hex-details', { hexId: selectedHex }, { method: 'POST' }),
        refreshFingerprint,
        { refreshClientToken: async () => {
          await refreshClientToken();
          return true;
        } }
      );

      if (cancelled) return;

      if (!response.ok) {
        const errorPayload = await response.json().catch(() => null);
        toast.error({
          heading: 'Hex details unavailable',
          message: errorPayload?.message || 'Unable to load devices in this hex.'
        });
        setHexDevices(EMPTY_DEVICES);
        setDevicesLoading(false);
        return;
      }

      const data = await response.json().catch(() => null);
      setHexDevices(Array.isArray(data?.devices) ? data.devices : EMPTY_DEVICES);
      setDevicesLoading(false);
    };

    void loadHexDevices();
    return () => {
      cancelled = true;
    };
  }, [refreshFingerprint, selectedHex, status, toast]);

  if (status === 'loading') {
    return (
      <div className="flex min-h-[calc(100vh-var(--navbar-height,64px))] w-full items-center justify-center px-4">
        {/* Avoid flashing unauthenticated copy while NextAuth resolves. */}
        <div className="rounded-full border border-white/10 bg-black/60 px-4 py-2 text-xs text-slate-200 shadow-lg backdrop-blur">
          Loading explorer...
        </div>
      </div>
    );
  }

  if (status !== 'authenticated') {
    return (
      <div className="flex min-h-[calc(100vh-var(--navbar-height,64px))] w-full items-center justify-center px-4">
        {/* Keep the explorer gated behind auth to protect wallet-scoped data. */}
        <div className="max-w-md rounded-2xl border border-red-500/20 bg-black/70 p-6 text-center text-slate-100 shadow-xl">
          <div className="text-lg font-semibold">Sign in to view the Explorer</div>
          <div className="mt-2 text-sm text-slate-300">
            Connect your wallet to see your devices on the privacy-safe hex map.
          </div>
          <Link
            href="/signin"
            className="mt-4 inline-flex items-center justify-center rounded-full border border-red-500/40 bg-red-500/20 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-500/30"
          >
            Go to Sign In
          </Link>
        </div>
      </div>
    );
  }

  // Clicking a device in the list should select its hex and focus the map.
  const handleDeviceSelect = (hexId: string | null) => {
    if (!hexId) return;
    setSelectedHex(hexId);
    setFocusHexId(hexId);
  };

  return (
    <div className="relative h-[calc(100vh-var(--navbar-height,64px))] w-full">
      {/* The map is the primary surface; overlays handle legend and details. */}
      <ExplorerMap
        walletHexes={walletHexes}
        selectedHex={selectedHex}
        onSelectHex={(hexId) => setSelectedHex(hexId)}
        tilesUrl={tilesUrl}
        focusHexId={focusHexId}
        onFocusComplete={() => setFocusHexId(null)}
        // Pause globe spin while a hex is selected, resume when cleared.
        spinEnabled={!selectedHex}
      />

      {/* Mobile overlay stack keeps panels from overlapping the bottom sheet. */}
      {/* Add right padding when the collapsed icon dock is visible so icons never cover panel text. */}
      {!statsCollapsed && (
        <div
          className={`absolute left-4 top-4 flex flex-col gap-2 sm:hidden ${
            collapsedDockVisible ? 'pr-14' : ''
          }`}
        >
          {/* Keep the stats panel left-aligned so the legend can dock on the right. */}
          <div className="max-w-[calc(100vw-6rem)]">
            <ExplorerStats
              stats={globalStats}
              loading={globalStatsLoading}
              onCollapse={() => setStatsCollapsed(true)}
            />
          </div>
        </div>
      )}
      {!legendCollapsed && (
        <div className={`absolute right-4 ${dockedRightTopClass} sm:hidden`}>
          {/* Dock the legend by its icon so toggling feels consistent. */}
          <ExplorerLegend
            tilesReady={tilesReady}
            compact
            onCollapse={() => setLegendCollapsed(true)}
          />
        </div>
      )}

      {!statsCollapsed && (
        <div className="absolute left-6 top-6 hidden max-w-[90vw] sm:block sm:max-w-sm">
          {/* Let the stats panel size itself to content so zooming never clips it. */}
          <ExplorerStats
            stats={globalStats}
            loading={globalStatsLoading}
            onCollapse={() => setStatsCollapsed(true)}
          />
        </div>
      )}

      {!legendCollapsed && (
        <div className={`absolute right-4 ${dockedRightTopClass} hidden sm:block`}>
          {/* Dock the legend by its icon so it opens in-place. */}
          <ExplorerLegend
            tilesReady={tilesReady}
            compact
            onCollapse={() => setLegendCollapsed(true)}
          />
        </div>
      )}

      {/* Collapsed icons stay stacked in the top-right corner on all screen sizes. */}
      {collapsedDockVisible && (
        <div className="pointer-events-none absolute right-4 top-4 z-40 flex flex-col gap-2">
          {/* Collapsed stats button with a global insights icon. */}
          {statsCollapsed && (
            <button
              type="button"
              onClick={() => setStatsCollapsed(false)}
              className="pointer-events-auto inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-black/70 text-slate-100 shadow-lg backdrop-blur transition hover:bg-black/80"
              aria-label="Show stats"
            >
              <svg
                viewBox="0 0 24 24"
                width="18"
                height="18"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="9" />
                <path d="M12 3a10 10 0 0 1 0 18" />
                <path d="M12 3a10 10 0 0 0 0 18" />
                <path d="M3 12h18" />
              </svg>
            </button>
          )}
          {/* Collapsed legend button with a hamburger icon. */}
          {legendCollapsed && (
            <button
              type="button"
              onClick={() => setLegendCollapsed(false)}
              className="pointer-events-auto inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-black/70 text-slate-100 shadow-lg backdrop-blur transition hover:bg-black/80"
              aria-label="Show legend"
            >
              <svg
                viewBox="0 0 24 24"
                width="18"
                height="18"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M4 7h16" />
                <path d="M4 12h16" />
                <path d="M4 17h16" />
              </svg>
            </button>
          )}
          {/* Collapsed selected-hex button with a hex outline icon. */}
          {selectedPanelCollapsed && (
            <button
              type="button"
              onClick={() => setSelectedPanelCollapsed(false)}
              className="pointer-events-auto inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-black/70 text-slate-100 shadow-lg backdrop-blur transition hover:bg-black/80"
              aria-label="Show selected hex"
            >
              <svg
                viewBox="0 0 24 24"
                width="18"
                height="18"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M7 4.5 12 2l5 2.5 3 5.5-3 5.5L12 18l-5-2.5L4 10l3-5.5Z" />
              </svg>
            </button>
          )}
        </div>
      )}

      {!selectedPanelCollapsed && (
        <div
          className={`absolute inset-x-4 bottom-4 z-30 max-w-[90vw] sm:inset-auto sm:right-4 sm:bottom-auto sm:max-w-md ${
            // Offset the top-right panel on desktop if the icon dock is visible.
            collapsedDockVisible ? 'sm:top-16' : 'sm:top-4'
          }`}
        >
          {/* Float the panel at the bottom on mobile, top-right on larger screens. */}
          <ExplorerPanel
            hexId={selectedHex}
            devices={hexDevices}
            loading={hexLoading || devicesLoading}
            onClose={() => setSelectedHex(null)}
            onCollapse={() => setSelectedPanelCollapsed(true)}
            walletDevices={walletDevices}
            walletDevicesLoading={walletDevicesLoading}
            onDeviceSelect={handleDeviceSelect}
          />
        </div>
      )}

      {hexLoading && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full border border-white/10 bg-black/60 px-4 py-2 text-xs text-slate-200 shadow-lg backdrop-blur">
          {/* Lightweight status pill to show initial map loading. */}
          Loading your device hexes...
        </div>
      )}
    </div>
  );
}
