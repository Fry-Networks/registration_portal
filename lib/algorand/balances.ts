import { Algodv2, Indexer } from 'algosdk';
import { normalizeAssetId } from '../utils';
import { withAlgorandRetry } from './withRetry';

/*
const ALGOD_TOKEN = '';
const ALGOD_SERVER = 'https://xna-mainnet-api.algonode.cloud/';
const ALGOD_PORT = 443;
const INDEXER_SERVER = 'https://mainnet-idx.algonode.cloud/';
*/
const ALGOD_SERVER = 'https://mainnet-api.algonode.cloud';
const INDEXER_SERVER = 'https://mainnet-idx.algonode.cloud';

/*
const tokenHeader = {
  'X-API-Key': ALGOD_TOKEN
};

// Reuse singleton clients on both client and server to avoid repeated instantiation cost.
const algodClient = new Algodv2(tokenHeader, ALGOD_SERVER, ALGOD_PORT);
const indexerClient = new Indexer(tokenHeader, INDEXER_SERVER, ALGOD_PORT);
*/
// Use header-less clients so browser calls avoid CORS preflight blocks on x-api-key.
const algodClient = new Algodv2('', ALGOD_SERVER, '');
const indexerClient = new Indexer('', INDEXER_SERVER, '');

export async function getAlgoBalance(address: string): Promise<number | null> {
  try {
    const accountInfo = await withAlgorandRetry(algodClient.accountInformation(address));
    return Number(accountInfo.amount) / 1e6;
  } catch (error) {
    console.error('Error fetching ALGO balance:', error);
    return null;
  }
}

export async function getAssetDecimals(assetId: number): Promise<number | null> {
  try {
    const assetInfo = await withAlgorandRetry(indexerClient.lookupAssetByID(assetId));
    return assetInfo.asset.params.decimals;
  } catch (error) {
    console.error(`Failed to fetch asset info for Asset ID ${assetId}:`, error);
    return null;
  }
}

export async function getAssetBalance(
  address: string,
  assetId: string
): Promise<number | null> {
  try {
    const accountInfo = await withAlgorandRetry(algodClient.accountInformation(address));
    // Compare with normalized ids so bigint asset identifiers do not break lookups.
    const normalizedAssetId = assetId === 'none' ? 0 : normalizeAssetId(assetId);
    const assets = (accountInfo.assets ?? []) as Array<Record<string, any>>;
    const asset = assets.find(item => {
      const candidateId =
        (item['asset-id'] as number | string | bigint | undefined) ??
        (item.assetId as number | string | bigint | undefined);
      const normalized = normalizeAssetId(candidateId);
      if (normalized === normalizedAssetId) {
        return true;
      }
      return false;
    });

    if (!asset) {
      console.log('[getAssetBalance] asset not found', {
        address,
        assetId: normalizedAssetId,
        holdings: assets.slice(0, 5).map((entry) => ({
          rawKeys: Object.keys(entry ?? {}),
          id: normalizeAssetId(
            (entry['asset-id'] as number | string | bigint | undefined) ??
              (entry.assetId as number | string | bigint | undefined)
          ),
          amount:
            typeof entry.amount === 'bigint'
              ? entry.amount.toString()
              : entry.amount
        }))
      });
      return null;
    }

    const decimals = await getAssetDecimals(normalizedAssetId);
    const divisor = Math.pow(10, decimals ?? 0);
    const amount = Number(asset.amount ?? 0);
    return divisor === 0 ? amount : Number((amount / divisor).toFixed(2));
  } catch (error) {
    console.error('Error fetching asset balance:', error);
    return null;
  }
}
