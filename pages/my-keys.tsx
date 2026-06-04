import { useEffect, useState, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { KeyIcon, ClipboardCopyIcon, CheckIcon, TrashIcon } from '@heroicons/react/outline';
import PageShell from '../components/PageShell';

interface IoTCredentials {
  [collection: string]: {
    miner_type?: string | null;
    api_type?: string | null;
    credentials: Record<string, unknown>;
    credentials_saved_at?: string | null;
    position?: unknown;
    position_saved_at?: string | null;
  };
}

interface DeviceEntry {
  miner_key: string;
  name?: string;
  nickname?: string;
  is_registered?: boolean;
  iotCredentials?: IoTCredentials;
}

interface MyKeysData {
  devices: DeviceEntry[];
  byodLicenses: string[];
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  }, [text]);

  return (
    <button
      onClick={copy}
      className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-surface-strong border border-divider hover:border-primary-500 hover:text-primary-500 text-ink-secondary rounded-token-sm transition"
    >
      {copied ? <CheckIcon className="h-3 w-3 text-success-500" /> : <ClipboardCopyIcon className="h-3 w-3" />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

function MaskedValue({ value }: { value: string }) {
  const [revealed, setRevealed] = useState(false);

  if (revealed) {
    return (
      <span className="font-mono text-sm text-success-500 break-all">
        {value}
        <button
          onClick={() => setRevealed(false)}
          className="ml-2 px-2 py-0.5 text-xs bg-surface-strong border border-divider hover:border-primary-500 text-ink-secondary rounded-token-sm transition"
        >
          Hide
        </button>
      </span>
    );
  }

  return (
    <button
      onClick={() => setRevealed(true)}
      className="px-2 py-0.5 text-xs bg-surface-strong border border-divider hover:border-primary-500 text-ink-secondary rounded-token-sm transition"
    >
      Click to reveal
    </button>
  );
}

export default function MyKeysPage() {
  const { data: session, status } = useSession();
  const [data, setData] = useState<MyKeysData>({ devices: [], byodLicenses: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (status === 'loading' || !session?.user?.address) return;

    let cancelled = false;

    async function fetchKeys() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/my-keys');
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.message || `HTTP ${res.status}`);
        }
        const payload: MyKeysData = await res.json();
        if (!cancelled) setData(payload);
      } catch (err: any) {
        if (!cancelled) setError(err.message || 'Failed to load keys');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchKeys();
    return () => { cancelled = true; };
  }, [session, status]);

  if (status === 'loading' || loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[40vh]">
        <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin mb-4" />
        <p className="text-ink-secondary font-body">Loading your keys...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="bg-error-500/10 border border-error-500/30 rounded-token-md p-4 text-error-500 font-body">
          <p>Error: {error}</p>
        </div>
      </div>
    );
  }

  const q = searchQuery.trim().toLowerCase();
  const filteredLicenses = q ? data.byodLicenses.filter(l => l.toLowerCase().includes(q)) : data.byodLicenses;
  const filteredDevices = q ? data.devices.filter(d =>
    d.miner_key.toLowerCase().includes(q) ||
    (d.name || '').toLowerCase().includes(q) ||
    (d.nickname || '').toLowerCase().includes(q)
  ) : data.devices;

  return (
    <PageShell title="My Keys" breadcrumb={true}>
      <div className="max-w-6xl mx-auto px-4 py-space-6">
        {session?.user?.address && (
          <div className="mb-space-5 flex items-center gap-2">
            <span className="text-sm text-ink-secondary font-body">Wallet:</span>
            <span className="font-mono text-sm text-ink">{session.user.address}</span>
          </div>
        )}

        {/* Search */}
        <div className="mb-space-6">
          <div className="relative max-w-md">
            <input
              type="text"
              placeholder="Search by miner key, name, or nickname..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-surface-strong border border-divider rounded-token-lg px-4 py-3 text-sm text-ink placeholder-ink-secondary outline-none focus:ring-2 focus:ring-primary-500/40 transition"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-ink-secondary hover:text-primary-500 transition"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {/* BYOD Licenses */}
        {filteredLicenses.length > 0 && (
          <section className="mb-space-8">
            <h2 className="text-lg font-display font-semibold text-ink mb-4 border-b border-divider pb-2">
              BYOD Licenses <span className="text-primary-500">({filteredLicenses.length})</span>
            </h2>
            {/* Desktop table */}
            <div className="hidden md:block bg-surface-elevated border border-divider rounded-token-xl overflow-hidden">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-divider">
                    <th className="px-4 py-3 text-xs font-semibold text-ink-secondary uppercase tracking-wider font-display">License Key</th>
                    <th className="px-4 py-3 text-xs font-semibold text-ink-secondary uppercase tracking-wider font-display text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-divider">
                  {filteredLicenses.map((license) => (
                    <tr key={license} className="hover:bg-surface-strong/50 transition">
                      <td className="px-4 py-3 font-mono text-sm text-primary-500">{license}</td>
                      <td className="px-4 py-3 text-right">
                        <CopyButton text={license} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* Mobile cards */}
            <div className="md:hidden grid grid-cols-1 sm:grid-cols-2 gap-space-3">
              {filteredLicenses.map((license) => (
                <div
                  key={license}
                  className="bg-surface-elevated border border-divider rounded-token-lg px-4 py-3 flex items-center justify-between"
                >
                  <span className="font-mono text-sm text-primary-500 truncate">{license}</span>
                  <CopyButton text={license} />
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Miner Keys */}
        {filteredDevices.length > 0 && (
          <section className="mb-space-8">
            <h2 className="text-lg font-display font-semibold text-ink mb-4 border-b border-divider pb-2">
              Miner Keys <span className="text-primary-500">({filteredDevices.length})</span>
            </h2>
            {/* Desktop table */}
            <div className="hidden md:block bg-surface-elevated border border-divider rounded-token-xl overflow-hidden">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-divider">
                    <th className="px-4 py-3 text-xs font-semibold text-ink-secondary uppercase tracking-wider font-display">Key Name</th>
                    <th className="px-4 py-3 text-xs font-semibold text-ink-secondary uppercase tracking-wider font-display">Type</th>
                    <th className="px-4 py-3 text-xs font-semibold text-ink-secondary uppercase tracking-wider font-display">Status</th>
                    <th className="px-4 py-3 text-xs font-semibold text-ink-secondary uppercase tracking-wider font-display text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-divider">
                  {filteredDevices.map((device) => {
                    const type = device.miner_key.split('-')[0];
                    const hasCreds = device.iotCredentials && Object.keys(device.iotCredentials).length > 0;
                    return (
                      <tr key={device.miner_key} className="hover:bg-surface-strong/50 transition">
                        <td className="px-4 py-3">
                          <div className="font-semibold text-ink">{device.name || 'Unnamed Device'}</div>
                          {device.nickname && <div className="text-sm text-ink-secondary">{device.nickname}</div>}
                          <div className="font-mono text-xs text-primary-500 mt-1">{device.miner_key}</div>
                          <div className="mt-1">
                            <span className={`inline-flex items-center rounded-token-md px-2 py-0.5 text-xs font-medium border ${device.is_registered ? 'bg-success-500/10 text-success-500 border-success-500/20' : 'bg-gray-500/10 text-gray-500 border-gray-500/20'}`}>
                              {device.is_registered ? 'Registered' : 'Unregistered'}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm text-ink-secondary font-body">{type}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center rounded-token-md px-2.5 py-1 text-xs font-medium border ${hasCreds ? 'bg-success-500/10 text-success-500 border-success-500/20' : 'bg-warning-500/10 text-warning-500 border-warning-500/20'}`}>
                            {hasCreds ? 'Configured' : 'No credentials'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <CopyButton text={device.miner_key} />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {/* Mobile cards */}
            <div className="md:hidden space-y-space-4">
              {filteredDevices.map((device) => (
                <div
                  key={device.miner_key}
                  className="bg-surface-elevated border border-divider rounded-token-lg p-space-5"
                >
                  <div className="flex items-center justify-between gap-3 mb-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-ink">{device.name || 'Unnamed Device'}</p>
                      {device.nickname && (
                        <p className="text-sm text-ink-secondary">{device.nickname}</p>
                      )}
                      <span className={`inline-flex items-center rounded-token-md px-2 py-0.5 text-xs font-medium border mt-1 ${device.is_registered ? 'bg-success-500/10 text-success-500 border-success-500/20' : 'bg-gray-500/10 text-gray-500 border-gray-500/20'}`}>
                        {device.is_registered ? 'Registered' : 'Unregistered'}
                      </span>
                    </div>
                    <CopyButton text={device.miner_key} />
                  </div>
                  <p className="font-mono text-sm text-primary-500 break-all">{device.miner_key}</p>

                  {device.iotCredentials && Object.keys(device.iotCredentials).length > 0 && (
                    <div className="mt-4 border-t border-divider pt-4">
                      <h3 className="text-sm font-semibold text-ink-secondary mb-3 font-body">IoT Credentials</h3>
                      <div className="space-y-3">
                        {Object.entries(device.iotCredentials).map(([collection, cred]) => (
                          <div
                            key={collection}
                            className="bg-surface-strong border border-divider rounded-token-md p-3"
                          >
                            <p className="text-xs font-semibold text-ink-muted uppercase mb-2">{collection}</p>
                            <div className="space-y-2">
                              {Object.entries(cred.credentials).map(([key, val]) => (
                                <div key={key} className="flex items-start justify-between gap-2">
                                  <span className="text-xs text-ink-muted shrink-0">{key}:</span>
                                  <div className="text-right">
                                    {typeof val === 'string' ? (
                                      <MaskedValue value={val} />
                                    ) : (
                                      <span className="text-xs text-ink-secondary font-mono">{JSON.stringify(val)}</span>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Empty state */}
        {data.devices.length === 0 && data.byodLicenses.length === 0 && (
          <div className="bg-surface-elevated border border-divider rounded-token-xl p-space-8 text-center">
            <div className="w-16 h-16 rounded-full bg-primary-500/10 flex items-center justify-center mx-auto mb-4">
              <KeyIcon className="h-8 w-8 text-primary-500" />
            </div>
            <p className="font-semibold text-ink font-body">No keys found for this wallet address.</p>
            <p className="text-sm text-ink-secondary mt-2 font-body">Register a device to get started.</p>
          </div>
        )}
      </div>
    </PageShell>
  );
}
