import React, {
  createContext,
  ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState
} from 'react';
import algosdk, { Account, Algodv2 } from 'algosdk';

interface DevWalletContextType {
  devConnect: boolean;
  devAccount?: Account;
  algodClient: Algodv2;
  setDevConnect: React.Dispatch<React.SetStateAction<boolean>>;
}

const DevWalletContext = createContext<DevWalletContextType | undefined>(
  undefined
);

interface DevWalletProviderProps {
  children: ReactNode;
}

export function DevWalletProvider({ children }: DevWalletProviderProps) {
  const algodClient = useMemo(
    () => new algosdk.Algodv2('', 'https://mainnet-api.algonode.cloud', ''),
    []
  );

  // 2026-08-06: this used to derive an account from a NEXT_PUBLIC_ mnemonic env var.
  // NEXT_PUBLIC_* values are inlined into the client bundle (and, with
  // productionBrowserSourceMaps enabled, into publicly served source maps), so a mnemonic
  // placed there would be readable by every visitor. A browser-side wallet must come from the
  // wallet connection flow (WalletAuthProvider / use-wallet), never from an environment
  // variable. Kept on the context so existing consumers still type-check.
  const devAccount: Account | undefined = undefined;

  // console.log(devAccount?.addr);

  const [devConnect, setDevConnect] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const storedValue = localStorage.getItem('devConnect');
      return storedValue === 'true';
    }
    return false;
  });

  useEffect(() => {
    localStorage.setItem('devConnect', JSON.stringify(devConnect));
  }, [devConnect]);

  const contextValue = {
    devConnect,
    devAccount,
    algodClient,
    setDevConnect
  };

  return (
    <DevWalletContext.Provider value={contextValue}>
      {children}
    </DevWalletContext.Provider>
  );
}

export function useDevWallet() {
  const context = useContext(DevWalletContext);
  if (!context) {
    throw new Error('useDevWallet must be used within a DevWalletProvider');
  }

  return context;
}
