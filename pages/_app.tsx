import { NextPage } from 'next';
import { AppProps } from 'next/app';
import '../app/globals.css';
import { useSession, SessionProvider } from 'next-auth/react';
import React, { useEffect, useState } from 'react';
import Modal from 'react-modal';
import { WalletManager, NetworkId, WalletId } from '@txnlab/use-wallet';
import { WalletProvider } from '@txnlab/use-wallet-react';
import Navbar from '../components/Navbar';
import { ModalProvider } from '../app/modalcontext';
import { DevWalletProvider } from '../hooks/UseDevWallet';
import { ToastProvider } from '../hooks/ToastContext';

// import { createAppKit } from '@reown/appkit/react';
// import { iotex, mainnet } from '@reown/appkit/networks';
// import { WagmiAdapter } from '@reown/appkit-adapter-wagmi';
// import { WagmiProvider } from 'wagmi';

// import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// const projectId = "74761852c2f607c540bb116a1bc9f011";
// const queryClient = new QueryClient();

// const metadata = { //optional
//   name: 'AppKit',
//   description: 'AppKit',
//   url: 'https://example.com',
//   icons: ['https://avatars.githubusercontent.com/u/179229932']
// }

// const wagmiAdapter = new WagmiAdapter({
//   networks: [mainnet, iotex],
//   projectId
// });

// export const walletModal = createAppKit({
//   adapters: [wagmiAdapter],
//   networks: [mainnet, iotex],
//   metadata: metadata,
//   projectId,
//   features: {
//     analytics: true,
//   }
//  })

interface MyAppProps extends AppProps {
  Component: NextPage;
}

interface ProtectedComponentProps {
  Component: NextPage;
  pageProps: any; // If you have a specific type for your pageProps, you can replace `any` with that.
}


export default function MyApp({ Component, pageProps }: MyAppProps) {
  const [walletManager, setWalletManager] = useState<WalletManager | null>(null);

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
    manager.resumeSessions();

    // Ensure react-modal knows the app root for accessibility
    Modal.setAppElement?.('#__next');
  }, []);

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
                  <Navbar />
                  <div
                    id="main"
                    className="w-full h-[calc(100vh-96px)] dark text-foreground bg-background"
                  >
                    <ProtectedComponent
                      Component={Component}
                      pageProps={pageProps}
                    />
                  </div>
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
