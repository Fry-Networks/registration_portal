import algosdk, { Algodv2, Indexer } from 'algosdk';
import { NETWORK_CONFIGS, SupportedNetwork, getDefaultNetwork } from './config';

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

const ensureIndexerClient = (network: SupportedNetwork): Indexer => {
  const cache = clients[network];
  if (!cache.indexer) {
    const { algod } = NETWORK_CONFIGS[network];
    cache.indexer = new algosdk.Indexer(algod.token, algod.baseServer.replace('api', 'idx'), algod.port);
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
