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
import { useRouter } from 'next/router';
import DownMenu from './MenuBox';
import { normalizeAssetId, tFRY } from '../lib/utils';
import { BellIcon, HomeIcon, CalendarIcon } from '@heroicons/react/outline';
import NotificationCenter from './NotificationCenter';
import { useNotifications } from '../app/notificationcontext';
import { RiBugLine } from '@remixicon/react';
import BugReportModal from './BugReportModal';
import DiscordLinkSection from './DiscordLinkSection';
import { useToastContext } from '../hooks/ToastContext';
import { runWithWalletRequest, WalletRequestInFlightError } from '../lib/wallet/requestCoordinator.client';
import ThemeControls from './ThemeControls';
import dimoIcon from '../lib/dimo/Dimo.png';
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
  const [isBugModalOpen, setIsBugModalOpen] = useState(false);
  const [dimoEnabled, setDimoEnabled] = useState<boolean | null>(null);
  const toast = useToastContext();
  const { error: showToastError, info: showToastInfo } = toast;

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
  const actionButtonClass = isDark
    ? 'flex h-11 w-11 items-center justify-center rounded-full border border-red-500/60 bg-red-500/15 text-red-200 shadow-md backdrop-blur transition hover:bg-red-500/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400/80'
    : 'flex h-11 w-11 items-center justify-center rounded-full border border-red-400 bg-red-50 text-red-700 shadow-md transition hover:bg-red-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-300';
  const pillLinkClass = isDark
    ? 'flex h-11 items-center rounded-full border border-red-500/60 bg-red-500/15 px-4 text-sm font-semibold text-red-100 shadow-md backdrop-blur transition hover:bg-red-500/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400/80'
    : 'flex h-11 items-center rounded-full border border-red-400 bg-red-50 px-4 text-sm font-semibold text-red-700 shadow-sm transition hover:bg-red-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-300';
  const holidayBannerClass = isDark
    ? 'inline-flex items-center gap-3 rounded-2xl border border-white/10 bg-gradient-to-r from-red-500/50 via-amber-400/40 to-emerald-400/40 px-5 py-3 text-base font-semibold text-white shadow-xl shadow-red-900/40 backdrop-blur'
    : 'inline-flex items-center gap-3 rounded-2xl border border-red-200 bg-gradient-to-r from-rose-50 via-amber-50 to-emerald-50 px-5 py-3 text-base font-semibold text-red-700 shadow-md';
  const showDimoLink = dimoEnabled === true; // Only surface DIMO when the Mongo toggle is enabled.

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

  const openBugModal = () => {
    setIsBugModalOpen(true);
  };

  const closeBugModal = () => {
    setIsBugModalOpen(false);
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
    if (router.pathname === '/') {
      return;
    }
    if (status === 'loading') {
      return;
    }
    if (!session || !session.user) {
      router.push('/');
    }
  }, [router.pathname, session, status, router]);

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
        setAddress(`${addr.slice(0, 4)}...${addr.slice(-4)}`);
      } else {
        setAddress('');
      }
      return;
    }

    const rawAddress = activeAccount?.address || activeWallet?.accounts?.[0]?.address;
    console.log('[Wallet] computed raw address', rawAddress);
    // Guard against truncated addresses from mobile wallets
    if (rawAddress && rawAddress.length !== 58) {
      console.error('[Wallet] Invalid address length:', rawAddress.length, 'expected 58. Skipping auth.');
      return;
    }
    if (rawAddress) {
      setAddress(`${rawAddress.slice(0, 4)}...${rawAddress.slice(-4)}`);
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

  return (
    <Fragment>
      <header
        ref={headerRef}
        className={`sticky top-0 left-0 right-0 z-[150] border-b backdrop-blur relative overflow-visible ${
          isDark
            ? 'border-white/10 bg-black/95'
            : isChristmas
              ? 'border-transparent bg-[#e5e9ed] text-slate-900'
              : 'border-transparent bg-[#e5e9ed] text-slate-900'
        }`}
      >
        {/* Xmas: Centered “Merry Christmas” Lottie overlay, paused when reduced-motion is requested. */}
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

        <div className="mx-auto flex w-full max-w-[1600px] flex-wrap items-center justify-between gap-2 px-3 py-2 sm:flex-nowrap sm:gap-4 sm:px-6 lg:px-10">
          <div className="flex items-center relative">
            <Link
              href="https://frynetworks.com"
              target="_blank"
              rel="noopener noreferrer"
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
                className="logo m-0"
                alt="Fry logo"
                priority
              />
            </Link>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2 sm:flex-nowrap sm:gap-3 relative z-[200]">
            <ThemeControls />
            {!address || address.length === 0 ? (
              <Button
                className={
                  isDark
                    ? 'bg-transparent border-red-600 hover:bg-red-600 hover:border-red-600 text-white'
                    : 'bg-red-600 text-white border-red-600 hover:bg-red-700 hover:border-red-700'
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
              <Fragment>
                <DownMenu address={address} disconnect={handleDisconnect} />
                <DiscordLinkSection walletAddress={address} />
                <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap sm:gap-2.5">
                  {showDimoLink && (
                    <Link
                      href="/dimo"
                      className={
                        isDark
                          ? 'flex h-11 w-11 items-center justify-center text-red-100 transition hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400/80'
                          : 'flex h-11 w-11 items-center justify-center text-red-700 transition hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-300'
                      }
                      aria-label="Login with DIMO"
                      title="DIMO login & eligibility"
                    >
                      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#e60000] overflow-hidden">
                        <Image
                          src={dimoIcon}
                          alt="DIMO"
                          width={36}
                          height={36}
                          className="h-9 w-9"
                          priority={false}
                        />
                      </div>
                    </Link>
                  )}
                  <Link
                    href="/devices"
                    className={actionButtonClass}
                    aria-label="Go to devices"
                    title="Devices home"
                  >
                    <HomeIcon className="h-5 w-5" />
                  </Link>
                  <Link
                    href="/events"
                    className={actionButtonClass}
                    aria-label="Go to events"
                    title="Events"
                  >
                    <CalendarIcon className="h-5 w-5" />
                  </Link>
                  <button
                    type="button"
                    onClick={openBugModal}
                    aria-label="Report a bug"
                    className={actionButtonClass}
                    title="Report a bug"
                  >
                    <RiBugLine className="h-5 w-5" />
                  </button>
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
                      className={`${actionButtonClass} relative disabled:cursor-not-allowed disabled:opacity-60`}
                      disabled={notifications.length === 0}
                    >
                      <BellIcon className="h-5 w-5" aria-hidden="true" />
                      {notifications.length > 0 && (
                        <span className="absolute -top-1.5 -right-1.5 min-w-[1.3rem] rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                          {notifications.length}
                        </span>
                      )}
                    </button>
                    {showNotifications && notifications.length > 0 && (
                      <div
                        // Mobile: use a fixed overlay anchored below the navbar so it never clips or forces layout; desktop keeps the anchored tray.
                        className={`overflow-hidden rounded-2xl border shadow-2xl z-[240] ${
                          isDark
                            ? 'border-red-500/40 bg-[#0b0b0f]/95 shadow-red-900/40'
                            : 'border-red-200 bg-white shadow-red-200/60'
                        } fixed left-2 right-2 top-[calc(var(--navbar-height,64px)+12px)] sm:absolute sm:left-auto sm:right-0 sm:top-auto sm:mt-3 sm:w-[26rem] sm:max-w-[26rem] w-[calc(100vw-1rem)] max-h-[70vh]`}
                      >
                        <div className="max-h-[70vh] overflow-y-auto px-5 py-5 scrollbar-thin scrollbar-thumb-red-500/40 scrollbar-track-transparent">
                          <NotificationCenter
                            notifications={notifications}
                            onDismiss={dismiss}
                            isDark={isDark}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </Fragment>
            )}
          </div>
        </div>
      </header>

      <BugReportModal
        isOpen={isBugModalOpen}
        onClose={closeBugModal}
        walletAddress={address}
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
                  ? 'text-white bg-transparent p-2 right-2 rounded border-transparent hover:bg-red-600 hover:border-transparent hover:rounded hover:bg-opacity-10'
                  : 'text-slate-900 bg-transparent p-2 right-2 rounded border-transparent hover:bg-red-100 hover:border-transparent hover:rounded'
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
                <path d="M799.86 166.31c.02 0 .04.02.08.06l57.69 57.7c.04.03.05.05.06.08a.12.12 0 010 .06c0 .03-.02.05-.06.09L569.93 512l287.7 287.7c.04.04.05.06.06.09a.12.12 0 010 .07c0 .02-.02.04-.06.08l-57.7 57.69c-.03.04-.05.05-.07.06a.12.12 0 01-.07 0c-.03 0-.05-.02-.09-.06L512 569.93l-287.7 287.7c-.04.04-.06.05-.09.06a.12.12 0 01-.07 0c-.02 0-.04-.02-.08-.06l-57.69-57.7c-.04-.03-.05-.05-.06-.07a.12.12 0 010-.07c0-.03.02-.05.06-.09L454.07 512l-287.7-287.7c-.04-.04-.05-.06-.06-.09a.12.12 0 010-.07c0-.02.02-.04.06-.08l57.7-57.69c.03-.04.05-.05.07-.06a.12.12 0 01.07 0c.03 0 .05.02.09.06L512 454.07l287.7-287.7c.04-.04.06-.05.09-.06a.12.12 0 01.07 0z"></path>
              </svg>
            </Button>
          </div>

          <Flex flexDirection="col">
            <Title className={`${isDark ? 'text-red-600' : 'text-red-700'} text-2xl`}>CONNECT TO WALLET</Title>
            <Image
              src={isDark ? fryLogo : fryLogoLight}
              className="logo_wallet mt-4 m-auto"
              alt="Fry logo"
              priority
            />
            <div className={`h-0.5 w-full bg-gradient-to-r from-transparent via-red-500 to-transparent ${isDark ? '' : 'opacity-70'}`}></div>
          </Flex>

          <Flex flexDirection="col" className="w-full gap-5 mt-10">
            {wallets.map((wallet, index) => {
              const alreadyConnected = wallet.isActive && (wallet.accounts?.length ?? 0) > 0;
              return (
                <div
                  key={`wallet ${index}`}
                  className={`flex flex-row h-12 rounded-lg gap-8 w-full items-center px-3 py-8 border-2 ${
                    isDark
                      ? 'border-red-600 text-white hover:bg-red-600 hover:bg-opacity-10'
                      : 'border-red-400 text-slate-900 hover:bg-red-50'
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
                  {alreadyConnected && <span className="ml-2 text-xs text-red-200">Connected</span>}
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
