export type SupportedNetwork = 'mainnet' | 'testnet';

export interface AlgodConfig {
  token: string;
  baseServer: string;
  port: number;
}

export interface AlgorandNetworkConfig {
  algod: AlgodConfig;
  genesisId: string;
  genesisHash: string;
  caipChainId: string;
}

type NetworkConfigs = Record<SupportedNetwork, AlgorandNetworkConfig>;

const DEFAULTS: NetworkConfigs = {
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
};

const sanitizeUrl = (value: string | undefined, fallback: string): string => {
  if (!value) return fallback;
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}${url.pathname}`.replace(/\/+$/, '/');
  } catch {
    return fallback;
  }
};

const resolvePort = (value: string | undefined, fallback: number): number => {
  if (!value) return fallback;
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

const NETWORK_ENV_KEY: Record<SupportedNetwork, { server: string; token: string; port: string }> = {
  mainnet: {
    server: 'NEXT_PUBLIC_ALGOD_SERVER',
    token: 'NEXT_PUBLIC_ALGOD_TOKEN',
    port: 'NEXT_PUBLIC_ALGOD_PORT'
  },
  testnet: {
    server: 'NEXT_PUBLIC_ALGOD_TESTNET_SERVER',
    token: 'NEXT_PUBLIC_ALGOD_TESTNET_TOKEN',
    port: 'NEXT_PUBLIC_ALGOD_TESTNET_PORT'
  }
};

export const getNetworkConfig = (network: SupportedNetwork): AlgorandNetworkConfig => {
  const defaults = DEFAULTS[network];
  const envKeys = NETWORK_ENV_KEY[network];

  return {
    ...defaults,
    algod: {
      token: process.env[envKeys.token] ?? defaults.algod.token,
      baseServer: sanitizeUrl(process.env[envKeys.server], defaults.algod.baseServer),
      port: resolvePort(
        process.env[envKeys.port],
        typeof defaults.algod.port === 'number' ? defaults.algod.port : Number(defaults.algod.port)
      )
    }
  };
};

export const NETWORK_CONFIGS: NetworkConfigs = {
  mainnet: getNetworkConfig('mainnet'),
  testnet: getNetworkConfig('testnet')
};

export const getDefaultNetwork = (): SupportedNetwork => {
  const candidate = (process.env.NEXT_PUBLIC_ALGORAND_NETWORK || '').toLowerCase();
  return candidate === 'testnet' ? 'testnet' : 'mainnet';
};
