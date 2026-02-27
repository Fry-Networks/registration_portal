import { useTheme } from 'next-themes';
import { EXPLORER_STATUS_COLORS, type MapHexStatus } from './mapLayers';

export type ExplorerDevice = {
  miner_key: string;
  nickname: string | null;
  is_registered: boolean;
  status: MapHexStatus;
};

// Wallet device summaries include the hex id for quick jump actions.
export type ExplorerWalletDevice = {
  miner_key: string;
  nickname: string | null;
  is_registered: boolean;
  status: MapHexStatus;
  hexId: string | null;
  hasLocation: boolean;
};

interface ExplorerPanelProps {
  hexId: string | null;
  devices: ExplorerDevice[];
  loading: boolean;
  onClose: () => void;
  onCollapse: () => void;
  walletDevices: ExplorerWalletDevice[];
  walletDevicesLoading: boolean;
  onDeviceSelect: (hexId: string | null) => void;
}

export default function ExplorerPanel({
  hexId,
  devices,
  loading,
  onClose,
  onCollapse,
  walletDevices,
  walletDevicesLoading,
  onDeviceSelect
}: ExplorerPanelProps) {
  const { resolvedTheme } = useTheme();
  // Keep the panel theme-aware so it reads well over the map.
  const isDark = resolvedTheme !== 'light';

  return (
    <div
      className={`pointer-events-auto w-full max-w-sm rounded-2xl border p-4 shadow-xl backdrop-blur sm:max-w-md ${
        isDark
          ? 'border-white/10 bg-black/70 text-slate-100'
          : 'border-slate-200 bg-white/90 text-slate-900'
      } max-h-[60vh] overflow-hidden sm:max-h-none`}
    >
      {/* Cap panel height on small screens so stats/legend remain visible. */}
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-400">Selected hex</div>
          <div className="mt-1 text-sm font-semibold">{hexId ?? 'None'}</div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onCollapse}
            className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
              isDark
                ? 'border border-white/10 bg-white/10 text-slate-200 hover:bg-white/20'
                : 'border border-slate-200 bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            Hide
          </button>
          {/* Only show Close when a hex is selected. */}
          {hexId && (
            <button
              type="button"
              onClick={onClose}
              className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                isDark
                  ? 'border border-white/10 bg-white/10 text-slate-200 hover:bg-white/20'
                  : 'border border-slate-200 bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              Close
            </button>
          )}
        </div>
      </div>

      <div className="mt-4">
        {/* Show a compact summary of device count for the selected hex. */}
        <div className="text-sm font-semibold">
          {loading ? 'Loading devices...' : `${devices.length} device${devices.length === 1 ? '' : 's'}`}
        </div>
        {!hexId && !loading && (
          <div className="mt-2 text-xs text-slate-400">
            {/* Prompt users to click a hex when nothing is selected. */}
            Select a hex to see your devices.
          </div>
        )}
        {hexId && !loading && devices.length === 0 && (
          <div className="mt-2 text-xs text-slate-400">
            No devices from this wallet in the selected hex.
          </div>
        )}
      </div>

      <div className="mt-3 max-h-[45vh] space-y-2 overflow-y-auto pr-1">
        {devices.map((device) => (
          <div
            key={device.miner_key}
            className={`rounded-xl border p-3 ${
              isDark ? 'border-white/10 bg-white/5' : 'border-slate-200 bg-slate-50'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold">{device.nickname ?? device.miner_key}</div>
              <span
                className="inline-flex h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: EXPLORER_STATUS_COLORS[device.status] }}
                aria-label={`${device.status} status`}
              />
            </div>
            <div className="mt-1 text-xs text-slate-400">{device.miner_key}</div>
            <div className="mt-1 text-xs">
              {/* Prefer explicit offline labeling when telemetry is available. */}
              {device.status === 'offline' ? 'Offline' : device.is_registered ? 'Registered' : 'Unregistered'}
            </div>
          </div>
        ))}
      </div>

      <div className={`mt-4 border-t pt-3 ${isDark ? 'border-white/10' : 'border-slate-200'}`}>
        {/* List all wallet devices so users can jump directly to a hex. */}
        <div className="text-xs uppercase tracking-wide text-slate-400">Your devices</div>
        <div className="mt-2 text-sm font-semibold">
          {walletDevicesLoading ? 'Loading devices...' : `${walletDevices.length} device${walletDevices.length === 1 ? '' : 's'}`}
        </div>
        {!walletDevicesLoading && walletDevices.length === 0 && (
          <div className="mt-2 text-xs text-slate-400">No devices found for this wallet.</div>
        )}
        <div className="mt-3 max-h-[30vh] space-y-2 overflow-y-auto pr-1">
          {walletDevices.map((device) => {
            const isSelected = Boolean(device.hexId && device.hexId === hexId);
            // Only enable jump actions when the device has a resolved hex.
            const canFocus = Boolean(device.hasLocation && device.hexId);
            return (
              <button
                key={device.miner_key}
                type="button"
                onClick={() => onDeviceSelect(device.hexId)}
                disabled={!canFocus}
                className={`w-full rounded-xl border p-3 text-left transition ${
                  isDark ? 'border-white/10 bg-white/5' : 'border-slate-200 bg-slate-50'
                } ${isSelected ? 'ring-1 ring-amber-400/60' : ''} ${canFocus ? 'hover:bg-white/10' : 'opacity-60'}`}
              >
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold">{device.nickname ?? device.miner_key}</div>
                  <span
                    className="inline-flex h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: EXPLORER_STATUS_COLORS[device.status] }}
                    aria-label={`${device.status} status`}
                  />
                </div>
                <div className="mt-1 text-xs text-slate-400">{device.miner_key}</div>
                <div className="mt-1 text-xs text-slate-400">
                  {device.hexId ? `Hex ${device.hexId}` : 'Location pending'}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
