import type { NextApiRequest, NextApiResponse } from 'next';

/**
 * Same-origin proxy for the Algorand reads the dashboard's own browser code performs.
 *
 * Why this exists: the public algonode endpoints are quota-limited and answer browsers with
 * 403 once the shared quota is spent, which reached users as "Error fetching balances".
 * Server-side code already prefers the self-hosted node through ALGOD_URL, but ALGOD_URL is
 * not a NEXT_PUBLIC_* variable, so it is undefined in client bundles (see lib/wallet/config.ts)
 * and the browser kept falling through to algonode. The self-hosted node is on Tailscale CGNAT
 * (100.64.0.0/10) and is NOT publicly routable, so pointing client code straight at it would
 * convert a 403 into a hard connection failure. Routing browser traffic through this route puts
 * it on the self-hosted node without publishing a private address to the internet.
 *
 * This is a proxy for THIS application, not a general-purpose relay: the upstream origin is
 * fixed by environment, and only the specific paths the dashboard calls are forwarded.
 */

export type AllowRule = { method: 'GET' | 'POST'; pattern: RegExp };

const ADDR = '[A-Z2-7]{58}';
const TXID = '[A-Z2-7]{52}';

/**
 * Allowlisted algod paths, anchored, matched against the joined path segments.
 *
 * POST v2/transactions is included deliberately. The claim, swap and stake flows submit through
 * the very same shared Algodv2 instance they read with (5 client call sites use
 * sendRawTransaction), so a read-only allowlist would not restrict this route, it would break
 * those flows outright. The payload is an already-signed transaction: the network validates the
 * signature and charges fees to the sender, so relaying one costs this node bandwidth and
 * nothing else.
 */
export const ALGOD_ALLOWLIST: AllowRule[] = [
  { method: 'GET', pattern: /^v2\/status$/ },
  { method: 'GET', pattern: new RegExp('^v2/status/wait-for-block-after/\\d+$') },
  { method: 'GET', pattern: /^v2\/transactions\/params$/ },
  { method: 'GET', pattern: new RegExp(`^v2/transactions/pending/${TXID}$`) },
  { method: 'GET', pattern: new RegExp(`^v2/accounts/${ADDR}$`) },
  { method: 'GET', pattern: new RegExp(`^v2/accounts/${ADDR}/assets/\\d+$`) },
  { method: 'GET', pattern: /^v2\/assets\/\d+$/ },
  { method: 'GET', pattern: /^v2\/applications\/\d+$/ },
  { method: 'GET', pattern: /^v2\/applications\/\d+\/box$/ },
  { method: 'POST', pattern: /^v2\/transactions$/ },
];

/** Allowlisted indexer paths. Reads only -- the indexer has no write surface. */
export const INDEXER_ALLOWLIST: AllowRule[] = [
  { method: 'GET', pattern: /^v2\/assets\/\d+$/ },
  { method: 'GET', pattern: new RegExp(`^v2/accounts/${ADDR}$`) },
  { method: 'GET', pattern: new RegExp(`^v2/accounts/${ADDR}/transactions$`) },
  { method: 'GET', pattern: /^v2\/assets\/\d+\/balances$/ },
  { method: 'GET', pattern: /^v2\/transactions$/ },
];

const MAX_BODY_BYTES = 1024 * 1024; // one signed txn group is orders of magnitude smaller
const UPSTREAM_TIMEOUT_MS = 8000;

/**
 * Join the catch-all segments, rejecting anything that could escape the upstream origin.
 * Next.js has already percent-decoded these, so a segment containing a separator or a dot-dot
 * is an escape attempt rather than a legitimate path element.
 */
export const joinPath = (raw: string | string[] | undefined): string | null => {
  const segments = Array.isArray(raw) ? raw : raw ? [raw] : [];
  if (segments.length === 0) return null;
  for (const segment of segments) {
    if (!segment) return null;
    if (segment === '.' || segment === '..') return null;
    if (segment.includes('/') || segment.includes('\\')) return null;
  }
  return segments.join('/');
};

export const isAllowed = (rules: AllowRule[], method: string, path: string): boolean =>
  rules.some((rule) => rule.method === method && rule.pattern.test(path));

/** Strip a trailing slash so joining never produces a double separator. */
const trimSlash = (value: string): string => value.replace(/\/+$/, '');

export const algodUpstreams = (): string[] => {
  const primary = process.env.ALGOD_URL ? trimSlash(process.env.ALGOD_URL) : '';
  // The public nodes stay as a fallback on purpose: a self-hosted node outage should degrade
  // to slower public reads rather than taking every balance on the dashboard down with it.
  return [primary, 'https://mainnet-api.4160.nodely.dev', 'https://mainnet-api.algonode.cloud'].filter(Boolean);
};

