// Regression tests (Stream 3 journey QA, 2026-09-11): the stake routes answered an EMPTY HTTP 500 for a
// wallet that has not opted into the staking asset. Each route awaited ensureWalletAssetOptIn()
// outside any handler, so the helper's `{ status: 400, response }` object was thrown raw into
// Next.js instead of being mapped to the 400 WALLET_ASSET_NOT_OPTED_IN payload the claim path returns
// for the same condition. Behavioural tests for the three stake routes (identical shape) + a text
// guard for all four call sites incl. fee/pay-withdraw.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

require('ts-node').register({
  transpileOnly: true,
  compilerOptions: { module: 'commonjs', moduleResolution: 'node', target: 'ES2017', jsx: 'react' },
});

const stub = (relPath, exports) => {
  const resolved = require.resolve(relPath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
};

const ADDR = 'QAWALLETAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const MINER = 'FEM-QATEST000000000000000000000000000';
const OPTIN_ERROR = {
  status: 400,
  response: { success: false, code: 'WALLET_ASSET_NOT_OPTED_IN', message: 'FRY2.0 (2485314946) must be opted into before staking.' },
};
const state = { lockCalls: 0 };

stub('../lib/mongoclient', { __esModule: true, default: Promise.resolve({ db: () => ({ collection: () => ({ findOne: async () => null, updateOne: async () => ({ matchedCount: 0 }) }) }) }) });
stub('../lib/api/enforceWalletSecurity', { __esModule: true, enforceWalletApiSecurity: async () => ({ session: { user: { address: ADDR } }, isAdmin: false }) });
stub('../lib/algorand/optIn', { __esModule: true, ensureWalletAssetOptIn: async () => { throw OPTIN_ERROR; } });
stub('../lib/monitoring/walletHealth', { __esModule: true, monitorWalletHealth: async () => {} });
stub('../lib/api/deviceAction', { __esModule: true, withDeviceActionLock: async () => { state.lockCalls++; } });
stub('../lib/logger', { __esModule: true, loggers: { apiError: () => {}, stakeOperation: () => {}, dbOperation: () => {} } });

const mkRes = () => {
  const res = { statusCode: 200, body: undefined, headersSent: false };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; res.headersSent = true; return res; };
  res.setHeader = () => res;
  return res;
};

const ROUTES = [
  ['pages/api/stake/verification.ts', { txId: 'QA-BOGUS', type: 'one', address: ADDR, miner_key: MINER, amount: 1, asset_id: '2485314946' }],
  ['pages/api/stake/node-staking.ts', { txId: 'QA-BOGUS', address: ADDR, miner_key: MINER, amount: 1, asset_id: '2485202024' }],
  ['pages/api/stake/registration.ts', { txId: 'QA-BOGUS', address: ADDR, miner_key: MINER, amount: 1, asset_id: '2485202024' }],
];

for (const [rel, body] of ROUTES) {
  test(`${rel}: an un-opted-in wallet gets the 400 WALLET_ASSET_NOT_OPTED_IN payload, not an unhandled 500`, async () => {
    const handler = require('../' + rel).default;
    const req = { method: 'POST', headers: {}, body };
    const res = mkRes();
    await handler(req, res); // pre-fix: rejects with the raw { status, response } object
    assert.equal(res.statusCode, 400);
    assert.equal(res.body?.code, 'WALLET_ASSET_NOT_OPTED_IN');
  });
  test(`${rel}: the opt-in refusal happens before the device lock / any stake write`, async () => {
    const handler = require('../' + rel).default;
    const before = state.lockCalls;
    await handler({ method: 'POST', headers: {}, body }, mkRes()).catch(() => {});
    assert.equal(state.lockCalls, before);
  });
}

// Text guard for every bare call site (incl. fee/pay-withdraw, whose handler needs on-chain stubs).
const ROOT = path.resolve(__dirname, '..');
const SUFFIX = process.env.OG_SOURCE_SUFFIX || '';
for (const rel of ['pages/api/stake/verification.ts', 'pages/api/stake/node-staking.ts', 'pages/api/stake/registration.ts', 'pages/api/fee/pay-withdraw.ts']) {
  test(`${rel}: the opt-in guard is wrapped and maps { status, response } to the HTTP response`, () => {
    const src = fs.readFileSync(path.join(ROOT, rel + SUFFIX), 'utf8').replace(/\r\n/g, '\n');
    const i = src.indexOf('await ensureWalletAssetOptIn(');
    assert.ok(i > 0, 'guard call present');
    const before = src.slice(Math.max(0, i - 200), i);
    const after = src.slice(i, i + 700);
    assert.match(before, /try \{\s*$/);
    assert.match(after, /catch \(guardError: any\)/);
    assert.match(after, /res\.status\(status\)\.json\(payload\);\s*\n\s*return;/);
  });
}
