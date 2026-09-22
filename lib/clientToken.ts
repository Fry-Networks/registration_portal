/**
 * Client Token (CLIENT-SIDE ONLY)
 *
 * Fetches and caches the PER-SESSION L1 client token issued by GET /api/auth/signing-key and
 * sent as the `x-client-token` header on sensitive API requests.
 *
 * 2026-09-22 (R12): the token used to be computed in the browser as sha256('<constant>' +
 * navigator.userAgent) from a constant hardcoded in this file and in
 * lib/clientTokenMiddleware.ts. NEXT bundles this file into the client JS, so that constant was
 * public and anyone could mint a valid token — L1 added no boundary at all. The token is now
 * derived server-side from the caller's own session (see lib/clientTokenMiddleware.ts
 * deriveClientToken) and handed only to an authenticated caller, exactly like the R11 L2
 * signing key in lib/requestSignature.client.ts.
 *
 * It is a per-session credential, so it is cached in memory only and never written to
 * localStorage. clearClientToken() still purges the pre-R12 localStorage keys so stale values
 * from an older tab cannot linger.
 */

const CLIENT_TOKEN_ENDPOINT = '/api/auth/signing-key';

const LEGACY_CLIENT_TOKEN_KEY = 'clientToken';
const LEGACY_CLIENT_TOKEN_STATE_KEY = 'clientToken.state.v1';

// Match the L2 client cache bound: well inside the server's session window, so a token never
// goes stale mid-flight. The server is the authority; this is only a client-side cache bound.
const TOKEN_MAX_AGE_MS = 10 * 60 * 1000;

type CachedToken = { token: string; fetchedAt: number };

let cachedToken: CachedToken | null = null;
let inflightTokenPromise: Promise<string> | null = null;

/**
 * Drop the cached token. Call this when the server answers INVALID_CLIENT_TOKEN, so the next
 * attempt fetches a fresh one instead of replaying the rejected value.
 */
export function resetClientToken(): void {
  cachedToken = null;
  inflightTokenPromise = null;
}

function purgeLegacyStorage(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(LEGACY_CLIENT_TOKEN_KEY);
    window.localStorage.removeItem(LEGACY_CLIENT_TOKEN_STATE_KEY);
  } catch {
    // ignore storage access errors
  }
}

async function fetchClientToken(): Promise<string> {
  const response = await fetch(CLIENT_TOKEN_ENDPOINT, {
    method: 'GET',
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
    cache: 'no-store'
  });

  if (!response.ok) {
    throw new Error(`Unable to obtain client token (${response.status})`);
  }

  const data = await response.json();
  if (!data || typeof data.clientToken !== 'string' || data.clientToken.length === 0) {
    throw new Error('Malformed signing-key response');
  }

  return data.clientToken;
}

/**
 * Return the per-session client token, fetching and caching it on first use.
 * Concurrent callers share a single in-flight request.
 *
 * Degrades to '' rather than throwing when there is no session yet (pages/_app.tsx warms this
 * cache before sign-in, and pages/dimo.tsx runs GET-only paths), so a signed-out visitor never
 * sees an unhandled rejection. L1 is only enforced for authenticated, non-GET calls.
 */
export async function getClientToken(options: { forceRefresh?: boolean } = {}): Promise<string> {
  if (typeof window === 'undefined') {
    console.warn('[ClientToken] getClientToken called on server');
    return '';
  }

  const forceRefresh = options.forceRefresh ?? false;
  if (forceRefresh) {
    resetClientToken();
  }

  if (cachedToken && Date.now() - cachedToken.fetchedAt < TOKEN_MAX_AGE_MS) {
    return cachedToken.token;
  }

  if (!inflightTokenPromise) {
    const pending = fetchClientToken()
      .then((token) => {
        cachedToken = { token, fetchedAt: Date.now() };
        // A per-session token must not outlive the tab in storage; drop any pre-R12 leftovers.
        purgeLegacyStorage();
        return token;
      })
      .catch((error) => {
        console.warn('[ClientToken] Failed to resolve token', error);
        return '';
      })
      .finally(() => {
        if (inflightTokenPromise === pending) {
          inflightTokenPromise = null;
        }
      });
    inflightTokenPromise = pending;
  }

  return inflightTokenPromise;
}

export async function refreshClientToken(): Promise<string> {
  resetClientToken();
  return getClientToken({ forceRefresh: true });
}

/**
 * Clear the cached token (useful for testing or logout).
 */
export function clearClientToken(): void {
  resetClientToken();
  purgeLegacyStorage();
}
