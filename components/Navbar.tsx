'use client';

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import Lottie from 'lottie-react';
import { usePathname } from 'next/navigation';
import { signIn, signOut, useSession } from 'next-auth/react';
import { useWallet } from '@txnlab/use-wallet-react';
import Image from 'next/image';
import { Button, Flex, Title } from '@tremor/react';
import Link from 'next/link';

import fryLogo from '../assets/Logo.png';
import Modal from 'react-modal';
import { useDevWallet } from '../hooks/UseDevWallet';
import useActiveEvents from '../hooks/useActiveEvents';
import { useRouter } from 'next/router';
import DownMenu from './MenuBox';
import { normalizeAssetId, tFRY } from '../lib/utils';
import { BellIcon, MenuIcon, XIcon } from '@heroicons/react/outline';
import NotificationCenter from './NotificationCenter';
import { useNotifications } from '../app/notificationcontext';
import BugReportModal, { BugReportPayload } from './BugReportModal';
import { useToastContext } from '../hooks/ToastContext';
import { runWithWalletRequest, WalletRequestInFlightError } from '../lib/wallet/requestCoordinator.client';
import ThemeControls from './ThemeControls';
import { useTheme } from 'next-themes';
import fryLogoLight from '../assets/Logo_lightmode.png';
import { useSeasonalTheme } from '../app/seasonal-theme/SeasonalThemeProvider'; // Seasonal chrome
import fryLogoXmasLight from '../assets/Logo_xmas_light.png'; // Festive logo for Christmas (light)
import fryLogoXmasDark from '../assets/Logo_xmas_dark.png'; // Festive logo for Christmas (dark)
import merryChristmasAnimation from '../public/holiday/Merry Christmas.json'; // Xmas: Centered Lottie banner for navbar
import { isWithinChristmasGreetingWindow } from '../lib/holidays';

function classNames(...classes: string[]) {
  return classes.filter(Boolean).join(' ');
}

const devMode =
  process.env.NEXT_PUBLIC_DEV_MODE &&
  process.env.NEXT_PUBLIC_DEV_MODE === 'true';

