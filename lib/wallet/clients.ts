import algosdk, { Algodv2, Indexer } from 'algosdk';
import { NETWORK_CONFIGS, SupportedNetwork, getDefaultNetwork } from './config';
import { browserIndexerBase } from '../algorand/sameOriginProxy';

type ClientCache = {
  algod?: Algodv2;
  indexer?: Indexer;
};

const clients: Record<SupportedNetwork, ClientCache> = {
  mainnet: {},
  testnet: {}
};

const ensureAlgodClient = (network: SupportedNetwork): Algodv2 => {
  const cache = clients[network];
  if (!cache.algod) {
    const { algod } = NETWORK_CONFIGS[network];
    cache.algod = new algosdk.Algodv2(algod.token, algod.baseServer, algod.port);
  }
  return cache.algod;
};

// Public indexers, used when the algod URL cannot yield one. A self-hosted algod
// (e.g. an IP:port) has no "api" to swap for "idx", so the old derivation silently
// pointed the indexer at an algod-only host and every lookup failed — which is how a
// FRY 1.0 burn could be confirmed on-chain and still be reported as a failed conversion.
const PUBLIC_INDEXER_URLS: Record<SupportedNetwork, string> = {
  mainnet: 'https://mainnet-idx.4160.nodely.dev',
  testnet: 'https://testnet-idx.4160.nodely.dev'
};

const resolveIndexerServer = (network: SupportedNetwork, algodServer: string): string => {
  const explicit = process.env.INDEXER_URL || process.env.NEXT_PUBLIC_INDEXER_SERVER;
  if (explicit) return explicit;
  // Browser: same-origin indexer proxy. This MUST come before the substitution below -- the
  // proxy base carries a path, and 'https://host/api/algod'.replace('api', 'idx') rewrites that
  // path segment rather than the host, yielding 'https://host/idx/algod', which resolves to
  // nothing. That is the same silent-misdirection failure this function's comment describes.
  const proxied = browserIndexerBase();
  if (proxied) return proxied;
  const derived = algodServer.replace('api', 'idx');
  if (derived !== algodServer) return derived;
  return PUBLIC_INDEXER_URLS[network];
};

const ensureIndexerClient = (network: SupportedNetwork): Indexer => {
  const cache = clients[network];
  if (!cache.indexer) {
    const { algod } = NETWORK_CONFIGS[network];
    const server = resolveIndexerServer(network, algod.baseServer);
    // A public indexer takes no token and must not inherit the private node's port.
    const isDerived = server === algod.baseServer.replace('api', 'idx');
    cache.indexer = isDerived
      ? new algosdk.Indexer(algod.token, server, algod.port)
      : new algosdk.Indexer('', server, '');
  }
  return cache.indexer;
};

export const getAlgodClient = (network: SupportedNetwork = getDefaultNetwork()): Algodv2 => {
  return ensureAlgodClient(network);
};

export const getIndexerClient = (network: SupportedNetwork = getDefaultNetwork()): Indexer => {
  return ensureIndexerClient(network);
};

export const resetClients = (): void => {
  clients.mainnet = {};
  clients.testnet = {};
};
