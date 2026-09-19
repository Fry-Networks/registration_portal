import algosdk, { Algodv2 } from 'algosdk';
import type { Asset } from '../types';

/**
 * Algod failover for server-side balance checks.
 *
 * Primary: self-hosted node (ATLAS00) via ALGOD_URL / ALGOD_TOKEN — the same
 * envs already used by the rewards/preseed/genesis APIs. Fallbacks: public
 * Nodely hosts. Nodely answers quota exhaustion with a plain-text 403 body,
 * which algosdk surfaces as a JSON parse error rather than a network error,
 * so every throw type counts as an endpoint failure here.
 */
// Env-only: never hardcode the private node address — this module is reachable from
// bundles, and an unset ALGOD_URL should mean "use the public nodes", not "dial an IP".
const PRIMARY_ALGOD_URL = process.env.ALGOD_URL || '';
const PRIMARY_ALGOD_TOKEN = process.env.ALGOD_TOKEN || '';
const FALLBACK_ALGOD_URLS = [
  'https://mainnet-api.4160.nodely.dev',
  'https://mainnet-api.algonode.cloud',
];
const REQUEST_TIMEOUT_MS = 8000;

export class AlgodUnavailableError extends Error {
  causes: string[];

  constructor(causes: string[]) {
    super(`All algod endpoints failed: ${causes.join(' | ')}`);
    this.name = 'AlgodUnavailableError';
    this.causes = causes;
  }
}

const withTimeout = async <T>(promise: Promise<T>, ms: number, label: string): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const buildClients = (): Array<{ label: string; client: Algodv2 }> => [
  ...(PRIMARY_ALGOD_URL
    ? [{ label: PRIMARY_ALGOD_URL, client: new algosdk.Algodv2(PRIMARY_ALGOD_TOKEN, PRIMARY_ALGOD_URL) }]
    : []),
  ...FALLBACK_ALGOD_URLS.map((url) => ({
    label: url,
    client: new algosdk.Algodv2('', url, ''),
  })),
];

/**
 * Fetch an account's whole-unit balance of `asset`, trying each algod
 * endpoint in order. Returns 0 only when the account genuinely does not
 * hold / is not opted in to the asset. Throws AlgodUnavailableError when
 * every endpoint fails — callers must surface that error to the client,
 * never treat it as a zero balance.
 */
/**
 * Fetch raw account information with the same endpoint failover chain.
 * Returns the algosdk accountInformation response verbatim (callers keep
 * their existing field extraction). Throws AlgodUnavailableError when every
 * endpoint fails. Used by the auth path so wallet sign-in survives a single
 * node outage.
 */
// Cache the endpoint that answered so a claim does not re-probe on every call, but keep
// the window short so recovery of the self-hosted node is picked up quickly.
let cachedHealthyAlgod: { client: Algodv2; at: number } | null = null;
const ALGOD_HEALTH_TTL_MS = 60_000;

/**
 * Return an algod client that is actually reachable, trying the self-hosted node first
 * and then the public fallbacks. Throws AlgodUnavailableError when none answer, so
 * callers can return 503 instead of a misleading "vault balance" failure.
 */
export async function getFailoverAlgodClient(): Promise<Algodv2> {
  if (cachedHealthyAlgod && Date.now() - cachedHealthyAlgod.at < ALGOD_HEALTH_TTL_MS) {
    return cachedHealthyAlgod.client;
  }
  const causes: string[] = [];
  for (const { label, client } of buildClients()) {
    try {
      await withTimeout(client.status().do(), REQUEST_TIMEOUT_MS, label);
      cachedHealthyAlgod = { client, at: Date.now() };
      return client;
    } catch (err) {
      causes.push(`${label}: ${(err as Error).message}`);
    }
  }
  throw new AlgodUnavailableError(causes);
}

export async function getFailoverAccountInfo(address: string) {
  const causes: string[] = [];

  for (const { label, client } of buildClients()) {
    try {
      return await withTimeout(
        client.accountInformation(address).do(),
        REQUEST_TIMEOUT_MS,
        label
      );
    } catch (err) {
      causes.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  throw new AlgodUnavailableError(causes);
}

export async function getFailoverAssetBalance(address: string, asset: Asset): Promise<number> {
  const causes: string[] = [];

  for (const { label, client } of buildClients()) {
    try {
      const accountInfo = await withTimeout(
        client.accountInformation(address).do(),
        REQUEST_TIMEOUT_MS,
        label
      );
      const assets = (accountInfo.assets ?? []) as Array<{
        ['asset-id']?: number | string | bigint;
        assetId?: number | string | bigint;
        amount?: number | string | bigint;
      }>;
      const holding = assets.find((a) => {
        const id = a['asset-id'] ?? a.assetId ?? null;
        return String(id) === asset.id;
      });
      if (!holding) {
        return 0;
      }
      return Number(holding.amount) / Math.pow(10, asset.decimals);
    } catch (err) {
      causes.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  throw new AlgodUnavailableError(causes);
}
