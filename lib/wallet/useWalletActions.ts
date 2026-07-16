import { useMemo } from 'react';
import { useWallet } from '@txnlab/use-wallet-react';
import type { WalletSigner } from './signing';
import { signTransactionsWithWallet, submitSignedTransactions } from './signing';
import { runWithWalletRequest } from './requestCoordinator.client';
import type { SupportedNetwork } from './config';

type SignOpts = Record<string, unknown>;

interface WalletActionContext {
  activeAddress: string | null;
  signAndSubmit: (encodedTransactions: Uint8Array[], opts?: SignOpts) => Promise<string[]>;
  signTransactions: (encodedTransactions: Uint8Array[], opts?: SignOpts) => Promise<Uint8Array[]>;
}

export const useWalletActions = (): WalletActionContext => {
  const { activeAddress, signTransactions } = useWallet();

  const signer: WalletSigner | null = useMemo(() => {
    if (!signTransactions) return null;
    return {
      signTransactions: (encodedTransactions: Uint8Array[], opts?: Record<string, unknown>) => {
        // Adapter for @txnlab/use-wallet-react signTransactions
        return signTransactions(encodedTransactions, (opts?.indexesToSign as number[] | undefined));
      }
    };
  }, [signTransactions]);

  const signOnly = async (encodedTransactions: Uint8Array[], opts?: SignOpts) => {
    if (!signer) {
      throw new Error('No wallet signer available');
    }
    // Gate wallet signing behind the shared coordinator so Pera/Defly never see concurrent prompts.
    return runWithWalletRequest(() =>
      signTransactionsWithWallet(signer, encodedTransactions, opts)
    );
  };

  const signAndSubmit = async (encodedTransactions: Uint8Array[], opts?: SignOpts) => {
    const signed = await signOnly(encodedTransactions, opts);
    return submitSignedTransactions(signed, { network: opts?.network as SupportedNetwork });
  };

  return {
    activeAddress: activeAddress ?? null,
    signAndSubmit,
    signTransactions: signOnly
  };
};
