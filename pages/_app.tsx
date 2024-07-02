import { NextPage } from 'next';
import { AppProps } from 'next/app';
import '../app/globals.css';
import { useSession, SessionProvider } from 'next-auth/react';
import React from 'react';
import { WalletProvider, useInitializeProviders, PROVIDER_ID } from '@txnlab/use-wallet';
import { DeflyWalletConnect } from '@blockshake/defly-connect';
import { PeraWalletConnect } from '@perawallet/connect';
import { DaffiWalletConnect } from '@daffiwallet/connect';
import Navbar from '../app/navbar';

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
      { id: PROVIDER_ID.DAFFI, clientStatic: DaffiWalletConnect },
      { id: PROVIDER_ID.EXODUS },
      { id: PROVIDER_ID.KIBISIS }
    ]
  });

  return (
    <WalletProvider value={providers}>
      <SessionProvider session={pageProps.session}>
        <Navbar />
        <div id="main" className="w-full min-h-screen">
          <ProtectedComponent Component={Component} pageProps={pageProps} />
        </div>
      </SessionProvider>
    </WalletProvider>
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