/**
 * Indexer upstreams.
 *
 * There is deliberately no INDEXER_TOKEN. Measured 2026-09-15: the self-hosted node at ATLAS00
 * serves algod on :8190 but does NOT run an indexer (:8980 and :8981 are unreachable), and neither
 * INDEXER_URL nor INDEXER_TOKEN is declared in compose or present in the container environment.
 * With INDEXER_URL unset the primary entry is filtered out below and every indexer read goes to the
 * public endpoints, which take no token. Setting INDEXER_TOKEN would therefore change nothing --
 * it is absent because there is no upstream to authenticate to, not because it was forgotten.
 * If a self-hosted indexer is ever deployed, set INDEXER_URL first; the token plumbing already works.
 */
export const indexerUpstreams = (): string[] => {
  const primary = process.env.INDEXER_URL ? trimSlash(process.env.INDEXER_URL) : '';
  return [primary, 'https://mainnet-idx.4160.nodely.dev', 'https://mainnet-idx.algonode.cloud'].filter(Boolean);
};

/** Only these warrant trying the next upstream; a 400 from algod is a real answer, not an outage. */
const shouldFailOver = (status: number): boolean => status === 403 || status === 429 || status >= 500;

// Uint8Array rather than Buffer throughout: Buffer's ArrayBufferLike backing store is not
// assignable to the DOM BodyInit/Uint8Array<ArrayBuffer> types this project compiles against.
const readRawBody = (req: NextApiRequest): Promise<Uint8Array<ArrayBuffer>> =>
  new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let size = 0;
    req.on('data', (chunk: Uint8Array) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const joined = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        joined.set(chunk, offset);
        offset += chunk.length;
      }
      resolve(joined);
    });
    req.on('error', reject);
  });

export const proxyAlgorandRequest = async (
  req: NextApiRequest,
  res: NextApiResponse,
  opts: { rules: AllowRule[]; upstreams: string[]; token?: string; tokenHeader?: string },
): Promise<void> => {
  // Never let the CDN or a browser cache an account balance or a pending-transaction lookup.
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');

  const method = (req.method || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'POST') {
    res.status(405).json({ message: 'method not allowed' });
    return;
  }

  const path = joinPath(req.query.path as string | string[] | undefined);
  if (!path || !isAllowed(opts.rules, method, path)) {
    // Deliberately terse: do not echo the attempted path back to the caller.
    res.status(404).json({ message: 'not found' });
    return;
  }

  let body: Uint8Array<ArrayBuffer> | undefined;
  if (method === 'POST') {
    try {
      body = await readRawBody(req);
    } catch {
      res.status(413).json({ message: 'request body too large' });
      return;
    }
  }

  // Forward algod's own query parameters (format=msgpack, max, etc.) but never the catch-all key.
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(req.query)) {
    if (key === 'path') continue;
    if (Array.isArray(value)) value.forEach((v) => search.append(key, v));
    else if (value !== undefined) search.append(key, value);
  }
  const qs = search.toString();

  const failures: string[] = [];
  for (const upstream of opts.upstreams) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
    try {
      const headers: Record<string, string> = { accept: req.headers.accept || 'application/json' };
      if (req.headers['content-type']) headers['content-type'] = String(req.headers['content-type']);
      // The token belongs to the self-hosted node only; never attach it to a public fallback.
      if (opts.token && upstream === opts.upstreams[0]) {
        headers[opts.tokenHeader || 'X-Algo-API-Token'] = opts.token;
      }

      const upstreamRes = await fetch(`${upstream}/${path}${qs ? `?${qs}` : ''}`, {
        method,
        headers,
        body,
        signal: controller.signal,
      });

      if (shouldFailOver(upstreamRes.status)) {
        failures.push(`${upstreamRes.status}`);
        if (upstream !== opts.upstreams[opts.upstreams.length - 1]) continue;
        // Every upstream has now failed over, including the last. Returning the last one's body
        // verbatim would hand the caller a raw `403 Daily free API quota exceeded` from a public
        // node -- which looks like an Algorand API response and hides the real condition. Say
        // plainly that the upstreams are exhausted, and surface the statuses that got us here.
        res.status(502).json({
          message: 'all algorand upstreams exhausted',
          attempts: failures.length,
          statuses: failures,
        });
        return;
      }

      // end() rather than send(): the payload may be msgpack, and send() would try to serialise it.
      const payload = new Uint8Array(await upstreamRes.arrayBuffer());
      const contentType = upstreamRes.headers.get('content-type');
      if (contentType) res.setHeader('content-type', contentType);
      res.status(upstreamRes.status).end(payload);
      return;
    } catch (err) {
      failures.push(err instanceof Error ? err.name : 'error');
      continue;
    } finally {
      clearTimeout(timer);
    }
  }

  // Upstream hostnames are intentionally absent from this message: the primary is a private address.
  res.status(503).json({ message: 'algorand node unavailable', attempts: failures.length });
};
