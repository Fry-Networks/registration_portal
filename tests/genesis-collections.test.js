// Regression test for the Genesis mint banner (dashfix-round3).
//
// The banner hardcoded MINTED_COUNT = 6 / TOTAL_SUPPLY = 1000 and queried nothing, while the
// chain said fry.farm Genesis Pass (app 3509410324) had 13 of 1000 minted. The config endpoint
// only ever read Fry Fee Genesis (3636406117). It must now report BOTH collections, and a
// collection whose on-chain read fails must say so rather than claim zero mints.

const test = require('node:test');
const assert = require('node:assert/strict');

require('ts-node').register({
  transpileOnly: true,
  compilerOptions: { module: 'commonjs', moduleResolution: 'node', target: 'ES2017', jsx: 'react' },
});

const PASS_APP = 3509410324;
const FFG_APP = 3636406117;

const stub = (relPath, exports) => {
  const resolved = require.resolve(relPath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
};

// Global-state entries in the algosdk v2 shape the decoder already handles.
const gs = (obj) => ({
  params: {
    'global-state': Object.entries(obj).map(([k, v]) => ({
      key: Buffer.from(k).toString('base64'),
      value: { uint: v, type: 2 },
    })),
  },
});

const state = { passOk: true, ffgOk: true };

stub('../lib/mongoclient', {
  __esModule: true,
  default: Promise.resolve({
    db: () => ({ collection: () => ({ findOne: async () => null }) }),
  }),
});

stub('../lib/algorand/failover', {
  __esModule: true,
  AlgodUnavailableError: class AlgodUnavailableError extends Error {},
  getFailoverAccountInfo: async () => ({}),
  getFailoverAssetBalance: async () => 0,
  getFailoverAlgodClient: async () => ({
    getApplicationByID: (appId) => ({
      do: async () => {
        if (appId === PASS_APP) {
          if (!state.passOk) throw new Error('pass app unreachable');
          return gs({ max_supply: 1000, total_minted: 13, paused: 0, mint_price: 175000000, mint_asset_id: 31566704 });
        }
        if (!state.ffgOk) throw new Error('ffg app unreachable');
        return gs({ max_supply: 2000, total_minted: 0, paused: 0, mint_price: 175000000, mint_asset_id: 31566704 });
      },
    }),
  }),
});

const handler = require('../pages/api/genesis/fry-fee/config.ts').default;

const call = async () => {
  const captured = { code: 0, body: null, headers: {} };
  const res = {
    setHeader(k, v) { captured.headers[k] = v; return res; },
    status(c) { captured.code = c; return res; },
    json(b) { captured.body = b; return res; },
  };
  await handler({ method: 'GET', query: {} }, res);
  return captured;
};

const byKey = (body, key) => (body.collections || []).find((c) => c.key === key);

test('both collections are reported with their own live counts', async () => {
  state.passOk = true; state.ffgOk = true;
  const { code, body } = await call();
  assert.equal(code, 200);
  assert.ok(Array.isArray(body.collections), 'no collections array');
  assert.equal(body.collections.length, 2);

  const pass = byKey(body, 'genesis_pass');
  assert.ok(pass, 'fry.farm Genesis Pass missing');
  assert.equal(pass.app_id, PASS_APP);
  assert.equal(pass.total_supply, 1000);
  assert.equal(pass.total_minted, 13, 'Genesis Pass count must come from chain, not a constant');
  assert.equal(pass.degraded, false);

  const ffg = byKey(body, 'fry_fee_genesis');
  assert.ok(ffg, 'Fry Fee Genesis missing');
  assert.equal(ffg.app_id, FFG_APP);
  assert.equal(ffg.total_supply, 2000);
  assert.equal(ffg.total_minted, 0);
});

test('an unreadable collection reports degraded, never zero, and does not hide the other', async () => {
  state.passOk = false; state.ffgOk = true;
  const { code, body } = await call();
  assert.equal(code, 200);

  const pass = byKey(body, 'genesis_pass');
  assert.equal(pass.degraded, true);
  assert.equal(pass.total_minted, null, 'a failed read must not report 0 minted');

  const ffg = byKey(body, 'fry_fee_genesis');
  assert.equal(ffg.degraded, false, 'one bad app must not blank the other');
  assert.equal(ffg.total_minted, 0);
});

test('legacy top-level fields still describe Fry Fee Genesis for existing consumers', async () => {
  state.passOk = true; state.ffgOk = true;
  const { body } = await call();
  assert.equal(body.app_id, FFG_APP);
  assert.equal(body.total_supply, 2000);
  assert.equal(body.total_minted, 0);
  assert.equal(body.paused, false);
  assert.ok(body.active_token, 'active_token dropped');
});

test('the response is cacheable so a shell-mounted banner does not re-read the chain per page', async () => {
  const { headers } = await call();
  assert.match(String(headers['Cache-Control'] || ''), /max-age=\d+/);
});
