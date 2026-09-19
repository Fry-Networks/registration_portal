// Regression test for OOS #1 (sibling bypass): lib/deviceFingerprint.ts returned 'ok' for any
// request carrying the bare header `x-internal-request: next-ssr`. Nothing in the tree ever
// sets that header, so it was a client-controlled skip of the L4 device-fingerprint layer.
// The env kill switch (DISABLE_DEVICE_FINGERPRINT) and the session-derived admin bypass stay.
const test = require('node:test');
const assert = require('node:assert/strict');

require('ts-node').register({
  transpileOnly: true,
  compilerOptions: { module: 'commonjs', moduleResolution: 'node', target: 'ES2017', jsx: 'react' },
});

const stub = (relPath, exports) => {
  const resolved = require.resolve(relPath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
};

stub('../lib/securityEventAggregation', { __esModule: true, logSecurityEventAggregated: async () => {} });
delete process.env.DISABLE_DEVICE_FINGERPRINT;

const { verifyDeviceFingerprintMiddleware, generateDeviceFingerprint } = require('../lib/deviceFingerprint.ts');

const mkReq = (extra = {}) => ({
  method: 'POST',
  url: '/api/x',
  body: {},
  headers: {
    'user-agent': 'qa-probe/1.0',
    accept: 'application/json',
    'accept-language': 'en-US',
    'accept-encoding': 'identity',
    ...extra,
  },
});
// fingerprintState is a module-global map keyed by wallet: use a distinct wallet per test.
const run = (req, session, isAdmin, wallet) =>
  verifyDeviceFingerprintMiddleware(req, session, isAdmin, { walletAddress: wallet, minerKey: 'FEM-TEST' });

test('x-internal-request: next-ssr no longer bypasses L4 when the session has no fingerprint', async () => {
  const r = await run(mkReq({ 'x-internal-request': 'next-ssr' }), { user: { address: 'W1' }, deviceFingerprint: null }, false, 'W1');
  assert.equal(r, 'retry');
});

test('x-internal-request: next-ssr no longer bypasses L4 on a fingerprint mismatch', async () => {
  const r = await run(mkReq({ 'x-internal-request': 'next-ssr' }), { user: { address: 'W2' }, deviceFingerprint: 'a'.repeat(64) }, false, 'W2');
  assert.notEqual(r, 'ok');
});

test('the header value is not honoured in any casing', async () => {
  const r = await run(mkReq({ 'x-internal-request': 'NEXT-SSR' }), { user: { address: 'W3' }, deviceFingerprint: null }, false, 'W3');
  assert.notEqual(r, 'ok');
});

test('a matching fingerprint still passes', async () => {
  const req = mkReq();
  const r = await run(req, { user: { address: 'W4' }, deviceFingerprint: generateDeviceFingerprint(req) }, false, 'W4');
  assert.equal(r, 'ok');
});

test('admin sessions still bypass L4', async () => {
  const r = await run(mkReq(), { user: { address: 'W5' }, deviceFingerprint: null }, true, 'W5');
  assert.equal(r, 'ok');
});

test('the DISABLE_DEVICE_FINGERPRINT kill switch is retained', async () => {
  process.env.DISABLE_DEVICE_FINGERPRINT = 'true';
  try {
    const r = await run(mkReq(), { user: { address: 'W6' }, deviceFingerprint: null }, false, 'W6');
    assert.equal(r, 'ok');
  } finally {
    delete process.env.DISABLE_DEVICE_FINGERPRINT;
  }
});
