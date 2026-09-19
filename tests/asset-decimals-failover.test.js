// Regression test for the live claim blocker found during dashfix-20260807 verification:
// the indexer client is derived from ALGOD_URL (self-hosted ATLAS00 node). With that node
// down, lookupAssetByID threw "fetch failed", getAssetDecimals returned null and
// /api/rewards/claim answered 503 "Could not verify on-chain data" for every user.
// Asset params are public data, so a failed private lookup must fall back to the public
// indexers instead of blocking claims.

const test = require('node:test');
const assert = require('node:assert/strict');

require('ts-node').register({
  transpileOnly: true,
  compilerOptions: { module: 'commonjs', moduleResolution: 'node', target: 'ES2017', jsx: 'react' },
});

const ASSET = 2485202024;

const stub = (relPath, exports) => {
  const resolved = require.resolve(relPath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
};

const state = { indexer: 'down', fetch: 'ok', fetched: [] };

stub('../lib/wallet/clients', {
  __esModule: true,
  getAlgodClient: () => ({}),
  getIndexerClient: () => ({
    lookupAssetByID: () => ({
      do: async () => {
        if (state.indexer === 'down') throw new TypeError('fetch failed');
        // algosdk 3.x hands back modeled values; decimals can arrive as a bigint.
        return { asset: { params: { decimals: BigInt(6) } } };
      },
    }),
    lookupAccountByID: () => ({ do: async () => ({}) }),
  }),
  resetClients: () => {},
});

const originalFetch = global.fetch;
global.fetch = async (url) => {
  state.fetched.push(String(url));
  if (state.fetch === 'down') throw new Error('network down');
  return {
    ok: true,
    json: async () => ({ asset: { params: { decimals: 6 } } }),
  };
};

const { getAssetDecimals } = require('../lib/utils.ts');

test('falls back to a public indexer when the configured one is unreachable', async () => {
  state.indexer = 'down';
  state.fetch = 'ok';
  state.fetched = [];
  const decimals = await getAssetDecimals(ASSET);
  assert.equal(decimals, 6, 'a claim must not fail because the self-hosted node is down');
  assert.ok(state.fetched.length > 0, 'no fallback lookup was attempted');
  assert.match(state.fetched[0], /\/v2\/assets\/2485202024$/);
});

test('uses the configured indexer when it works, and coerces bigint decimals to a number', async () => {
  state.indexer = 'ok';
  state.fetch = 'down';
  state.fetched = [];
  const decimals = await getAssetDecimals(ASSET);
  assert.equal(typeof decimals, 'number', 'callers reject non-number decimals with a 503');
  assert.equal(decimals, 6);
  assert.equal(state.fetched.length, 0, 'no fallback needed when the primary answers');
});

test('returns null only when every lookup path fails', async () => {
  state.indexer = 'down';
  state.fetch = 'down';
  const decimals = await getAssetDecimals(ASSET);
  assert.equal(decimals, null);
});

test.after(() => {
  global.fetch = originalFetch;
});
