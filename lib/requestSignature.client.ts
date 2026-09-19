/**
 * Request Signature Generation (CLIENT-SIDE ONLY)
 *
 * This file contains ONLY the client-side signature generation function.
 * It has NO dependencies on server-only modules (no MongoDB, no Node.js libs).
 *
 * Server-side verification is in requestSignature.server.ts
 *
 * 2026-09-18 (R11): the signing key is no longer a build-time constant. It previously came
 * from a NEXT_PUBLIC_ environment variable with a hardcoded string default. NEXT_PUBLIC_*
 * values are inlined into the client bundle, and the variable was never actually set, so
 * every visitor could read that default straight out of the shipped JS and mint a valid L2
 * signature. The key is now derived server-side from the caller's session and fetched at
 * runtime over the authenticated session, so it is per-session and never present in the
 * bundle. See pages/api/auth/signing-key.ts.
 */

const SIGNING_KEY_ENDPOINT = '/api/auth/signing-key';

// Refetch well inside the server's 15-minute signature window so a key never goes stale
// mid-flight. The server is the authority; this is only a client-side cache bound.
const KEY_MAX_AGE_MS = 10 * 60 * 1000;

type CachedKey = { key: string; fetchedAt: number };

let cachedKey: CachedKey | null = null;
let inflight: Promise<string> | null = null;

/**
 * Drop the cached key. Call this when the server rejects a signature, so the next attempt
 * fetches a fresh key instead of replaying the rejected one.
 */
export function resetSigningKey(): void {
  cachedKey = null;
  inflight = null;
}

async function fetchSigningKey(): Promise<string> {
  const response = await fetch(SIGNING_KEY_ENDPOINT, {
    method: 'GET',
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
    cache: 'no-store'
  });

  if (!response.ok) {
    throw new Error(`Unable to obtain request signing key (${response.status})`);
  }

  const data = await response.json();
  if (!data || typeof data.key !== 'string' || data.key.length === 0) {
    throw new Error('Malformed signing-key response');
  }

  return data.key;
}

/**
 * Return the per-session signing key, fetching and caching it on first use.
 * Concurrent callers share a single in-flight request.
 */
export async function getSigningKey(): Promise<string> {
  if (cachedKey && Date.now() - cachedKey.fetchedAt < KEY_MAX_AGE_MS) {
    return cachedKey.key;
  }

  if (!inflight) {
    inflight = fetchSigningKey()
      .then((key) => {
        cachedKey = { key, fetchedAt: Date.now() };
        return key;
      })
      .finally(() => {
        inflight = null;
      });
  }

  return inflight;
}

/**
 * Generate an HMAC-SHA256 signature for a request.
 *
 * Frontend usage:
 *   const signature = await generateRequestSignatureAsync('POST', '/api/rewards/claim', body, timestamp);
 */
export async function generateRequestSignatureAsync(
  method: string,
  path: string,
  body: any,
  timestamp: number
): Promise<string> {
  const signingKey = await getSigningKey();

  const message = `${method}|${path}|${JSON.stringify(body)}|${timestamp}`;
  const encoder = new TextEncoder();
  const data = encoder.encode(message);
  const keyData = encoder.encode(signingKey);

  if (typeof window !== 'undefined' && crypto?.subtle) {
    // Preferred path: leverage Web Crypto API when available
    const key = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );

    const signature = await crypto.subtle.sign('HMAC', key, data);
    const hashArray = Array.from(new Uint8Array(signature));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  // Fallback for environments without Web Crypto (e.g., some in-app browsers or HTTP contexts)
  try {
    const [{ hmac }, { sha256 }, { bytesToHex }] = await Promise.all([
      import('@noble/hashes/hmac'),
      import('@noble/hashes/sha256'),
      import('@noble/hashes/utils')
    ]);

    const mac = hmac.create(sha256, keyData);
    mac.update(data);
    return bytesToHex(mac.digest());
  } catch (fallbackError) {
    console.error('Request signature fallback failed', fallbackError);
    throw new Error('WebCrypto API not available');
  }
}

/**
 * Synchronous version (returns pending placeholder - use async version instead)
 * Kept for backward compatibility
 */
export function generateRequestSignature(
  method: string,
  path: string,
  body: any,
  timestamp: number
): string {
  // Only available in browser with WebCrypto
  if (typeof window === 'undefined') {
    throw new Error('generateRequestSignature can only be called from browser');
  }

  // Return a placeholder that will be computed async
  return `pending:${timestamp}`;
}
