import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/router';
import { Button, Title } from '@tremor/react';
import { KeyIcon, ArrowLeftIcon } from '@heroicons/react/outline';
import Link from 'next/link';
import { useTheme } from 'next-themes';
import PageShell from '../components/PageShell';
import { portalKeyFromMiner } from '../lib/credentials-utils';

interface DeviceNeedingCredentials {
  miner_key: string;
  portal: string;
  nickname: string | null;
  needs_credentials: boolean;
}

interface DeviceListItem {
  miner_key: string;
  nickname: string | null;
  productName: string | null;
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

export default function DeviceCredentialsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme !== 'light';

  const [devicesNeedingCreds, setDevicesNeedingCreds] = useState<DeviceNeedingCredentials[]>([]);
  const [allDevices, setAllDevices] = useState<DeviceListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (status === 'loading') return;
    if (!session?.user?.address) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const [statusRes, listRes] = await Promise.all([
          fetch('/api/devices/credential-status', { credentials: 'include' }),
          fetch('/api/devices/list', { credentials: 'include' }),
        ]);

        const statusData = statusRes.ok ? await statusRes.json() : { devices: [] };
        const listData = listRes.ok ? await listRes.json() : { miner_keys: [] };

        if (!cancelled) {
          setDevicesNeedingCreds(statusData.devices || []);
          setAllDevices(listData.miner_keys || []);
        }
      } catch {
        // silently ignore
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [session, status, router]);

  if (status === 'loading' || loading) {
    return (
      <div className={`min-h-screen flex items-center justify-center ${isDark ? 'bg-surface text-ink' : 'bg-surface-strong text-ink'}`}>
        <div className="animate-pulse text-lg">Loading devices...</div>
      </div>
    );
  }

  const pageBg = isDark ? 'bg-surface text-ink' : 'bg-surface-strong text-ink';
  const cardBg = isDark ? 'bg-white/5 border-divider' : 'bg-surface-elevated border-divider';
  const mutedText = isDark ? 'text-ink-muted' : 'text-ink-muted';
  const strongText = isDark ? 'text-ink' : 'text-ink';
  const badgeBg = isDark ? 'bg-warning-500/20 text-warning-200 border-warning-500/30' : 'bg-warning-100 text-warning-800 border-warning-300';
  const okBadgeBg = isDark ? 'bg-emerald-500/20 text-emerald-200 border-emerald-500/30' : 'bg-emerald-100 text-emerald-800 border-emerald-300';

  const buildRegisterLink = (minerKey: string, portal: string) => {
    return `/register?minerKey=${encodeURIComponent(minerKey)}&type=${encodeURIComponent(portal)}&clickable=true&section=credentials`;
  };

  const needingSet = new Set(devicesNeedingCreds.map((d) => d.miner_key));

  return (
    <PageShell title="Device Credentials" breadcrumb={true}>
      <div className="max-w-6xl mx-auto px-4 py-space-6">
        <div className="mb-space-6">
          <Link href="/devices" className="inline-flex items-center gap-2 text-sm text-ink-secondary hover:text-ink transition">
            <ArrowLeftIcon className="h-4 w-4" />
            Back to devices
          </Link>
        </div>

        <div className="mb-space-6 bg-surface-elevated border border-divider rounded-token-xl p-space-5">
          <p className="text-sm text-ink-secondary">
            Add or update your device API credentials so the pipeline can verify they&apos;re online and you can start earning rewards.
          </p>
        </div>

        <div className="mb-space-6">
          <div className="relative max-w-md">
            <input
              type="text"
              placeholder="Search by miner key or nickname..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-surface-strong border border-divider rounded-token-lg px-4 py-3 text-ink focus:border-primary-500 focus:ring-1 focus:ring-primary-500 transition"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-ink-muted hover:text-ink"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {/* Desktop table */}
        <div className="hidden md:block">
          <div className="bg-surface-elevated border border-divider rounded-token-xl overflow-hidden">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-divider">
                  <th className="px-4 py-3 text-xs font-semibold text-ink-secondary uppercase tracking-wider">Device</th>
                  <th className="px-4 py-3 text-xs font-semibold text-ink-secondary uppercase tracking-wider">Portal</th>
                  <th className="px-4 py-3 text-xs font-semibold text-ink-secondary uppercase tracking-wider">Status</th>
                  <th className="px-4 py-3 text-xs font-semibold text-ink-secondary uppercase tracking-wider text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-divider">
                {(() => {
                  const q = searchQuery.trim().toLowerCase();
                  return allDevices.filter(d =>
                    !q || d.miner_key.toLowerCase().includes(q) || (d.nickname || '').toLowerCase().includes(q)
                  ).map((device) => {
                    const needsCreds = needingSet.has(device.miner_key);
                    const portal = portalKeyFromMiner(device.miner_key);
                    return (
                      <tr key={device.miner_key} className="hover:bg-surface-strong/50 transition">
                        <td className="px-4 py-3">
                          <div className="font-mono text-sm font-medium text-ink">
                            {device.nickname || truncateKey(device.miner_key)}
                          </div>
                          <div className="text-xs text-ink-muted mt-0.5">{device.miner_key}</div>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-sm text-ink-secondary">
                            {PORTAL_LABELS[portal] || portal || '—'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center rounded-token-md px-2.5 py-1 text-xs font-medium border ${needsCreds ? 'bg-error-500/10 text-error-500 border-error-500/20' : 'bg-success-500/10 text-success-500 border-success-500/20'}`}>
                            {needsCreds ? 'Missing credentials' : 'Configured'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Link href={buildRegisterLink(device.miner_key, portal || 'air')}>
                            <button className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-token-md text-xs font-semibold transition ${needsCreds ? 'bg-primary-500 hover:bg-primary-600 text-ink' : 'bg-surface-strong border border-divider text-ink-secondary hover:text-ink hover:border-primary-500/50'}`}>
                              {needsCreds ? 'Configure' : 'Update'}
                            </button>
                          </Link>
                        </td>
                      </tr>
                    );
                  });
                })()}
              </tbody>
            </table>
          </div>
        </div>

        {/* Mobile cards */}
        <div className="md:hidden space-y-3">
          {(() => {
            const q = searchQuery.trim().toLowerCase();
            return allDevices.filter(d =>
              !q || d.miner_key.toLowerCase().includes(q) || (d.nickname || '').toLowerCase().includes(q)
            ).map((device) => {
              const needsCreds = needingSet.has(device.miner_key);
              const portal = portalKeyFromMiner(device.miner_key);
              return (
                <div key={device.miner_key} className="bg-surface-elevated border border-divider rounded-token-lg p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-mono text-sm font-medium text-ink truncate">
                        {device.nickname || truncateKey(device.miner_key)}
                      </div>
                      <div className="text-xs text-ink-muted mt-0.5">{device.miner_key}</div>
                    </div>
                    <span className={`shrink-0 inline-flex items-center rounded-token-md px-2 py-0.5 text-xs font-medium border ${needsCreds ? 'bg-error-500/10 text-error-500 border-error-500/20' : 'bg-success-500/10 text-success-500 border-success-500/20'}`}>
                      {needsCreds ? 'Missing' : 'OK'}
                    </span>
                  </div>
                  <div className="mt-3 flex items-center justify-between">
                    <span className="text-xs text-ink-secondary">{PORTAL_LABELS[portal] || portal || '—'}</span>
                    <Link href={buildRegisterLink(device.miner_key, portal || 'air')}>
                      <button className={`px-3 py-1.5 rounded-token-md text-xs font-semibold transition ${needsCreds ? 'bg-primary-500 text-ink' : 'bg-surface-strong border border-divider text-ink-secondary'}`}>
                        {needsCreds ? 'Configure' : 'Update'}
                      </button>
                    </Link>
                  </div>
                </div>
              );
            });
          })()}
        </div>

        {allDevices.length === 0 && devicesNeedingCreds.length === 0 && (
          <div className="bg-surface-elevated border border-divider rounded-token-xl p-8 text-center">
            <p className="text-sm text-ink-secondary">No devices found.</p>
            <Link href="/devices">
              <button className="mt-4 bg-primary-500 hover:bg-primary-600 text-ink px-4 py-2 rounded-token-md text-sm font-semibold transition">
                Add a device
              </button>
            </Link>
          </div>
        )}
      </div>
    </PageShell>
  );
}
