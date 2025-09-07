import { NextPage } from 'next';
import { AppProps } from 'next/app';
import '../app/globals.css';
import { useSession, SessionProvider } from 'next-auth/react';
import React, { useEffect } from 'react';
import Modal from 'react-modal';
import {
  WalletProvider,
  useInitializeProviders,
  PROVIDER_ID
} from '@txnlab/use-wallet';
import { DeflyWalletConnect } from '@blockshake/defly-connect';
import { PeraWalletConnect } from '@perawallet/connect';
import { DaffiWalletConnect } from '@daffiwallet/connect';
import Navbar from '../components/Navbar';
import { ModalProvider } from '../app/modalcontext';
import { Flex } from '@tremor/react';
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
  const providers = useInitializeProviders({
    providers: [
      { id: PROVIDER_ID.DEFLY, clientStatic: DeflyWalletConnect },
      { id: PROVIDER_ID.PERA, clientStatic: PeraWalletConnect },
      { id: PROVIDER_ID.DAFFI, clientStatic: DaffiWalletConnect }
    ]
  });

  // Ensure react-modal knows the app root for accessibility
  useEffect(() => {
    // Next.js mounts the app under #__next by default
    Modal.setAppElement?.('#__next');
  }, []);

  return (
    <ModalProvider>
      {/* <WagmiProvider config={wagmiAdapter.wagmiConfig}>
        <QueryClientProvider client={queryClient}> */}
          <WalletProvider value={providers}>
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
