import Head from 'next/head';
import { NextPage } from 'next';
import { AppProps } from 'next/app';
import '../app/globals.css';
import { useSession, SessionProvider, getSession, signOut } from 'next-auth/react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import Modal from 'react-modal';
import type { WalletManager } from '@txnlab/use-wallet';
import { WalletProvider } from '@txnlab/use-wallet-react';
import Navbar from '../components/Navbar';
import AnnouncementBanner from '../components/AnnouncementBanner';
import { ModalProvider } from '../app/modalcontext';
import { DevWalletProvider } from '../hooks/UseDevWallet';
import { ToastProvider } from '../hooks/ToastContext';
import { NotificationProvider } from '../app/notificationcontext';
import { ThemeProvider } from 'next-themes';
import 'leaflet/dist/leaflet.css';
import { useRouter } from 'next/router';
import { getClientToken } from '../lib/clientToken';
import { FingerprintProvider, useFingerprintReady, useRegisterFingerprintRefresh } from '../app/fingerprintcontext';
import type { MySession } from './api/auth/[...nextauth]';
import { useClientErrorLogger } from '../lib/hooks/useClientErrorLogger';
import { useToastContext } from '../hooks/ToastContext';
import { useWallet } from '@txnlab/use-wallet-react';
import { createWalletManager, disconnectAllWallets, subscribeToManagerReadyFallback } from '../lib/wallet/manager';
import { installHistoryReplaceThrottle } from '../lib/historyThrottle';
import PeraInAppBrowserBlocker from '../components/PeraInAppBrowserBlocker';
import PageErrorBoundary from '../components/PageErrorBoundary';
import BrowserLockerWarning from '../components/BrowserLockerWarning';
import SeasonalThemeProvider from '../app/seasonal-theme/SeasonalThemeProvider';
import HolidayChrome from '../components/HolidayChrome';
import WalletGate from '../components/WalletGate';
import { JetBrains_Mono, Outfit } from 'next/font/google';

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
});

const outfit = Outfit({
  subsets: ['latin'],
  variable: '--font-body',
  display: 'swap',
});

interface MyAppProps extends AppProps {
  Component: NextPage;
}

interface ProtectedComponentProps {
  Component: NextPage;
  pageProps: any;
}

const devMode =
  process.env.NEXT_PUBLIC_DEV_MODE &&
  process.env.NEXT_PUBLIC_DEV_MODE === 'true';