export default function Navbar() {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme !== 'light';
  const pathname = usePathname();
  const { activeHoliday, availableHoliday } = useSeasonalTheme();
  const isChristmas = activeHoliday?.key === 'christmas';
  const showHolidayGreeting = useMemo(() => isWithinChristmasGreetingWindow(new Date()), []);
  const { data: session, status } = useSession();
  const { wallets, activeAccount, algodClient } = useWallet();
  const activeWallet = wallets.find(w => w.isActive);
  const { devConnect, devAccount, algodClient: devAlgodClient, setDevConnect } = useDevWallet();
  const [isWalletModalOpen, setIsWalletModalOpen] = useState(false);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [address, setAddress] = useState('');
  // Xmas: Respect reduced motion for navbar Lottie overlays.
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const [algoBalance, setAlgoBalance] = useState('0.00');
  const [fryBalance, setFryBalance] = useState('0.00');
  const router = useRouter();
  const [countdown, setCountdown] = useState<string>("");
  const { notifications, dismiss } = useNotifications();
  const [showNotifications, setShowNotifications] = useState(false);
  const notificationTrayRef = useRef<HTMLDivElement | null>(null);
  const headerRef = useRef<HTMLElement | null>(null);
  const bugSuccessCloseTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [isBugModalOpen, setIsBugModalOpen] = useState(false);
  const [isSubmittingBug, setIsSubmittingBug] = useState(false);
  const [bugSubmitError, setBugSubmitError] = useState<string | null>(null);
  const [bugSuccessMessage, setBugSuccessMessage] = useState<string | null>(null);
  const [dimoEnabled, setDimoEnabled] = useState<boolean | null>(null);
  const [showSwapMenu, setShowSwapMenu] = useState(false);
  const toast = useToastContext();
  const { success: showToastSuccess, error: showToastError, info: showToastInfo } = toast;
  const { hasActiveEvent, activeCount } = useActiveEvents();

  const modalStyles = useMemo(() => {
    if (isDark) {
      return {
        content: {
          top: '50%',
          left: '50%',
          right: 'auto',
          bottom: 'auto',
          marginRight: '-50%',
          transform: 'translate(-50%, -50%)',
          backgroundColor: 'black',
          color: '#e5e7eb',
          padding: '20px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
          borderColor: '#D00000',
          borderRadius: '40px',
          paddingBottom: '40px'
        },
        overlay: {
          backgroundColor: 'rgba(0, 0, 0, 0.75)',
          backdropFilter: 'blur(5px)'
        }
      };
    }
    return {
      content: {
        top: '50%',
        left: '50%',
        right: 'auto',
        bottom: 'auto',
        marginRight: '-50%',
        transform: 'translate(-50%, -50%)',
        backgroundColor: '#e3e7ed',
        color: '#0f172a',
        padding: '20px',
        boxShadow: '0 8px 20px rgba(0,0,0,0.15)',
        borderColor: '#d92b3c',
        borderRadius: '40px',
        paddingBottom: '40px'
      },
      overlay: {
        backgroundColor: 'rgba(0, 0, 0, 0.45)',
        backdropFilter: 'blur(5px)'
      }
    };
  }, [isDark]);
  const holidayBannerClass = isDark
    ? 'inline-flex items-center gap-3 rounded-token-xl border border-divider bg-gradient-to-r from-red-500/50 via-primary-400/40 to-emerald-400/40 px-5 py-3 text-base font-semibold text-ink shadow-xl shadow-red-900/40 backdrop-blur'
    : 'inline-flex items-center gap-3 rounded-token-xl border border-red-200 bg-gradient-to-r from-rose-50 via-primary-50 to-emerald-50 px-5 py-3 text-base font-semibold text-red-700 shadow-token-md';

  useEffect(() => {
    console.log('[Wallet] hook activeAccount', activeAccount);
  }, [activeAccount]);

  useEffect(() => {
    console.log('[Wallet] hook activeWallet', activeWallet);
  }, [activeWallet]);

  useEffect(() => {
    // Fetch the Mongo-driven DIMO toggle so ops can hide/show without redeploys.
    let cancelled = false;
    const controller = new AbortController();

    const loadToggle = async () => {
      try {
        const resp = await fetch('/api/config/dimo', { signal: controller.signal });
        if (!resp.ok) {
          throw new Error(`Failed to load DIMO config: ${resp.status}`);
        }
        const data = await resp.json();
        if (!cancelled) {
          setDimoEnabled(Boolean(data?.enabled));
        }
      } catch (error) {
        if (cancelled || controller.signal.aborted) return;
        console.warn('[Navbar] DIMO toggle fetch failed; hiding link', error);
        setDimoEnabled(false);
      }
    };

    void loadToggle();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  // Xmas: Track reduced motion to pause navbar Lottie animations when requested.
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setPrefersReducedMotion(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    const el = headerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') {
      return () => {
        root.style.removeProperty('--navbar-height');
      };
    }

    let rafId: number | null = null;
    let lastHeight = 0;

    const scheduleHeightUpdate = (nextHeight: number) => {
      if (rafId) {
        cancelAnimationFrame(rafId);
      }
      rafId = requestAnimationFrame(() => {
        if (nextHeight !== lastHeight) {
          root.style.setProperty('--navbar-height', `${nextHeight}px`);
          lastHeight = nextHeight;
        }
      });
    };

    const observer = new ResizeObserver(() => {
      try {
        const height = el.offsetHeight ?? 0;
        scheduleHeightUpdate(height);
      } catch (err) {
        console.warn('[Navbar] resize observer failed', err);
      }
    });

    observer.observe(el);
    scheduleHeightUpdate(el.offsetHeight ?? 0);

    return () => {
      if (rafId) {
        cancelAnimationFrame(rafId);
      }
      observer.disconnect();
      root.style.removeProperty('--navbar-height');
    };
  }, []);

  // Prevent body scroll when mobile drawer is open
  useEffect(() => {
    if (isDrawerOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isDrawerOpen]);

  const openBugModal = () => {
    if (bugSuccessCloseTimeoutRef.current) {
      clearTimeout(bugSuccessCloseTimeoutRef.current);
      bugSuccessCloseTimeoutRef.current = null;
    }
    setBugSubmitError(null);
    setBugSuccessMessage(null);
    setIsBugModalOpen(true);
  };

  const closeBugModal = () => {
    if (isSubmittingBug) {
      return;
    }
    if (bugSuccessCloseTimeoutRef.current) {
      clearTimeout(bugSuccessCloseTimeoutRef.current);
      bugSuccessCloseTimeoutRef.current = null;
    }
    setIsBugModalOpen(false);
    setBugSubmitError(null);
    setBugSuccessMessage(null);
  };

  const handleBugSubmit = async (payload: BugReportPayload) => {
    try {
      setIsSubmittingBug(true);
      setBugSubmitError(null);
      setBugSuccessMessage(null);

      const response = await fetch('/api/bug-report', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        let userMessage = 'We could not submit your bug report. Please try again.';
        try {
          const data = await response.json();
          if (data?.message) {
            userMessage = data.message;
          }
          if (data?.action) {
            userMessage = `${userMessage} — ${data.action}`;
          }
          if (response.status === 429 && typeof data?.retryAfterSeconds === 'number') {
            const minutes = Math.ceil(data.retryAfterSeconds / 60);
            userMessage = `${data.message ?? 'Bug report rate limit reached'}. Please try again in about ${minutes} minute${minutes === 1 ? '' : 's'}.`;
          }
        } catch (parseError) {
          console.error('Failed to parse bug report error response', parseError);
        }

        setBugSubmitError(userMessage);
        showToastError({
          heading: 'Bug report failed',
          message: userMessage,
          duration: 6000
        });
        return;
      }

      const successMessage = 'Your bug has been submitted. Our developer team will review it. Thank you for helping us improve!';
      setBugSuccessMessage(successMessage);
      showToastSuccess({
        heading: 'Bug report received',
        message: 'Thanks for helping us improve the dashboard!',
        duration: 5000
      });

      bugSuccessCloseTimeoutRef.current = setTimeout(() => {
        bugSuccessCloseTimeoutRef.current = null;
        closeBugModal();
      }, 2000);
    } catch (error) {
      console.error('Bug report submission failed', error);
      const fallback = 'We could not submit your bug report. Please try again.';
      setBugSubmitError(fallback);
      showToastError({
        heading: 'Bug report failed',
        message: fallback,
        duration: 6000
      });
    } finally {
      setIsSubmittingBug(false);
    }
  };

  const handleDisconnect = async () => {
    if (devMode) {
      setDevConnect(false);
      if (session) {
        await signOut({ redirect: false });
      }
    } else {
      if (activeWallet) {
        try {
          await activeWallet.disconnect();
        } catch (error) {
          console.error('Failed to disconnect wallet', error);
        }
      }
      if (session) {
        await signOut({ redirect: false });
      }
    }
  }

  useEffect(() => {
    if (devMode || !activeAccount) {
      if (!devMode) {
        setAlgoBalance('0.00');
        setFryBalance('0.00');
      }
      return;
    }

    const fetchBalances = async () => {
      try {
        const accountInfo = await algodClient.accountInformation(activeAccount.address).do();
        setAlgoBalance(((Number(accountInfo.amount ?? 0) / 1e6) || 0).toFixed(2));

        const assets = (accountInfo.assets ?? []) as Array<{
          ['asset-id']?: number | bigint | string;
          amount?: number | bigint | string;
        }>;
        const fryAsset = assets.find(
          (asset) => normalizeAssetId(asset['asset-id']) === normalizeAssetId(tFRY.id)
        );
        setFryBalance(
          fryAsset ? ((Number((fryAsset as any).amount ?? 0) / 1e6) || 0).toFixed(2) : '0.00'
        );
      } catch (error) {
        console.error('Error fetching balances:', error);
        setAlgoBalance('0.00');
        setFryBalance('0.00');
      }
    };

    fetchBalances();
  }, [activeAccount, algodClient]);

  const walletStateSignature = useMemo(() => {
    return wallets
      .map((wallet) => {
        const accounts =
          wallet.accounts?.map((acct) => acct.address).join('|') ?? '';
        return `${wallet.id}:${wallet.isConnected}:${wallet.isActive}:${accounts}`;
      })
      .join(';');
  }, [wallets]);

  useEffect(() => {
    console.log('[Wallet] state snapshot', wallets);
  }, [walletStateSignature, wallets]);

  useEffect(() => {
    console.debug('[Wallet] state snapshot', wallets);
  }, [walletStateSignature, wallets]);

  useEffect(() => {
    if (devMode) return;
    if (activeAccount) return;

    const connected = wallets.find(
      (wallet) =>
        wallet.isConnected &&
        !wallet.isActive &&
        (wallet.accounts?.length ?? 0) > 0
    );
    if (connected) {
      const first = connected.accounts?.[0];
      if (first?.address) {
        connected.setActiveAccount(first.address);
      }
    }
  }, [activeAccount, walletStateSignature, wallets]);



  useEffect(() => {
    if (!showNotifications) {
      return;
    }

    const handleOutsideClick = (event: MouseEvent) => {
      if (
        notificationTrayRef.current &&
        !notificationTrayRef.current.contains(event.target as Node)
      ) {
        setShowNotifications(false);
      }
    };

    document.addEventListener('mousedown', handleOutsideClick);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
    };
  }, [showNotifications]);

  useEffect(() => {
    if (notifications.length === 0) {
      setShowNotifications(false);
    }
  }, [notifications.length]);

  useEffect(() => {
    if (devMode) {
      if (devConnect && devAccount) {
        const addr = devAccount.addr.toString();
        setAddress(`${addr.slice(0, 6)}...${addr.slice(-4)}`);
      } else {
        setAddress('');
      }
      return;
    }

    const rawAddress = activeAccount?.address || activeWallet?.accounts?.[0]?.address;
    console.log('[Wallet] computed raw address', rawAddress);
    if (rawAddress) {
      setAddress(`${rawAddress.slice(0, 6)}...${rawAddress.slice(-4)}`);
    } else {
      setAddress('');
    }
  }, [activeAccount, activeWallet, devAccount, devConnect]);

  useEffect(() => {
    console.log('[Wallet] address state updated', address);
  }, [address]);

  // Countdown to next Friday 00:05 UTC
  useEffect(() => {
    const getNextFridayUnlockUTC = (now: Date) => {
      const day = now.getUTCDay(); // 0=Sun..5=Fri
      const thisFriday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
      const diffToFriday = (day + 7 - 5) % 7; // days since last Friday
      thisFriday.setUTCDate(thisFriday.getUTCDate() - diffToFriday);
      const thisUnlock = new Date(thisFriday.getTime() + 5 * 60 * 1000);
      if (now.getTime() >= thisUnlock.getTime()) {
        const nextFriday = new Date(thisFriday.getTime() + 7 * 24 * 60 * 60 * 1000);
        return new Date(nextFriday.getTime() + 5 * 60 * 1000);
      }
      return thisUnlock;
    };

    const update = () => {
      const now = new Date();
      const target = getNextFridayUnlockUTC(now);
      const diff = Math.max(0, target.getTime() - now.getTime());
      const days = Math.floor(diff / (24 * 60 * 60 * 1000));
      const hours = Math.floor((diff % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
      const mins = Math.floor((diff % (60 * 60 * 1000)) / (60 * 1000));
      const secs = Math.floor((diff % (60 * 1000)) / 1000);
      setCountdown(`${days}d ${hours}h ${mins}m ${secs}s`);
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, []);

  // (Ribbon moved to devices page)

  const navGroups = [
    {
      label: 'Devices',
      links: [
        { href: '/devices', label: 'My Devices' },
        { href: '/register', label: 'Register Device' },
        { href: '/my-keys', label: 'My Keys' },
        { href: '/my_registrations', label: 'My Registrations' },
        { href: '/new_registration', label: 'New Registration' },
        { href: '/device-credentials', label: 'Device Credentials' },
      ]
    },
    {
      label: 'Rewards',
      links: [
        { href: '/history', label: 'Reward History' },
        { href: '/rewards-claim', label: 'Claim Rewards' },
        { href: '/dimo', label: 'DIMO' },
        { href: '/buy/fry', label: 'Buy Tokens' },
        { href: '/convert', label: 'Token Conversion' },
      ]
    },
    {
      label: 'Events',
      links: [
        { href: '/events', label: 'Events & Competitions' },
      ]
    },
    {
      label: 'Help',
      links: [
        { href: '/help/credentials', label: 'Credentials Guide' },
      ]
    },
  ];

  const isLinkActive = (href: string) => {
    if (!pathname) return false;
    if (href === '/') {
      return pathname === href;
    }
    return pathname === href || pathname.startsWith(href);
  };

  return (
    <Fragment>
      <header
        ref={headerRef}
        className={`sticky top-0 left-0 right-0 z-[150] border-b backdrop-blur-md ${
          isDark
            ? 'border-divider bg-surface/95'
            : 'border-divider bg-surface/95'
        }`}
      >
        {/* Xmas: Centered "Merry Christmas" Lottie overlay, paused when reduced-motion is requested. */}
        {isChristmas && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center z-[151]" aria-hidden>
            <div className="w-full max-w-[170px] sm:max-w-[210px] max-h-[120px] opacity-80 mix-blend-screen drop-shadow-[0_12px_30px_rgba(0,0,0,0.25)]">
              <Lottie
                animationData={merryChristmasAnimation}
                loop={!prefersReducedMotion}
                autoplay={!prefersReducedMotion}
                rendererSettings={{ preserveAspectRatio: 'xMidYMid meet' }}
              />
            </div>
          </div>
        )}

        <div className="mx-auto flex w-full max-w-[1600px] items-center justify-between gap-4 px-4 sm:px-6 lg:px-10 py-3">
          {/* Left: Logo + wordmark */}
          <div className="flex items-center gap-3 relative z-[200]">
            <button
              type="button"
              onClick={() => setIsDrawerOpen(true)}
              className="md:hidden w-10 h-10 rounded-token-md border border-divider bg-surface-strong flex items-center justify-center text-ink-primary"
              aria-label="Open navigation menu"
            >
              <MenuIcon className="h-5 w-5" />
            </button>
            <Link
              href="https://frynetworks.com"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3"
            >
              <Image
                src={
                  isChristmas
                    ? isDark
                      ? fryLogoXmasDark
                      : fryLogoXmasLight
                    : isDark
                      ? fryLogo
                      : fryLogoLight
                }
                className="logo m-0 h-8 w-auto"
                alt="Fry logo"
                priority
              />
            </Link>
          </div>

          {/* Center: Nav groups with dropdowns (desktop only) */}
          <nav className="hidden md:flex items-center gap-1 relative z-[200]">
            <Link
              href="/"
              className={`px-3 py-2 text-sm font-medium rounded-token-md transition ${
                isLinkActive('/') ? 'text-primary-500 font-semibold' : 'text-ink-secondary hover:text-ink'
              }`}
            >
              Dashboard
            </Link>
            {navGroups.map((group) => {
              const hasActiveLink = group.links.some(l => isLinkActive(l.href));
              return (
                <div key={group.label} className="relative group">
                  <button
                    type="button"
                    className={`flex items-center gap-1 px-3 py-2 text-sm font-medium rounded-token-md transition ${
                      hasActiveLink
                        ? 'text-primary-500 font-semibold'
                        : 'text-ink-secondary hover:text-ink'
                    }`}
                  >
                    {group.label}
                    {group.label === 'Events' && hasActiveEvent && (
                      <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-error-500 opacity-75" />
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-error-500" />
                      </span>
                    )}
                    <svg className="h-3 w-3 transition-transform group-hover:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  <div className="absolute top-full left-0 mt-1 w-52 rounded-token-lg border border-divider bg-surface-elevated shadow-token-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-150 z-[210] py-1">
                    {group.links.map((link) => {
                      const active = isLinkActive(link.href);
                      return (
                        <Link
                          key={link.href}
                          href={link.href}
                          className={`block px-4 py-2 text-sm transition-colors ${
                            active
                              ? 'text-primary-500 font-semibold bg-primary-500/10'
                              : 'text-ink-secondary hover:text-ink hover:bg-primary-500/5'
                          }`}
                        >
                          {link.label}
                        </Link>
                      );
                    })}
                    {/* Bug report lives in Help dropdown */}
                    {group.label === 'Help' && (
                      <button
                        type="button"
                        onClick={openBugModal}
                        className="w-full text-left px-4 py-2 text-sm text-ink-secondary hover:text-ink hover:bg-primary-500/5 transition-colors"
                      >
                        Report a Bug
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </nav>

          {/* Right: Theme + Bell + Wallet (desktop only) */}
          <div className="hidden md:flex items-center gap-3 relative z-[200]">
            <ThemeControls />

            {/* Notification bell */}
            <div className="relative" ref={notificationTrayRef}>
              <button
                type="button"
                onClick={() => {
                  if (notifications.length === 0) {
                    return;
                  }
                  setShowNotifications(prev => !prev);
                }}
                aria-expanded={showNotifications}
                aria-label="View device notifications"
                title={
                  notifications.length > 0
                    ? `${notifications.length} notification${notifications.length === 1 ? '' : 's'}`
                    : 'No new notifications'
                }
                className={`flex h-10 w-10 items-center justify-center rounded-token-md border border-divider bg-surface-strong text-ink-secondary transition hover:text-ink hover:border-primary-500/40 relative disabled:cursor-not-allowed disabled:opacity-60`}
                disabled={notifications.length === 0}
              >
                <BellIcon className="h-5 w-5" aria-hidden="true" />
                {notifications.length > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 min-w-[1.3rem] rounded-full bg-primary-500 px-1.5 py-0.5 text-[10px] font-semibold text-ink">
                    {notifications.length}
                  </span>
                )}
              </button>
              {showNotifications && notifications.length > 0 && (
                <div
                  className={`overflow-hidden rounded-token-xl border shadow-2xl z-[240] ${
                    isDark
                      ? 'border-primary-500/40 bg-[#0A0A0F]/95 shadow-primary-900/40'
                      : 'border-divider bg-surface shadow-token-lg'
                  } fixed left-2 right-2 top-[calc(var(--navbar-height,64px)+12px)] sm:absolute sm:left-auto sm:right-0 sm:top-auto sm:mt-3 sm:w-[26rem] sm:max-w-[26rem] w-[calc(100vw-1rem)] max-h-[70vh]`}
                >
                  <div className="max-h-[70vh] overflow-y-auto px-5 py-5 scrollbar-thin scrollbar-thumb-primary-500/40 scrollbar-track-transparent">
                    <NotificationCenter
                      notifications={notifications}
                      onDismiss={dismiss}
                      isDark={isDark}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Wallet */}
            {!address || address.length === 0 ? (
              <Button
                className={
                  isDark
                    ? 'bg-transparent border-primary-500 hover:bg-primary-500 hover:border-primary-500 text-ink text-sm'
                    : 'bg-primary-500 text-ink border-primary-500 hover:bg-primary-600 hover:border-primary-600 text-sm'
                }
                onClick={() => {
                  if (devMode) {
                    setDevConnect(true);
                  } else {
                    setIsWalletModalOpen(true);
                  }
                }}
              >
                Connect Wallet
              </Button>
            ) : (
              <DownMenu address={address} disconnect={handleDisconnect} />
            )}
          </div>
        </div>
      </header>

      {/* Mobile Navigation Drawer */}
      {isDrawerOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-[290] bg-black/60"
            onClick={() => setIsDrawerOpen(false)}
            aria-hidden="true"
          />
          {/* Drawer panel */}
          <div className="fixed top-0 left-0 h-full w-[280px] z-[300] bg-surface-strong/98 border-r border-divider flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-divider">
              <span className="text-sm font-semibold text-ink-primary">Menu</span>
              <button
                type="button"
                onClick={() => setIsDrawerOpen(false)}
                className="w-10 h-10 rounded-token-md border border-divider bg-surface-elevated flex items-center justify-center text-ink-primary"
                aria-label="Close navigation menu"
              >
                <XIcon className="h-5 w-5" />
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto">
              <Link
                href="/"
                onClick={() => setIsDrawerOpen(false)}
                className={classNames(
                  'flex items-center min-h-[44px] px-4 py-2 text-sm font-medium text-ink-primary hover:bg-primary-500/10 transition',
                  isLinkActive('/') ? 'border-l-2 border-primary-500 bg-primary-500/5' : ''
                )}
              >
                Dashboard
              </Link>
              {navGroups.map((group) => (
                <div key={group.label}>
                  <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-ink-muted font-semibold px-4 pt-4 pb-1">
                    {group.label}
                    {group.label === 'Events' && hasActiveEvent && (
                      <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-error-500 opacity-75" />
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-error-500" />
                      </span>
                    )}
                  </div>
                  {group.links.map((link) => {
                    const active = isLinkActive(link.href);
                    return (
                      <Link
                        key={link.href}
                        href={link.href}
                        onClick={() => setIsDrawerOpen(false)}
                        className={classNames(
                          'flex items-center min-h-[44px] px-4 py-2 text-sm font-medium text-ink-primary hover:bg-primary-500/10 transition',
                          active ? 'border-l-2 border-primary-500 bg-primary-500/5' : ''
                        )}
                      >
                        {link.label}
                      </Link>
                    );
                  })}
                  {group.label === 'Help' && (
                    <button
                      type="button"
                      onClick={() => {
                        setIsDrawerOpen(false);
                        openBugModal();
                      }}
                      className="w-full text-left flex items-center min-h-[44px] px-4 py-2 text-sm font-medium text-ink-primary hover:bg-primary-500/10 transition"
                    >
                      Report a Bug
                    </button>
                  )}
                </div>
              ))}
            </nav>
            {/* Wallet section */}
            <div className="border-t border-divider px-4 py-3">
              {address ? (
                <div className="flex flex-col gap-2">
                  <span className="font-mono text-xs text-ink-secondary truncate">
                    {address}
                  </span>
                  <Button
                    className={
                      isDark
                        ? 'bg-transparent border-primary-500 hover:bg-primary-500 hover:border-primary-500 text-ink text-sm'
                        : 'bg-primary-500 text-ink border-primary-500 hover:bg-primary-600 hover:border-primary-600 text-sm'
                    }
                    onClick={handleDisconnect}
                  >
                    Disconnect
                  </Button>
                </div>
              ) : (
                <Button
                  className={
                    isDark
                      ? 'bg-transparent border-primary-500 hover:bg-primary-500 hover:border-primary-500 text-ink text-sm w-full'
                      : 'bg-primary-500 text-ink border-primary-500 hover:bg-primary-600 hover:border-primary-600 text-sm w-full'
                  }
                  onClick={() => {
                    setIsDrawerOpen(false);
                    setIsWalletModalOpen(true);
                  }}
                >
                  Connect Wallet
                </Button>
              )}
            </div>
          </div>
        </>
      )}

      <BugReportModal
        isOpen={isBugModalOpen}
        onRequestClose={closeBugModal}
        onSubmit={handleBugSubmit}
        isSubmitting={isSubmittingBug}
        errorMessage={bugSubmitError}
        successMessage={bugSuccessMessage}
      />

      <Modal
        isOpen={isWalletModalOpen}
        style={modalStyles as any}
        contentLabel="Connect Wallet"
      >
        <div className="max-w-md sm:w-[415px] w-[320px]">
          <div className="flex justify-end">
            <Button
              className={
                isDark
                  ? 'text-ink bg-transparent p-2 right-2 rounded border-transparent hover:bg-primary-500 hover:border-transparent hover:rounded hover:bg-opacity-10'
                  : 'text-ink-primary bg-transparent p-2 right-2 rounded border-transparent hover:bg-primary-500/10 hover:border-transparent hover:rounded'
              }
              onClick={() => setIsWalletModalOpen(false)}
            >
              <svg
                fillRule="evenodd"
                viewBox="64 64 896 896"
                focusable="false"
                data-icon="close"
                width="1em"
                height="1em"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M799.86 166.31c.02 0 .04.02.08.06l57.69 57.7c.04.03.05.05.06.08a.12.12 0 010 .06c0 .03-.02.05-.06.09L569.93 512l287.7 287.7c.04.04.05.06.06.09a.12.12 0 010 .07c0 .02-.02.04-.06.08l-57.7 57.69c-.03.04-.05.05-.07.06a.12.12 0 01-.07 0c-.03 0-.05-.02-.09-.06L512 569.93l-287.7 287.7c-.04.04-.06.05-.09.06a.12.12 0 01-.07 0c-.02 0-.04-.02-.08-.06l-57.69-57.7c-.04-.03-.05.05-.06-.07a.12.12 0 010-.07c0-.03.02-.05.06-.09L454.07 512l-287.7-287.7c-.04-.04-.05-.06-.06-.09a.12.12 0 010-.07c0-.02.02-.04.06-.08l57.7-57.69c.03-.04.05-.05.07-.06a.12.12 0 01.07 0c.03 0 .05.02.09.06L512 454.07l287.7-287.7c.04-.04.06-.05.09-.06a.12.12 0 01.07 0z"></path>
              </svg>
            </Button>
          </div>

          <Flex flexDirection="col">
            <Title className="text-primary-500 text-2xl">CONNECT TO WALLET</Title>
            <Image
              src={isDark ? fryLogo : fryLogoLight}
              className="logo_wallet mt-4 m-auto"
              alt="Fry logo"
              priority
            />
            <div className="h-0.5 w-full bg-gradient-to-r from-transparent via-primary-500 to-transparent opacity-70"></div>
          </Flex>

          <Flex flexDirection="col" className="w-full gap-5 mt-10">
            {wallets.map((wallet, index) => {
              const alreadyConnected = wallet.isActive && (wallet.accounts?.length ?? 0) > 0;
              return (
                <div
                  key={`wallet ${index}`}
                  className={`flex flex-row h-12 rounded-token-md gap-8 w-full items-center px-3 py-8 border-2 ${
                    isDark
                      ? 'border-primary-500 text-ink-primary hover:bg-primary-500/10'
                      : 'border-primary-400 text-ink-primary hover:bg-primary-500/10'
                  }`}
                  onClick={async () => {
                    try {
                      console.log('[Wallet] connect requested', wallet.id);
                      if (alreadyConnected) {
                        setIsWalletModalOpen(false);
                        return;
                      }

                      await runWithWalletRequest(async () => {
                        if (wallet.id === 'pera') {
                          try {
                            console.log('[Wallet] attempting pre-disconnect for Pera');
                            await wallet.disconnect();
                          } catch (discError) {
                            console.warn('[Wallet] pre-disconnect failed', discError);
                          }
                        }
                        const accounts = await wallet.connect();
                        console.log('[Wallet] connect result', wallet.id, accounts);
                        if (wallet.setActive) {
                          wallet.setActive();
                        }
                        const firstAccount =
                          accounts?.[0] ?? wallet.accounts?.[0];
                        if (firstAccount?.address) {
                          wallet.setActiveAccount(firstAccount.address);
                        }
                      });

                      setIsWalletModalOpen(false);
                    } catch (error) {
                      // Prevent overlapping wallet prompts from confusing the user.
                      if (error instanceof WalletRequestInFlightError) {
                        showToastInfo({
                          heading: 'Wallet Request In Progress',
                          message: 'Finish or cancel the active wallet prompt before connecting another wallet.'
                        });
                        return;
                      }
                      const typedError = error as {
                        name?: string;
                        data?: { type?: string };
                        cancelled?: boolean;
                        message?: string;
                        stack?: string;
                      } | undefined;

                      const rawMessage =
                        typedError?.message ||
                        (typeof error === 'string' ? error : '') ||
                        (error instanceof Error ? error.message : '');
                      const isPeraAccountBlocked =
                        typeof rawMessage === 'string' &&
                        rawMessage.toLowerCase().includes('requested account cannot be connected');
                      const errorMeta = {
                        walletId: wallet.id,
                        walletName: wallet.metadata?.name,
                        errorName: typedError?.name ?? (error instanceof Error ? error.name : undefined),
                        errorMessage: rawMessage || undefined,
                        errorData: typedError?.data,
                        errorStack: typedError?.stack ?? (error instanceof Error ? error.stack : undefined),
                        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined
                      };

                      const isPeraSessionConflict =
                        typedError?.name === 'PeraWalletConnectError' &&
                        typedError?.data?.type === 'SESSION_CONNECT';
                      const isWalletModalClosed =
                        ((typedError?.name === 'PeraWalletConnectError' ||
                          typedError?.name === 'DeflyWalletConnectError') &&
                          typedError?.data?.type === 'CONNECT_MODAL_CLOSED') ||
                        typedError?.cancelled;

                      if (isPeraSessionConflict) {
                        console.warn('Detected existing Pera session. Resetting before retry.');
                        try {
                          await wallet.disconnect();
                        } catch (disconnectError) {
                          console.error('Failed to clear stale wallet session', disconnectError);
                        }
                        showToastInfo({
                          heading: 'Wallet session reset',
                          message: 'We cleared an existing wallet session. Please reconnect.',
                          duration: 5000
                        });
                        return;
                      }

                      if (isPeraAccountBlocked) {
                        console.warn('Pera rejected account connect request', errorMeta);
                        try {
                          await wallet.disconnect();
                        } catch (disconnectError) {
                          console.error('Failed to clear wallet session after Pera rejection', disconnectError);
                        }
                        showToastError({
                          heading: 'Wallet connection failed',
                          message:
                            'Pera reported the requested account cannot be connected. Please open Pera, unlock the account, and try again. If it persists, remove Fry Networks in Pera → WalletConnect and retry.',
                          duration: 7000,
                          issueType: 'WALLET_PERA_ACCOUNT_BLOCKED',
                          part: 'navbar.wallet.connect',
                          metadata: errorMeta
                        });
                        return;
                      }

                      if (isWalletModalClosed) {
                        showToastInfo({
                          heading: 'Wallet request cancelled',
                          duration: 4000
                        });
                        return;
                      }

                      console.error('Failed to connect wallet:', error);
                      showToastError({
                        heading: 'Wallet connection failed',
                        message: 'We could not connect to your wallet. Please try again.',
                        duration: 6000,
                        issueType: 'WALLET_CONNECTION_ERROR',
                        part: 'navbar.wallet.connect',
                        metadata: errorMeta
                      });
                    }
                  }}
                >
                <Image
                  src={wallet.metadata.icon}
                  alt={`${wallet.metadata.name} logo`}
                  width={32}
                  height={32}
                  className="object-contain align-middle"
                />
                <div className="cursor-default">
                  {wallet.metadata.name} Wallet
                  {alreadyConnected && <span className="ml-2 text-xs text-primary-300">Connected</span>}
                </div>
              </div>
            );
            })}
          </Flex>
        </div>
      </Modal>
      {/* Totals ribbon moved to devices page to appear under hero section */}
    </Fragment>
  );
};
