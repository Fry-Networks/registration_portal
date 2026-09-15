import { Algodv2, Indexer } from 'algosdk';
import { normalizeAssetId } from '../utils';
import { withAlgorandRetry } from './withRetry';
import { AlgodUnavailableError } from './failover';
import { browserAlgodBase, browserIndexerBase } from './sameOriginProxy';

/*
const ALGOD_TOKEN = '';
const ALGOD_SERVER = 'https://xna-mainnet-api.algonode.cloud/';
const ALGOD_PORT = 443;
const INDEXER_SERVER = 'https://mainnet-idx.algonode.cloud/';
*/
// Browser traffic goes through the same-origin proxy and lands on the self-hosted node; the
// public endpoints stay as the server-side and test default.
const ALGOD_SERVER = browserAlgodBase() || 'https://mainnet-api.algonode.cloud';
const INDEXER_SERVER = browserIndexerBase() || 'https://mainnet-idx.algonode.cloud';

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

/**
 * Returns the wallet's ALGO balance in whole Algos, full precision.
 * Throws AlgodUnavailableError when the balance cannot be determined —
 * callers must never treat an algod outage as a zero/absent balance.
 */
export async function getAlgoBalance(address: string): Promise<number> {
  try {
    const accountInfo = await withAlgorandRetry(algodClient.accountInformation(address));
    return Number(accountInfo.amount) / 1e6;
  } catch (error) {
    console.error('Error fetching ALGO balance:', error);
    throw new AlgodUnavailableError([
      `algod: ${error instanceof Error ? error.message : String(error)}`
    ]);
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

/**
 * Returns the wallet's whole-unit balance of the asset, or `null` when the
 * wallet is not opted in (a legitimate state callers use for opt-in checks).
 * Throws AlgodUnavailableError when the balance cannot be determined —
 * callers must never treat an algod outage as "not opted in".
 */
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
    if (decimals === null) {
      // Without real decimals the raw amount would be returned as microunits.
      throw new AlgodUnavailableError([
        `indexer: could not resolve decimals for asset ${normalizedAssetId}`
      ]);
    }
    const divisor = Math.pow(10, decimals);
    const amount = Number(asset.amount ?? 0);
    return divisor === 0 ? amount : amount / divisor;
  } catch (error) {
    if (error instanceof AlgodUnavailableError) {
      throw error;
    }
    console.error('Error fetching asset balance:', error);
    throw new AlgodUnavailableError([
      `algod: ${error instanceof Error ? error.message : String(error)}`
    ]);
  }
}