export default function MyApp({ Component, pageProps }: MyAppProps) {
  const [walletManager, setWalletManager] = useState<WalletManager | null>(null);
  const [walletInitError, setWalletInitError] = useState<Error | null>(null);
  const router = useRouter();

  const notificationsEnabled = router.pathname === '/devices' || router.pathname === '/history' || router.pathname === '/dimo';
  const showAnnouncementBanner = notificationsEnabled;

  useEffect(() => {
    let mounted = true;
    try {
      const manager = createWalletManager();
      setWalletManager(manager);

      // Monkey-patch resumeSessions with timeout so WalletProvider's internal call is protected
      const originalResume = manager.resumeSessions.bind(manager);
      manager.resumeSessions = async () => {
        try {
          await Promise.race([
            originalResume(),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('resumeSessions timeout')), 8000)
            )
          ]);
        } catch (e) {
          console.warn('[wallet] resumeSessions timed out or failed, forcing ready', e);
        }
        // Force ready regardless of timeout or success
        manager.store.setState((state) => ({ ...state, managerStatus: 'ready' }));
      };

      const unsubscribeReadyFallback = subscribeToManagerReadyFallback(manager);

      (async () => {
        try {
          await getClientToken();
        } catch (error) {
          console.error('[ClientToken] Failed to warm token cache', error);
        }
      })();

      Modal.setAppElement?.('#__next');

      return () => {
        mounted = false;
        unsubscribeReadyFallback();
        void disconnectAllWallets(manager);
      };
    } catch (err) {
      console.error('[WalletManager] Initialization failed', err);
      setWalletInitError(err instanceof Error ? err : new Error(String(err)));
    }
  }, []);

  useEffect(() => {
    installHistoryReplaceThrottle();
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (!walletManager && !walletInitError) {
        setWalletInitError(new Error('Wallet initialization timed out after 10 seconds'));
      }
    }, 10000);
    return () => clearTimeout(timer);
  }, [walletManager, walletInitError]);

  useEffect(() => {
    if (!showAnnouncementBanner) {
      document.documentElement.style.setProperty('--announcement-banner-height', '0px');
    }
  }, [showAnnouncementBanner]);

  if (!walletManager && !walletInitError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!walletManager && walletInitError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface p-4">
        <div className="bg-surface-elevated border border-divider rounded-xl p-8 max-w-md w-full text-center space-y-4">
          <h1 className="text-xl font-semibold text-heading">Wallet connection unavailable</h1>
          <p className="text-sm text-muted">
            Wallet initialization failed. This is usually caused by corrupted session data stored in your browser.
          </p>
          <div className="space-y-2 pt-2">
            <button
              onClick={() => window.location.reload()}
              className="w-full px-4 py-2 rounded-lg bg-primary text-white font-medium hover:bg-primary/90 transition-colors"
            >
              Retry
            </button>
            <button
              onClick={() => {
                localStorage.removeItem('pera-wallet-session');
                localStorage.removeItem('defly-wallet-session');
                window.location.reload();
              }}
              className="w-full px-4 py-2 rounded-lg border border-divider text-muted hover:bg-surface-hover transition-colors"
            >
              Clear wallet data &amp; retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <ThemeProvider attribute="class" enableSystem defaultTheme="dark">
      <SeasonalThemeProvider>
        <ModalProvider>
          <WalletProvider manager={walletManager!}>
            <SessionProvider session={pageProps.session}>
              <FingerprintProvider>
                <DevWalletProvider>
                  <ToastProvider>
                    <NotificationProvider isEnabled={notificationsEnabled}>
                      <Navbar />
                      <HolidayChrome />
                      <div className={`${jetbrainsMono.variable} ${outfit.variable} relative flex flex-col`}>
                        <PeraInAppBrowserBlocker />
                        <BrowserLockerWarning />
                        {showAnnouncementBanner && <AnnouncementBanner />}
                        <Head>
                          <title>Fry Networks Dashboard</title>
                          <meta
                            name="description"
                            content="Manage Fry Networks devices, rewards, staking, and credentials."
                          />
                          <meta name="application-name" content="Fry Networks Dashboard" />
                          <meta property="og:title" content="Fry Networks Dashboard" />
                          <meta property="og:description" content="Manage Fry Networks devices, rewards, staking, and credentials." />
                          <meta property="og:image" content="https://static.wixstatic.com/media/b2ad32_3c66813c76c34794879d1a284bc90843~mv2.png" />
                          <meta property="og:url" content="https://dashboard.frynetworks.com" />
                          <meta property="og:type" content="website" />
                          <link
                            rel="icon"
                            href={process.env.NEXT_PUBLIC_DAPP_ICON_URL || 'https://static.wixstatic.com/media/b2ad32_3c66813c76c34794879d1a284bc90843~mv2.png'}
                          />
                        </Head>
                        <div
                          id="main"
                          className="w-full min-h-screen"
                        >
                          <PageErrorBoundary>
                            <WalletGate>
                              <ProtectedComponent
                                Component={Component}
                                pageProps={pageProps}
                              />
                            </WalletGate>
                          </PageErrorBoundary>
                        </div>
                      </div>
                    </NotificationProvider>
                  </ToastProvider>
                </DevWalletProvider>
              </FingerprintProvider>
            </SessionProvider>
          </WalletProvider>
        </ModalProvider>
      </SeasonalThemeProvider>
    </ThemeProvider>
  );
}

