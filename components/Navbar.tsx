'use client';

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
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
import { normalizeAssetId } from '../lib/utils';
import { BellIcon, HomeIcon } from '@heroicons/react/outline';
import NotificationCenter from './NotificationCenter';
import { useNotifications } from '../app/notificationcontext';
import { RiBugLine } from '@remixicon/react';
import BugReportModal, { BugReportPayload } from './BugReportModal';
import { useToastContext } from '../hooks/ToastContext';

function classNames(...classes: string[]) {
  return classes.filter(Boolean).join(' ');
}

const devMode =
  process.env.NEXT_PUBLIC_DEV_MODE &&
  process.env.NEXT_PUBLIC_DEV_MODE === 'true';

export default function Navbar() {
  const pathname = usePathname();
  const { data: session, status } = useSession();
  const { wallets, activeAccount, algodClient } = useWallet();
  const activeWallet = wallets.find(w => w.isActive);
  const { devConnect, devAccount, algodClient: devAlgodClient, setDevConnect } = useDevWallet();
  const [isWalletModalOpen, setIsWalletModalOpen] = useState(false);
  const [address, setAddress] = useState('');
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
  const toast = useToastContext();
  const { success: showToastSuccess, error: showToastError, info: showToastInfo } = toast;

  useEffect(() => {
    const root = document.documentElement;

    const updateHeight = () => {
      const height = headerRef.current?.offsetHeight ?? 0;
      root.style.setProperty('--navbar-height', `${height}px`);
    };

    updateHeight();

    const el = headerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') {
      return () => {
        root.style.removeProperty('--navbar-height');
      };
    }

    const observer = new ResizeObserver(() => updateHeight());
    observer.observe(el);

    return () => {
      observer.disconnect();
      root.style.removeProperty('--navbar-height');
    };
  }, []);

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
          (asset) => normalizeAssetId(asset['asset-id']) === 924268058
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
  }, [activeAccount, algodClient, devMode]);

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
  }, [
    devMode,
    activeAccount,
    walletStateSignature,
    wallets
  ]);

  useEffect(() => {
    if ((router.pathname !== '/' && !session) || !session?.user) {
      router.push('/');
    }
  }, [router.pathname, session, activeAccount]);

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
    if (rawAddress) {
      setAddress(`${rawAddress.slice(0, 4)}...${rawAddress.slice(-4)}`);
    } else {
      setAddress('');
    }
  }, [activeAccount, activeWallet, devAccount, devConnect, devMode]);

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
        className="sticky top-0 left-0 right-0 z-[150] border-b border-white/10 bg-[#08080b]/90 backdrop-blur"
      >
        <div className="mx-auto flex h-24 w-full max-w-[1600px] items-center justify-between px-3 sm:px-20">
          <div className="flex">
            <Link
              href="https://frynetworks.com"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Image src={fryLogo} className="logo" alt="Fry logo" priority />
            </Link>
          </div>

          <div className="flex items-center gap-3">
            {!address || address.length === 0 ? (
              <Button
                className="bg-transparent border-red-600 hover:bg-red-600 hover:border-red-600"
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
                <div className="flex items-center gap-2">
                  <Link
                    href="/devices"
                    className="flex h-11 w-11 items-center justify-center rounded-full border border-red-500/60 bg-red-500/15 text-red-200 shadow-md backdrop-blur transition hover:bg-red-500/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400/80"
                    aria-label="Go to devices"
                  >
                    <HomeIcon className="h-5 w-5" />
                  </Link>
                  <button
                    type="button"
                    onClick={openBugModal}
                    aria-label="Report a bug"
                    className="flex h-11 w-11 items-center justify-center rounded-full border border-red-500/60 bg-red-500/15 text-red-200 shadow-md backdrop-blur transition hover:bg-red-500/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400/80"
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
                      className="relative flex h-11 w-11 items-center justify-center rounded-full border border-red-500/60 bg-red-500/15 text-red-200 shadow-md backdrop-blur transition hover:bg-red-500/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400/80 disabled:cursor-not-allowed disabled:opacity-60"
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
                      <div className="absolute right-0 mt-3 max-h-[70vh] w-[26rem] max-w-[calc(100vw-1rem)] overflow-hidden rounded-2xl border border-red-500/40 bg-[#0b0b0f]/95 shadow-2xl shadow-red-900/40 z-[200]">
                        <div className="max-h-[70vh] overflow-y-auto px-5 py-5 scrollbar-thin scrollbar-thumb-red-500/40 scrollbar-track-transparent">
                          <NotificationCenter
                            notifications={notifications}
                            onDismiss={dismiss}
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
        onRequestClose={closeBugModal}
        onSubmit={handleBugSubmit}
        isSubmitting={isSubmittingBug}
        errorMessage={bugSubmitError}
        successMessage={bugSuccessMessage}
      />

      <Modal
        isOpen={isWalletModalOpen}
        style={customStyles}
        contentLabel="Connect Wallet"
      >
        <div className="max-w-md sm:w-[415px] w-[320px]">
          <div className="flex justify-end">
            <Button
              className="text-white bg-transparent p-2 right-2 rounded border-transparent hover:bg-red-600 hover:border-transparent hover:rounded hover:bg-opacity-10"
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
            <Title className="text-red-600 text-2xl">CONNECT TO WALLET</Title>
            <Image
              src={fryLogo}
              className="logo_wallet mt-4 m-auto"
              alt="Fry logo"
              priority
            />
            <div className="h-0.5 w-full bg-gradient-to-r from-transparent via-red-500 to-transparent"></div>
          </Flex>

          <Flex flexDirection="col" className="w-full gap-5 mt-10">
            {wallets.map((wallet, index) => {
              const alreadyConnected = wallet.isActive && (wallet.accounts?.length ?? 0) > 0;
              return (
              <div
                key={`wallet ${index}`}
                className="flex flex-row border-2 border-red-600 h-12 rounded-lg text-white gap-8 w-full items-center px-3 py-8 hover:bg-red-600 hover:bg-opacity-10"
                onClick={async () => {
                  try {
                    if (alreadyConnected) {
                      setIsWalletModalOpen(false);
                      return;
                    }
                    const accounts = await wallet.connect();
                    const firstAccount =
                      accounts?.[0] ?? wallet.accounts?.[0];
                    if (firstAccount?.address) {
                      wallet.setActiveAccount(firstAccount.address);
                    }
                    setIsWalletModalOpen(false);
                  } catch (error) {
                    const typedError = error as {
                      name?: string;
                      data?: { type?: string };
                      cancelled?: boolean;
                    } | undefined;

                    const isPeraSessionConflict =
                      typedError?.name === 'PeraWalletConnectError' &&
                      typedError?.data?.type === 'SESSION_CONNECT';

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

                    if (typedError?.cancelled) {
                      showToastInfo({
                        heading: 'Wallet request cancelled',
                        message: 'No changes were made to your connection.',
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
                      part: 'navbar.wallet.connect'
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

const customStyles = {
  content: {
    top: '50%',
    left: '50%',
    right: 'auto',
    bottom: 'auto',
    marginRight: '-50%',
    transform: 'translate(-50%, -50%)',
    backgroundColor: 'black', // Example background color
    color: '#6b7280',
    padding: '20px',
    boxShadow: '0 4px 8px 0 rgba(0,0,0,0.2)',
    borderColor: '#D00000',
    borderRadius: '40px',
    paddingBottom: '40px'
  },
  overlay: {
    backgroundColor: 'rgba(0, 0, 0, 0.75)', // Example overlay color
    backdropFilter: 'blur(5px)'
  }
};
