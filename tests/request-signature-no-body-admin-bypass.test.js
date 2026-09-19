// Regression test for OOS #1 (sibling bypass): lib/requestSignature.server.ts
// verifyRequestSignatureAsync skipped signature verification whenever the request BODY named
// an admin wallet (body.address / body.wallet) — the body is exactly what the signature is
// supposed to protect. L2 must verify the signature for every request it is asked about.
//
// R11 update: the signing key is now PER-SESSION. verifyRequestSignature no longer holds a
// global secret and no longer dual-accepts the retired public constant; it verifies against
// req._sessionSigningKey, which enforceWalletApiSecurity derives from the caller's session.
// The two positive-path tests below keep their original intent ("a correctly signed request
// verifies") and only change HOW the request is signed. The negative assertions are unchanged,
// and new ones pin the retired constant and the fail-closed path.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

require('ts-node').register({
  transpileOnly: true,
  compilerOptions: { module: 'commonjs', moduleResolution: 'node', target: 'ES2017', jsx: 'react' },
});

const stub = (relPath, exports) => {
  const resolved = require.resolve(relPath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
};

const ADMIN = 'ADMINWALLETAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

stub('../lib/adminCheck', {
  __esModule: true,
  isAdminWallet: async (a) => a === ADMIN,
  isAdminRequest: async () => false,
});
stub('../lib/securityEventAggregation', { __esModule: true, logSecurityEventAggregated: async () => {} });

// deriveSigningKey reads REQUEST_SIGNATURE_SECRET at call time; set it before import so the
// derivation tests below exercise the real code path rather than a throw.
process.env.REQUEST_SIGNATURE_SECRET =
  process.env.REQUEST_SIGNATURE_SECRET || 'unit-test-server-secret';

const {
  verifyRequestSignatureAsync,
  deriveSigningKey,
} = require('../lib/requestSignature.server.ts');

const PATH = '/api/rewards/get-rewards-page';

// The retired constant that used to ship in the client bundle and be dual-accepted server-side.
const RETIRED_PUBLIC_CONSTANT = 'fry-rewards-signature-v1-';

// A per-session key, as enforceWalletApiSecurity would derive and attach.
const SESSION_KEY = deriveSigningKey(ADMIN, '2099-01-01T00:00:00.000Z');

const sign = (body, ts, secret = SESSION_KEY) =>
  crypto.createHmac('sha256', secret).update(`POST|${PATH}|${JSON.stringify(body)}|${ts}`).digest('hex');
const now = () => Math.floor(Date.now() / 1000);
const mkReq = (body) => ({
  method: 'POST',
  url: PATH,
  headers: {},
  body,
  _sessionSigningKey: SESSION_KEY,
});
const mkReqNoKey = (body) => ({ method: 'POST', url: PATH, headers: {}, body });
const BAD_SIG = 'f'.repeat(64);

test('body.address naming an admin no longer bypasses signature verification', async () => {
  const body = { miner_key: 'FEM-TEST', address: ADMIN };
  assert.equal(await verifyRequestSignatureAsync('POST', PATH, body, now(), BAD_SIG, mkReq(body)), false);
});

test('body.wallet naming an admin no longer bypasses signature verification', async () => {
  const body = { miner_key: 'FEM-TEST', wallet: ADMIN };
  assert.equal(await verifyRequestSignatureAsync('POST', PATH, body, now(), BAD_SIG, mkReq(body)), false);
});

test('a correctly signed request still verifies (per-session key)', async () => {
  const body = { miner_key: 'FEM-TEST', page: 1 };
  const ts = now();
  assert.equal(await verifyRequestSignatureAsync('POST', PATH, body, ts, sign(body, ts), mkReq(body)), true);
});

test('a correctly signed request that happens to name an admin verifies on its signature', async () => {
  const body = { miner_key: 'FEM-TEST', address: ADMIN };
  const ts = now();
  assert.equal(await verifyRequestSignatureAsync('POST', PATH, body, ts, sign(body, ts), mkReq(body)), true);
});

test('a stale timestamp is still rejected', async () => {
  const body = { miner_key: 'FEM-TEST' };
  const ts = now() - 1000;
  assert.equal(await verifyRequestSignatureAsync('POST', PATH, body, ts, sign(body, ts), mkReq(body)), false);
});

// ---- R11 additions: the removed vulnerability, pinned. ----

test('R11: the retired public constant is no longer accepted (dual-accept removed)', async () => {
  const body = { miner_key: 'FEM-TEST', page: 1 };
  const ts = now();
  const sig = sign(body, ts, RETIRED_PUBLIC_CONSTANT);
  assert.equal(
    await verifyRequestSignatureAsync('POST', PATH, body, ts, sig, mkReq(body)),
    false,
    'a signature minted with the old bundle-readable constant must be rejected'
  );
});

test('R11: a request carrying no per-session key fails closed', async () => {
  const body = { miner_key: 'FEM-TEST', page: 1 };
  const ts = now();
  assert.equal(
    await verifyRequestSignatureAsync('POST', PATH, body, ts, sign(body, ts), mkReqNoKey(body)),
    false,
    'without a derived session key there is nothing to verify against; must not pass'
  );
});

test('R11: a key minted for one session cannot sign for another', async () => {
  const keyA = deriveSigningKey('WALLETAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', '2099-01-01T00:00:00.000Z');
  const keyB = deriveSigningKey('WALLETBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB', '2099-01-01T00:00:00.000Z');
  assert.notEqual(keyA, keyB, 'different wallets must derive different keys');

  const sameWalletLaterSession = deriveSigningKey(
    'WALLETAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    '2099-06-01T00:00:00.000Z'
  );
  assert.notEqual(keyA, sameWalletLaterSession, 'a rotated session must derive a different key');

  // Signing with session B's key must not verify against a request bound to session A.
  const body = { miner_key: 'FEM-TEST', page: 1 };
  const ts = now();
  const sigB = crypto
    .createHmac('sha256', keyB)
    .update(`POST|${PATH}|${JSON.stringify(body)}|${ts}`)
    .digest('hex');
  const reqBoundToA = { method: 'POST', url: PATH, headers: {}, body, _sessionSigningKey: keyA };
  assert.equal(
    await verifyRequestSignatureAsync('POST', PATH, body, ts, sigB, reqBoundToA),
    false,
    'cross-session replay must be rejected'
  );
});
