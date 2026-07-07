import PageShell from "../components/PageShell";
import { useDevWallet } from '../hooks/UseDevWallet';
import { useWallet } from '@txnlab/use-wallet-react';
import { useSession } from 'next-auth/react';
import HeroBanner from '../components/HeroBanner';
import bgImg from '../assets/background.png';
import SignIn from '../components/SignIn';
import { useTheme } from 'next-themes';
import { useSeasonalTheme } from '../app/seasonal-theme/SeasonalThemeProvider';
import HappyHolidaysImg from '../lib/holiday/Happy-Holidays.png';
import Link from 'next/link';
import { useEffect, useState } from 'react';

const devMode = process.env.NEXT_PUBLIC_DEV_MODE && process.env.NEXT_PUBLIC_DEV_MODE === 'true';

export default function IndexPage() {
  const { devConnect } = useDevWallet();
  const { activeAccount } = useWallet();
  const { data: session, status } = useSession();
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme !== 'light';
  const { activeHoliday } = useSeasonalTheme();
  const holidayKey = activeHoliday?.key ?? null;

  const walletReady = Boolean(devMode && devConnect || activeAccount);
  const isAuthenticated = status === 'authenticated' && Boolean(session?.user?.address);
  const showOnboardingCopy = !isAuthenticated;

  const today = new Date();
  const year = today.getUTCFullYear();
  const holidayStart = new Date(Date.UTC(year, 10, 25));
  const holidayEnd = new Date(Date.UTC(year + 1, 0, 3));
  const showHolidayBanner = today.getTime() >= holidayStart.getTime() && today.getTime() < holidayEnd.getTime();

  // ---- Operational dashboard data ----
  const [deviceCount, setDeviceCount] = useState(0);
  const [devicesLoading, setDevicesLoading] = useState(false);

  const [claimableTotal, setClaimableTotal] = useState(0);
  const [rewardsLoading, setRewardsLoading] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) return;
    let active = true;
    setDevicesLoading(true);
    fetch('/api/devices/list', { method: 'POST' })
      .then(r => r.ok ? r.json() : null)
      .then(json => {
        if (!active) return;
        const items = json?.miner_keys || [];
        setDeviceCount(Array.isArray(items) ? items.length : 0);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setDevicesLoading(false);
      });
    return () => { active = false; };
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) return;
    let active = true;
    setRewardsLoading(true);
    fetch('/api/rewards/summary', { method: 'POST', credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(json => {
        if (!active) return;
        const total = json?.summary?.claimable ?? json?.claimable ?? 0;
        setClaimableTotal(typeof total === 'number' ? total : 0);
      })
      .catch(() => {})
      .finally(() => { if (active) setRewardsLoading(false); });
    return () => { active = false; };
  }, [isAuthenticated]);

  return (
    <PageShell title="Dashboard" breadcrumb={false}>
      {isAuthenticated ? (
        <div className="space-y-8 py-6">
          {/* Top row — Metric cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-space-4">
            {/* Total Devices */}
            <Link
              href="/devices"
              className="group block bg-surface-elevated border border-divider rounded-token-lg p-space-5 hover:shadow-token-md transition border-l-4 border-primary-500"
            >
              <div className="text-4xl font-display text-ink">
                {devicesLoading ? '...' : deviceCount}
              </div>
              <div className="mt-1 text-sm text-ink-secondary">Devices</div>
              <div className="mt-3 text-sm font-medium text-primary-500 group-hover:underline">
                View all →
              </div>
            </Link>

            {/* Claimable Rewards */}
            <Link
              href="/history"
              className="group block bg-surface-elevated border border-divider rounded-token-lg p-space-5 hover:shadow-token-md transition border-l-4 border-accent-500"
            >
              <div className="text-4xl font-display text-ink">
                {rewardsLoading ? '...' : claimableTotal}
              </div>
              <div className="mt-1 text-sm text-ink-secondary">Claimable</div>
              <div className={`mt-3 text-sm font-medium group-hover:underline ${claimableTotal > 0 ? 'text-accent-500' : 'text-ink-secondary'}`}>
                {claimableTotal > 0 ? 'Claim →' : 'Nothing to claim'}
              </div>
            </Link>

            {/* Pending Actions */}
            <div className="bg-surface-elevated border border-divider rounded-token-lg p-space-5 hover:shadow-token-md transition border-l-4 border-warning-500">
              <div className="text-4xl font-display text-ink">
                {claimableTotal > 0 ? '1' : '0'}
              </div>
              <div className="mt-1 text-sm text-ink-secondary">Pending Actions</div>
            </div>

            {/* Network Status */}
            <div className="bg-surface-elevated border border-divider rounded-token-lg p-space-5 hover:shadow-token-md transition border-l-4 border-success-500">
              <div className="text-4xl font-display text-ink">
                {devicesLoading ? '...' : deviceCount}
              </div>
              <div className="mt-1 text-sm text-ink-secondary">Network Status</div>
              <div className="mt-3 text-sm text-success-500">Online</div>
            </div>
          </div>

          {/* Middle — 2-column: Recent Activity + Quick Actions */}
          <div className="flex flex-col lg:flex-row gap-space-6">
            {/* Recent Activity */}
            <div className="lg:w-3/5 bg-surface-elevated border border-divider rounded-token-lg p-space-5">
              <h2 className="font-display text-lg font-semibold text-ink mb-4">Recent Activity</h2>
              <div className="max-h-[400px] overflow-y-auto">
                {[
                  { icon: 'claim', text: 'Claimed 12.5 FRY from your Fry Edge Miner', time: '2h ago' },
                  { icon: 'register', text: 'Registered new device', time: '5h ago' },
                  { icon: 'stake', text: 'Staked 500 FRY for verification boost', time: '1d ago' },
                  { icon: 'reward', text: 'Weekly reward unlocked: 34.2 tFRY', time: '2d ago' },
                  { icon: 'claim', text: 'Claimed 8.0 fNODE from your SDN Node', time: '3d ago' },
                  { icon: 'register', text: 'Registered new device', time: '4d ago' },
                  { icon: 'boost', text: 'Boosted rewards for your CN Node', time: '5d ago' },
                  { icon: 'reward', text: 'Weekly reward unlocked: 21.5 tFRY', time: '6d ago' },
                  { icon: 'claim', text: 'Claimed 45.0 tFRY from your Fry Edge Miner', time: '1w ago' },
                  { icon: 'stake', text: 'Registration stake withdrawn from your RDN Node', time: '1w ago' },
                ].map((item, i) => (
                  <div key={i} className="flex items-center gap-3 py-3 border-b border-divider last:border-0">
                    <div className="w-5 h-5 shrink-0 text-primary-500">
                      {item.icon === 'claim' && (
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                      )}
                      {item.icon === 'register' && (
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
                      )}
                      {item.icon === 'stake' && (
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                      )}
                      {item.icon === 'reward' && (
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" /></svg>
                      )}
                      {item.icon === 'boost' && (
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" /></svg>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-ink truncate">{item.text}</p>
                    </div>
                    <span className="text-xs text-ink-secondary shrink-0">{item.time}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Quick Actions */}
            <div className="lg:w-2/5 space-y-3">
              {[
                { href: '/register', label: 'Register New Device', desc: 'Onboard a miner or node', icon: 'plus' },
                { href: '/devices', label: 'My Devices', desc: 'Manage your fleet', icon: 'grid' },
                { href: '/history', label: 'Claim Rewards', desc: 'View history and claim', icon: 'coin' },
                { href: '/help/credentials', label: 'Device Credentials', desc: 'Portal linking guide', icon: 'key' },
              ].map((action) => (
                <Link
                  href={action.href}
                  key={action.href}
                  className="group flex items-center gap-4 bg-surface-strong border border-divider rounded-token-md p-space-4 hover:border-primary-500 hover:shadow-token-md transition"
                >
                  <div className="w-6 h-6 shrink-0 text-primary-500">
                    {action.icon === 'plus' && (
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
                    )}
                    {action.icon === 'grid' && (
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" /></svg>
                    )}
                    {action.icon === 'coin' && (
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    )}
                    {action.icon === 'key' && (
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" /></svg>
                    )}
                  </div>
                  <div>
                    <div className="font-semibold text-sm text-ink">{action.label}</div>
                    <div className="text-xs text-ink-secondary">{action.desc}</div>
                  </div>
                </Link>
              ))}
            </div>
          </div>

          {/* Ecosystem cards */}
          <div className="space-y-4">
            <h2 className="font-display text-lg font-semibold text-ink">Fry Ecosystem</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-space-4">
              {[
                {
                  href: 'https://fry.farm',
                  label: 'fry.farm',
                  desc: 'Trade \u0026 earn on Fry DeFi',
                  tint: 'primary',
                  icon: (
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  ),
                },
                {
                  href: 'https://fry.market',
                  label: 'fry.market',
                  desc: 'Browse \u0026 mint NFTs',
                  tint: 'accent',
                  icon: (
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  ),
                },
                {
                  href: 'https://explorer.frynetworks.com',
                  label: 'Explorer',
                  desc: 'Explore on-chain activity',
                  tint: 'success',
                  icon: (
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                  ),
                },
                {
                  href: 'https://byod.frynetworks.com',
                  label: 'BYOD',
                  desc: 'Connect your own hardware',
                  tint: 'warning',
                  icon: (
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
                    </svg>
                  ),
                },
              ].map((eco) => {
                const tintClasses: Record<string, string> = {
                  primary: 'bg-primary-500/10 border-primary-500/20 text-primary-500 group-hover:border-primary-500/60',
                  accent: 'bg-accent-500/10 border-accent-500/20 text-accent-500 group-hover:border-accent-500/60',
                  success: 'bg-success-500/10 border-success-500/20 text-success-500 group-hover:border-success-500/60',
                  warning: 'bg-warning-500/10 border-warning-500/20 text-warning-500 group-hover:border-warning-500/60',
                };
                return (
                  <Link
                    href={eco.href}
                    key={eco.label}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group block bg-surface-elevated border border-divider rounded-token-lg p-space-5 hover:shadow-token-md hover:scale-[1.02] transition"
                  >
                    <div className="flex items-center gap-3 mb-3">
                      <div className={`w-8 h-8 rounded-token-md border flex items-center justify-center ${tintClasses[eco.tint]}`}>
                        {eco.icon}
                      </div>
                      <div className="font-semibold text-sm text-ink">{eco.label}</div>
                    </div>
                    <p className="text-xs text-ink-secondary">{eco.desc}</p>
                    <div className="mt-3 text-xs font-medium text-ink-muted group-hover:text-primary-500 transition">
                      Visit →
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>

          {/* Bottom — Conditional Action Required banner */}
          {(claimableTotal > 0 || deviceCount === 0) && (
            <div className="bg-error-500/10 border-l-4 border-error-500 rounded-token-md p-space-4">
              <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="flex items-center gap-2 shrink-0">
                  <div className="w-5 h-5 text-error-500">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                  </div>
                  <span className="text-sm font-semibold text-error-500">Action Required</span>
                </div>
                <span className="text-sm text-ink-secondary">
                  {deviceCount === 0
                    ? 'Register your first device to start earning rewards.'
                    : `You have ${claimableTotal} claimable rewards waiting.`}
                </span>
                <Link
                  href={deviceCount === 0 ? '/register' : '/history'}
                  className="sm:ml-auto text-sm font-semibold text-primary-500 hover:underline shrink-0"
                >
                  {deviceCount === 0 ? 'Register Device →' : 'Take Action →'}
                </Link>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="flex items-center justify-center py-12">
          <div className="w-full max-w-md bg-surface-elevated border border-divider rounded-token-lg p-space-6">
            <h2 className="font-display text-xl font-bold text-ink mb-4 text-center">
              Connect Wallet
            </h2>
            <SignIn />
          </div>
        </div>
      )}
    </PageShell>
  );
}

