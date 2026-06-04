import { useEffect, useState } from 'react';
import { Button } from '@tremor/react';
import { KeyIcon, XIcon } from '@heroicons/react/outline';
import { useTheme } from 'next-themes';
import Link from 'next/link';

interface DeviceNeedingCredentials {
  miner_key: string;
  portal: string;
  nickname: string | null;
  needs_credentials: boolean;
}

const PORTAL_LABELS: Record<string, string> = {
  air: 'Air',
  camera: 'Camera',
  energy: 'Energy',
  weather: 'Weather',
  radiation: 'Radiation',
};

function truncateKey(key: string): string {
  if (key.length <= 20) return key;
  return key.slice(0, 12) + '...' + key.slice(-6);
}

export default function CredentialsBanner() {
  const [devices, setDevices] = useState<DeviceNeedingCredentials[]>([]);
  const [loading, setLoading] = useState(true);
  const [dismissed, setDismissed] = useState(false);
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const stored = sessionStorage.getItem('credentialsBannerDismissed');
      if (stored === 'true') setDismissed(true);
    }
  }, []);

  const handleDismiss = () => {
    setDismissed(true);
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('credentialsBannerDismissed', 'true');
    }
  };
  const isDark = resolvedTheme !== 'light';

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/devices/credential-status', { credentials: 'include' });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && data.devices) {
          setDevices(data.devices.filter((d: DeviceNeedingCredentials) => d.needs_credentials));
        }
      } catch {
        // silently ignore - banner is non-critical
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (loading || dismissed || devices.length === 0) return null;

  const cardBg = isDark
    ? 'border-warning-500/30 bg-warning-500/5'
    : 'border-warning-300 bg-warning-50';
  const cardText = isDark ? 'text-warning-200' : 'text-warning-900';
  const mutedText = isDark ? 'text-warning-300/70' : 'text-warning-700/70';
  const badgeBg = isDark
    ? 'bg-warning-500/20 text-warning-200 border-warning-500/30'
    : 'bg-warning-100 text-warning-800 border-warning-300';

  return (
    <div className={`mx-2 sm:mx-20 mt-6 rounded-2xl border-2 p-5 ${cardBg}`}>
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex items-center gap-3">
          <KeyIcon className={`h-6 w-6 flex-shrink-0 ${cardText}`} />
          <div>
            <h3 className={`text-lg font-semibold ${cardText}`}>
              {devices.length} Device{devices.length !== 1 ? 's' : ''} Need{devices.length === 1 ? 's' : ''} Credentials
            </h3>
            <p className={`text-sm ${mutedText}`}>
              Add your device&apos;s API credentials so the pipeline can verify they&apos;re online and you start earning rewards.
            </p>
          </div>
        </div>
        <button
          onClick={handleDismiss}
          className={`p-1 rounded-lg hover:bg-warning-500/10 ${mutedText}`}
          aria-label="Dismiss"
        >
          <XIcon className="h-5 w-5" />
        </button>
      </div>

      <div className="space-y-2 mb-4">
        {devices.slice(0, 10).map((device) => (
          <div
            key={device.miner_key}
            className={`flex items-center justify-between gap-3 rounded-xl px-4 py-3 ${
              isDark ? 'bg-white/5' : 'bg-white/80'
            }`}
          >
            <div className="flex items-center gap-3 min-w-0">
              <span className={`text-sm font-mono truncate ${isDark ? 'text-white' : 'text-slate-900'}`}>
                {device.nickname || truncateKey(device.miner_key)}
              </span>
              <span className={`text-xs px-2 py-0.5 rounded-full border ${badgeBg}`}>
                {PORTAL_LABELS[device.portal] || device.portal}
              </span>
            </div>
            <Link
              href={`/device-credentials`}
            >
              <Button
                size="xs"
                className={
                  isDark
                    ? 'bg-warning-600 text-white border-warning-500 hover:bg-warning-500'
                    : 'bg-warning-600 text-white border-warning-600 hover:bg-warning-700'
                }
              >
                Add Credentials
              </Button>
            </Link>
          </div>
        ))}
        {devices.length > 10 && (
          <p className={`text-sm text-center ${mutedText}`}>
            ...and {devices.length - 10} more
          </p>
        )}
      </div>

      <div className={`text-sm ${mutedText}`}>
        Need help finding your credentials?{' '}
        <Link href="/help/credentials" className={`underline ${cardText} hover:opacity-80`}>
          See our setup guide
        </Link>
      </div>
    </div>
  );
}
