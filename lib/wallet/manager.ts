import { WalletManager, WalletId, NetworkId } from '@txnlab/use-wallet';
import type {
  DeflyWalletConnectOptions,
  PeraWalletConnectOptions,
  SupportedWallet,
  WalletMetadata
} from '@txnlab/use-wallet';
import type { SupportedNetwork } from './config';
import { NETWORK_CONFIGS, getDefaultNetwork } from './config';

const DEFAULT_DAPP_ICON =
  'https://static.wixstatic.com/media/b2ad32_3c66813c76c34794879d1a284bc90843~mv2.png';
const DAPP_NAME = 'Fry Networks Dashboard';
const DEFAULT_PERA_ICON = 'https://perawallet.s3-eu-west-3.amazonaws.com/media-kit/button-pera-connect.svg';
const DEFAULT_DEFLY_ICON = '/wallets/defly.svg';

const peraMetadata: WalletMetadata = {
  name: 'Pera',
  icon: process.env.NEXT_PUBLIC_PERA_ICON_URL || DEFAULT_PERA_ICON
};

const deflyMetadata: WalletMetadata = {
  name: 'Defly',
  icon: process.env.NEXT_PUBLIC_DEFLY_ICON_URL || DEFAULT_DEFLY_ICON
};

const peraOptions: PeraWalletConnectOptions = {
  shouldShowSignTxnToast: false,
  compactMode: false,
  chainId: 416001
};

const deflyOptions: DeflyWalletConnectOptions = {
  shouldShowSignTxnToast: false,
  chainId: 416001
};

const SUPPORTED_WALLETS = [
  {
    id: WalletId.PERA,
    options: peraOptions,
    metadata: peraMetadata
  },
  {
    id: WalletId.DEFLY,
    options: deflyOptions,
    metadata: deflyMetadata
  }
] satisfies SupportedWallet[];

export const createWalletManager = (
  network: SupportedNetwork = getDefaultNetwork()
): WalletManager => {
  const manager = new WalletManager({
    wallets: SUPPORTED_WALLETS,
    networks: NETWORK_CONFIGS,
    defaultNetwork: network as NetworkId
  });
  return manager;
};

export const resumeWalletSessions = async (manager: WalletManager): Promise<void> => {
  try {
    await manager.resumeSessions();
  } catch (error) {
    console.error('[wallet] Failed to resume sessions', error);
  }
};

export const disconnectAllWallets = async (manager: WalletManager): Promise<void> => {
  const maybeManager = manager as WalletManager & {
    disconnectAll?: () => void | Promise<void>;
  };

  if (typeof maybeManager.disconnectAll === 'function') {
    try {
      await maybeManager.disconnectAll();
    } catch (error) {
      console.error('[wallet] Failed to disconnect wallets', error);
    }
  }
};

export const subscribeToManagerReadyFallback = (manager: WalletManager): (() => void) => {
  const timeout = setTimeout(() => {
    manager.store.setState((state) => {
      if (state.managerStatus !== 'ready') {
        console.warn('[wallet] Forcing managerStatus to ready after timeout');
        return { ...state, managerStatus: 'ready' };
      }
      return state;
    });
  }, 10000);

  return () => clearTimeout(timeout);
};
