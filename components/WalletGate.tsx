import React, { useEffect, useState } from 'react';
import { useWallet } from '@txnlab/use-wallet-react';
import Link from 'next/link';

interface WalletGateProps {
  children: React.ReactNode;
}

export default function WalletGate({ children }: WalletGateProps) {
  const { activeAccount, wallets } = useWallet();
  const [redirectUrl, setRedirectUrl] = useState<string>('/');

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setRedirectUrl(window.location.href);
    }
  }, []);

  if (activeAccount) {
    return <>{children}</>;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-space-4">
      <div className="w-full max-w-md rounded-token-lg border border-divider bg-surface-elevated p-space-6 shadow-token-lg">
        <div className="mb-space-5 text-center">
          <h2 className="font-display text-display-2xl text-ink-primary">
            Connect Wallet
          </h2>
          <p className="mt-space-2 text-display-sm text-ink-secondary">
            Connect your wallet to access the dashboard and manage your devices.
          </p>
        </div>

        <div className="flex flex-col gap-space-3">
          {wallets.map((wallet) => (
            <button
              key={wallet.id}
              onClick={() => wallet.connect()}
              className="flex items-center gap-space-3 rounded-token-md border border-divider bg-surface-strong px-space-4 py-space-3 text-ink-primary shadow-token-sm transition-fast hover:border-primary-500 hover:shadow-token-glow"
            >
              <img
                src={wallet.metadata.icon}
                alt={`${wallet.metadata.name} logo`}
                width={28}
                height={28}
                className="object-contain"
              />
              <span className="font-body text-display-base">
                {wallet.metadata.name}
              </span>
            </button>
          ))}
        </div>

        <p className="mt-space-5 text-center text-display-xs text-ink-muted">
          After connecting, you will be redirected back to{' '}
          <span className="font-mono text-ink-secondary">{redirectUrl}</span>
        </p>
      </div>
    </div>
  );
}