const ProtectedComponent: React.FC<ProtectedComponentProps> = ({
  Component,
  pageProps
}) => {
  const { data: sessionData, status, update } = useSession();
  const session = sessionData as MySession | null;
  useClientErrorLogger(session);
  const isLoading = status === 'loading';
  const { ready: fingerprintReady, setReady: setFingerprintReady } = useFingerprintReady();
  const registerRefresh = useRegisterFingerprintRefresh();
  const { activeAccount, wallets } = useWallet();
  const toast = useToastContext();
  const walletMismatchNotified = useRef(false);
  const previousAuthStatus = useRef(status);
  const noopRefresh = useCallback(async (_options?: { forceUpdate?: boolean }) => false, []);

  const sessionUserAgent = session?.userAgent ?? null;

  const refreshFingerprint = useCallback(async (options: { forceUpdate?: boolean } = {}): Promise<boolean> => {
    const { forceUpdate = false } = options;
    if (status !== 'authenticated') return false;
    try {
      const res = await fetch('/api/auth/capture-fingerprint', { method: 'POST' });
      if (!res.ok) return false;
      const data = await res.json().catch(() => ({}));
      const fingerprint = data?.fingerprint;
      const ua = data?.userAgent ?? sessionUserAgent ?? null;

      if (fingerprint && update) {
        if (!forceUpdate && fingerprint === session?.deviceFingerprint && ua === sessionUserAgent) {
          setFingerprintReady(true);
          return true;
        }
        try {
          await update({
            deviceFingerprint: fingerprint,
            userAgent: ua
          });
        } catch {
          await getSession();
        }
      } else {
        await getSession();
      }

      setFingerprintReady(true);
      return true;
    } catch (error) {
      console.error('[Fingerprint] Failed to refresh fingerprint', error);
      return false;
    }
  }, [status, update, sessionUserAgent, session?.deviceFingerprint, setFingerprintReady]);

  useEffect(() => {
    registerRefresh(refreshFingerprint);
    return () => {
      registerRefresh(noopRefresh);
    };
  }, [registerRefresh, refreshFingerprint, noopRefresh]);

  useEffect(() => {
    if (status !== 'authenticated') {
      setFingerprintReady(true);
      return;
    }

    const browserUserAgent =
      typeof navigator !== 'undefined' ? navigator.userAgent : null;
    const sessionFingerprint = session?.deviceFingerprint ?? null;
    const sessionBoundUserAgent = session?.userAgent ?? null;

    const needsRebind =
      !sessionFingerprint ||
      (browserUserAgent &&
        sessionBoundUserAgent &&
        browserUserAgent !== sessionBoundUserAgent);

    if (!needsRebind) {
      setFingerprintReady(true);
      return;
    }

    setFingerprintReady(false);
    let cancelled = false;
    const MAX_RETRIES = 3;
    const RETRY_DELAY_MS = 1500;

    const attempt = async (remaining: number) => {
      if (cancelled) return;
      const success = await refreshFingerprint();
      if (success || cancelled) return;
      if (remaining > 1) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
        await attempt(remaining - 1);
      } else {
        console.warn('[Fingerprint] Continuing without refreshed fingerprint after retries');
        setFingerprintReady(true);
      }
    };

    void attempt(MAX_RETRIES);

    return () => {
      cancelled = true;
    };
  }, [session, status, refreshFingerprint, setFingerprintReady]);

  useEffect(() => {
    if (devMode) {
      walletMismatchNotified.current = false;
      return;
    }

    if (status !== 'authenticated') {
      walletMismatchNotified.current = false;
      return;
    }

    const sessionAddress = session?.user?.address;
    const walletAddress = activeAccount?.address;

    if (!sessionAddress || !walletAddress) {
      walletMismatchNotified.current = false;
      return;
    }

    if (sessionAddress !== walletAddress) {
      if (!walletMismatchNotified.current) {
        walletMismatchNotified.current = true;
        toast.error({
          heading: 'Security check triggered',
          message: 'Our system detected a security issue and signed you out to protect your account. Please reconnect with your device wallet to continue.'
        });
      }
      void (async () => {
        try {
          await Promise.all(
            wallets.map(async (wallet) => {
              if (typeof wallet.disconnect === 'function') {
                try {
                  await wallet.disconnect();
                } catch (err) {
                  console.error('[Wallet] Failed to disconnect during security sign-out', err);
                }
              }
            })
          );
        } finally {
          await signOut({ redirect: false });
        }
      })();
    } else {
      walletMismatchNotified.current = false;
    }
  }, [activeAccount?.address, session?.user?.address, status, toast, wallets]);

  useEffect(() => {
    const prevStatus = previousAuthStatus.current;
    previousAuthStatus.current = status;

    if (prevStatus === 'authenticated' && status === 'unauthenticated') {
      wallets.forEach((wallet) => {
        if (typeof wallet.disconnect === 'function') {
          void wallet.disconnect().catch(() => undefined);
        }
      });
    }
  }, [status, wallets]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    let lastCapture = 0;
    const FOCUS_CAPTURE_INTERVAL_MS = 5 * 60 * 1000;

    const handleFocus = () => {
      if (status !== 'authenticated') return;
      const now = Date.now();
      if (now - lastCapture < FOCUS_CAPTURE_INTERVAL_MS) return;
      lastCapture = now;
      void refreshFingerprint({ forceUpdate: false });
    };

    window.addEventListener('focus', handleFocus);
    return () => {
      window.removeEventListener('focus', handleFocus);
    };
  }, [status, refreshFingerprint]);

  const showInfo = (text: string) => {
    return (
      <p
        style={{
          margin: '50px'
        }}
      >
        {text}
      </p>
    );
  };

  if (isLoading) return showInfo('Loading...');
  if (status === 'authenticated' && !fingerprintReady) {
    return showInfo('Binding this session to your browser for security...');
  }

  return <Component {...pageProps} />;
}
