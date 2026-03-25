import { Algodv2, Indexer } from 'algosdk';
import { normalizeAssetId } from '../utils';
import { withAlgorandRetry } from './withRetry';

// Primary and fallback Algorand API servers
const ALGOD_SERVERS = [
  'https://mainnet-api.algonode.cloud',
  'https://mainnet-api.4160.nodely.io'  // Fallback
];
const INDEXER_SERVER = 'https://mainnet-idx.algonode.cloud';

// Use header-less clients so browser calls avoid CORS preflight blocks on x-api-key.
const algodClient = new Algodv2('', ALGOD_SERVERS[0], '');
const indexerClient = new Indexer('', INDEXER_SERVER, '');

/**
 * Try to get account information with fallback servers.
 * If the primary server fails, tries the fallback server.
 */
async function getAccountWithFallback(address: string): Promise<Record<string, any>> {
  let lastError: unknown;
  for (const server of ALGOD_SERVERS) {
    try {
      const client = new Algodv2('', server, '');
      return await withAlgorandRetry(client.accountInformation(address));
    } catch (error) {
      lastError = error;
      console.warn(`[getAccountWithFallback] ${server} failed, trying next...`, 
        error instanceof Error ? error.message : String(error));
    }
  }
  throw lastError;
}

export async function getAlgoBalance(address: string): Promise<number | null> {
  try {
    const accountInfo = await getAccountWithFallback(address);
    return Number(accountInfo.amount) / 1e6;
  } catch (error) {
    // FIX: Log but return 0 to avoid false "not opted in" errors
    // If we can't verify, fail open - Algorand will reject bad transactions
    console.error('[getAlgoBalance] Network error (failing open):', error);
    return 0;
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
    const accountInfo = await getAccountWithFallback(address);
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
      return null;  // Definitively not opted in
    }

    const decimals = await getAssetDecimals(normalizedAssetId);
    const divisor = Math.pow(10, decimals ?? 0);
    const amount = Number(asset.amount ?? 0);
    return divisor === 0 ? amount : Number((amount / divisor).toFixed(2));
  } catch (error) {
    // FIX: Log but return 0 instead of null to avoid false "not opted in" errors
    // If we can't verify opt-in status, fail open - the Algorand network will
    // reject the transaction if the user isn't actually opted in
    console.error('[getAssetBalance] Network error (failing open):', error);
    return 0;  // Return 0 balance instead of null - allows operation to proceed
  }
}
