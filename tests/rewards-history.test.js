// Regression test for the /api/rewards/history stub (completion run 1785182603).
// Pre-fix the handler answered every request with 200 {"claims":[],"deferred":true},
// so a user saw a fabricated empty history instead of an honest contract. These
// assertions all fail against that stub and pass against the wallet-scoped handler.
const assert = require('node:assert/strict');
const test = require('node:test');

const BASE = process.env.DASHB_BASE_URL || 'http://127.0.0.1:3007';
const PATH = '/api/rewards/history';
const VALID_WALLET = 'E2F2LT2INE75DBOYHQXTCTOP2PAP5MHAXQRXTTCCXFKHQTVG36DJONBQZE';

async function call(path, init) {
  const res = await fetch(`${BASE}${path}`, init);
  let body = null;
  try { body = await res.json(); } catch { body = null; }
  return { status: res.status, body };
}

test('rejects non-GET methods instead of returning a stub payload', async () => {
  const { status, body } = await call(PATH, { method: 'POST' });
  assert.equal(status, 405);
  assert.equal(body.success, false);
});

test('requires a wallet query parameter', async () => {
  const { status, body } = await call(PATH);
  assert.equal(status, 400);
  assert.equal(body.success, false);
});

test('rejects a malformed wallet address', async () => {
  const { status, body } = await call(`${PATH}?wallet=NOTAWALLET`);
  assert.equal(status, 400);
  assert.equal(body.success, false);
});

test('returns a real claims array for a valid wallet and never reports deferred', async () => {
  const { status, body } = await call(`${PATH}?wallet=${VALID_WALLET}`);
  assert.equal(status, 200);
  assert.equal(body.success, true);
  assert.ok(Array.isArray(body.claims));
  assert.equal(body.deferred, undefined);
  for (const claim of body.claims) {
    assert.equal(claim.claimingAddress ?? VALID_WALLET, VALID_WALLET);
    assert.equal(claim.signedServerLegsB64, undefined);
  }
});
