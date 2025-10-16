import { NextPage } from 'next';
import { AppProps } from 'next/app';
import '../app/globals.css';
import { useSession, SessionProvider } from 'next-auth/react';
import React, { useEffect, useState } from 'react';
import Modal from 'react-modal';
import { WalletManager, NetworkId, WalletId } from '@txnlab/use-wallet';
import { WalletProvider } from '@txnlab/use-wallet-react';
import Navbar from '../components/Navbar';
import AnnouncementBanner from '../components/AnnouncementBanner';
import { ModalProvider } from '../app/modalcontext';
import { DevWalletProvider } from '../hooks/UseDevWallet';
import { ToastProvider } from '../hooks/ToastContext';
import { NotificationProvider } from '../app/notificationcontext';
import 'leaflet/dist/leaflet.css';
import { useRouter } from 'next/router';
import { generateClientToken } from '../lib/clientToken';

interface MyAppProps extends AppProps {
  Component: NextPage;
}

interface ProtectedComponentProps {
  Component: NextPage;
  pageProps: any; // If you have a specific type for your pageProps, you can replace `any` with that.
}


export default function MyApp({ Component, pageProps }: MyAppProps) {
  const [walletManager, setWalletManager] = useState<WalletManager | null>(null);
  const router = useRouter();

  const notificationsEnabled = router.pathname === '/devices' || router.pathname === '/history';
  const showAnnouncementBanner = notificationsEnabled;

  useEffect(() => {
    // Initialize WalletManager
    const manager = new WalletManager({
      wallets: [
        {
          id: WalletId.DEFLY,
          options: {
            shouldShowSignTxnToast: false,
            chainId: 416001, // Mainnet chain ID
          }
        },
        {
          id: WalletId.PERA,
          options: {
            shouldShowSignTxnToast: false,
            chainId: 416001, // Mainnet chain ID
            compactMode: false,
          }
        }
      ],
      networks: {
        mainnet: {
          algod: {
            token: '',
            baseServer: 'https://mainnet-api.algonode.cloud',
            port: 443
          },
          genesisHash: 'wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8=',
          genesisId: 'mainnet-v1.0',
          caipChainId: 'algorand:wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8='
        },
        testnet: {
          algod: {
            token: '',
            baseServer: 'https://testnet-api.algonode.cloud',
            port: 443
          },
          genesisHash: 'SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=',
          genesisId: 'testnet-v1.0',
          caipChainId: 'algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI='
        }
      },
      defaultNetwork: NetworkId.MAINNET
    });

    setWalletManager(manager);

    // Resume sessions
    (async () => {
      try {
        await manager.resumeSessions();
      } catch (error) {
        console.error('[WalletManager] Failed to resume sessions', error);
      }
    })();

    // Initialize client token for API security
    (async () => {
      try {
        await generateClientToken();
      } catch (error) {
        console.error('[ClientToken] Failed to generate token', error);
      }
    })();

    // Ensure react-modal knows the app root for accessibility
    Modal.setAppElement?.('#__next');
  }, []);

  useEffect(() => {
    if (!showAnnouncementBanner) {
      document.documentElement.style.setProperty('--announcement-banner-height', '0px');
    }
  }, [showAnnouncementBanner]);

  if (!walletManager) {
    return <div>Loading wallet manager...</div>;
  }

  return (
    <ModalProvider>
      {/* <WagmiProvider config={wagmiAdapter.wagmiConfig}>
        <QueryClientProvider client={queryClient}> */}
          <WalletProvider manager={walletManager}>
            <SessionProvider session={pageProps.session}>
              <DevWalletProvider>
                <ToastProvider>
                  <NotificationProvider isEnabled={notificationsEnabled}>
                    <Navbar />
                    <div className="relative flex flex-col">
                      {showAnnouncementBanner && <AnnouncementBanner />}
                      <div
                        id="main"
                        className="w-full min-h-screen bg-background text-foreground dark"
                      >
                        <ProtectedComponent
                          Component={Component}
                          pageProps={pageProps}
                        />
                      </div>
                    </div>
                  </NotificationProvider>
                </ToastProvider>
              </DevWalletProvider>
            </SessionProvider>
          </WalletProvider>
        {/* </QueryClientProvider>
      </WagmiProvider> */}
    </ModalProvider>
  );
}

const ProtectedComponent: React.FC<ProtectedComponentProps> = ({
  Component,
  pageProps
}) => {
  const { data: session, status } = useSession();
  const isLoading = status === 'loading';

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

  return <Component {...pageProps} />;
};
