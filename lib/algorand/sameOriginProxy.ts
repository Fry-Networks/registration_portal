/**
 * Same-origin bases for browser Algorand traffic.
 *
 * Client bundles cannot see ALGOD_URL (it is not a NEXT_PUBLIC_* variable) and cannot reach the
 * self-hosted node directly (Tailscale CGNAT, not publicly routable), so browser code used to
 * fall through to the quota-limited public endpoints and collect 403s. These helpers point it at
 * the pages/api/algod and pages/api/indexer routes instead, which forward to the self-hosted node
 * server-side. On the server they return null so existing server-side resolution is untouched.
 *
 * algosdk 3.5.2 preserves a path prefix supplied in baseServer -- verified against the installed
 * copy: baseServer "https://host/api/algod" issues "https://host/api/algod/v2/status" -- so these
 * values can be handed straight to Algodv2 and Indexer. Do not derive the indexer base from the
 * algod base by string substitution: "https://host/api/algod".replace('api','idx') rewrites the
 * PATH, not the host, and silently yields "https://host/idx/algod".
 */

export const ALGOD_PROXY_PATH = '/api/algod';
export const INDEXER_PROXY_PATH = '/api/indexer';

export const isBrowser = (): boolean => typeof window !== 'undefined' && !!window.location;

const sameOriginBase = (path: string): string | null =>
  isBrowser() ? `${window.location.origin}${path}` : null;

/** Same-origin algod base, or null when running server-side. */
export const browserAlgodBase = (): string | null => sameOriginBase(ALGOD_PROXY_PATH);

/** Same-origin indexer base, or null when running server-side. */
export const browserIndexerBase = (): string | null => sameOriginBase(INDEXER_PROXY_PATH);

/** Port matching the current origin, so a non-443 deployment (local dev) still resolves. */
export const browserPort = (): number => {
  if (!isBrowser()) return 443;
  if (window.location.port) return Number(window.location.port);
  return window.location.protocol === 'https:' ? 443 : 80;
};
