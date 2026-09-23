// R12b — L1 self-heal on the reward/POST paths, and the anonymous warm-up gate.
//
// Two symptoms followed the R12 deploy (545d165, which replaced the shared hardcoded L1 literal
// with a per-session token issued by GET /api/auth/signing-key):
//
//   SYMPTOM 1 — browsers still running the PRE-R12 bundle replay the retired
//   sha256('fry-rewards-client-' + userAgent) value and are refused 403 INVALID_CLIENT_TOKEN.
//   lib/api/secureFetch.ts already heals that with one refreshClientToken() + one retry, but the
//   DIMO page built its own headers inline (pages/dimo.tsx fetchWithSignature) and therefore
//   never force-refreshed: lib/clientToken.ts caches for 10 minutes, so a tab that had cached a
//   token stayed broken for the whole cache window with no way back.
//
//   SYMPTOM 2 — pages/_app.tsx warmed the token cache from a mount-once effect that ran before
//   any session existed, so every ANONYMOUS page load fired GET /api/auth/signing-key -> 401
//   SESSION_REQUIRED and logged "[ClientToken] Failed to resolve token". Pre-R12 the L1 value was
//   computed locally and no network call happened at all.
//
// The contract pinned here:
//   (a) a non-claim DIMO POST goes through secureFetch, so it inherits the single-shot
//       refresh-and-retry instead of carrying a second, un-healing copy of the header logic;
//   (b) NEGATIVE: /api/dimo/claim is a CLAIM SUBMIT and stays on exactly one attempt — this
//       round deliberately adds no retry to claim submit or confirm;
//   (c) the warm-up only runs for an authenticated session;
//   (d) the warm-up issues NO network call while anonymous or still loading;
//   (e) pages/_app.tsx no longer warms the cache itself.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

require('ts-node').register({
  transpileOnly: true,
  compilerOptions: { module: 'commonjs', moduleResolution: 'node', target: 'ES2017', jsx: 'react' },
});

const ROOT = path.resolve(__dirname, '..');

const stub = (relPath, exports) => {
  const resolved = require.resolve(relPath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
};

// ---------------------------------------------------------------- stubs
const secureCalls = [];
stub('../lib/api/secureFetch', {
  __esModule: true,
  secureFetch: async (endpoint, payload, options = {}) => {
    secureCalls.push({ endpoint, payload, method: options.method });
    return { status: 200, ok: true, __via: 'secureFetch' };
  },
});

let getTokenCalls = 0;
let refreshTokenCalls = 0;
stub('../lib/clientToken', {
  __esModule: true,
  getClientToken: async () => {
    getTokenCalls += 1;
    return 'dimo-token-1';
  },
  refreshClientToken: async () => {
    refreshTokenCalls += 1;
    return 'dimo-token-2';
  },
  resetClientToken: () => {},
});

stub('../lib/requestSignature.client', {
  __esModule: true,
  generateRequestSignatureAsync: async () => 'test-signature',
  recoverFromSignatureRejection: () => false,
});

stub('../lib/serverTime', {
  __esModule: true,
  getServerTimestamp: () => 1790000000,
});

// A React stub whose useEffect runs the effect body synchronously, so the hook can be driven
// without a renderer. Contained to this file: node --test gives each test file its own process.
const effectCleanups = [];
stub('react', {
  __esModule: true,
  useEffect: (fn) => {
    const cleanup = fn();
    if (typeof cleanup === 'function') effectCleanups.push(cleanup);
  },
});

const directFetchCalls = [];
if (!Object.prototype.hasOwnProperty.call(global, 'window')) global.window = {};
global.fetch = async (url, init) => {
  directFetchCalls.push({ url: String(url), init });
  return { status: 200, ok: true, __via: 'directFetch' };
};

// ---------------------------------------------------------------- (a)+(b) DIMO
test('(a) a non-claim DIMO POST is issued through secureFetch, inheriting the single-shot L1 retry', async () => {
  const { dimoFetch } = require('../lib/api/dimoFetch.ts');

  secureCalls.length = 0;
  directFetchCalls.length = 0;

  const res = await dimoFetch('/api/dimo/eligible', 'POST', { minerKey: 'FEM-TEST' });

  assert.equal(secureCalls.length, 1, 'the DIMO POST must be delegated to secureFetch exactly once');
  assert.equal(secureCalls[0].endpoint, '/api/dimo/eligible');
  assert.equal(secureCalls[0].method, 'POST');
  assert.deepEqual(secureCalls[0].payload, { minerKey: 'FEM-TEST' });
  assert.equal(
    directFetchCalls.length,
    0,
    'it must NOT build its own x-client-token request: that path cannot force-refresh a stale token'
  );
  assert.equal(res.__via, 'secureFetch');
});

test('(b) NEGATIVE: /api/dimo/claim is a claim submit and stays on a single, un-retried attempt', async () => {
  const { dimoFetch, CLAIM_SUBMIT_ENDPOINTS } = require('../lib/api/dimoFetch.ts');

  secureCalls.length = 0;
  directFetchCalls.length = 0;
  refreshTokenCalls = 0;

  assert.ok(
    CLAIM_SUBMIT_ENDPOINTS.has('/api/dimo/claim'),
    '/api/dimo/claim must be declared a claim-submit endpoint'
  );

  await dimoFetch('/api/dimo/claim', 'POST', { subscriptionId: 'sub-1' });

  assert.equal(secureCalls.length, 0, 'a claim submit must not be routed through the retrying helper');
  assert.equal(directFetchCalls.length, 1, 'a claim submit makes exactly one attempt');
  assert.equal(refreshTokenCalls, 0, 'a claim submit must not refresh-and-retry');
  assert.equal(
    directFetchCalls[0].init.headers['x-client-token'],
    'dimo-token-1',
    'the single attempt still carries the L1 token'
  );
});

// ---------------------------------------------------------------- (c)+(d) warm-up gate
test('(c) the warm-up gate is open only for an authenticated session', () => {
  const { shouldWarmClientToken } = require('../lib/hooks/useClientTokenWarmup.ts');

  assert.equal(shouldWarmClientToken('authenticated'), true);
  assert.equal(shouldWarmClientToken('unauthenticated'), false);
  assert.equal(shouldWarmClientToken('loading'), false);
});

test('(d) the warm-up makes no token call while anonymous or loading, and exactly one once authenticated', async () => {
  const { useClientTokenWarmup } = require('../lib/hooks/useClientTokenWarmup.ts');

  getTokenCalls = 0;

  useClientTokenWarmup('loading');
  useClientTokenWarmup('unauthenticated');
  await new Promise((r) => setImmediate(r));
  assert.equal(
    getTokenCalls,
    0,
    'an anonymous page load must not resolve a client token: that is the 401 SESSION_REQUIRED + ' +
      '"[ClientToken] Failed to resolve token" pair seen on every anonymous load after R12'
  );

  useClientTokenWarmup('authenticated');
  await new Promise((r) => setImmediate(r));
  assert.equal(getTokenCalls, 1, 'a signed-in session still warms the cache exactly once');
});

// ---------------------------------------------------------------- (e) _app no longer warms
test('(e) pages/_app.tsx no longer warms the token cache itself', () => {
  const src = fs.readFileSync(path.join(ROOT, 'pages/_app.tsx'), 'utf8');

  assert.ok(
    !/getClientToken\s*\(/.test(src),
    'pages/_app.tsx must not call getClientToken() directly; the gated hook owns the warm-up'
  );
  assert.ok(
    /useClientTokenWarmup\s*\(/.test(src),
    'pages/_app.tsx must warm the cache through the session-gated hook'
  );
});
