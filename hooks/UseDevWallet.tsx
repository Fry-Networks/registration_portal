import React, {
  createContext,
  ReactNode,
  useContext,
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
  const mnemonic = process.env.NEXT_PUBLIC_ALGORAND_DEV_MNEMONIC as string;
  const algodClient = useMemo(
    () => new algosdk.Algodv2('', 'https://mainnet-api.algonode.cloud', ''),
    []
  );

  const devAccount = useMemo(
    () => (mnemonic ? algosdk.mnemonicToSecretKey(mnemonic) : undefined),
    [mnemonic]
  );

  const [devConnect, setDevConnect] = useState<boolean>(false);
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
