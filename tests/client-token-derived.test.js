// R12 Task 3 — the L1 client token must be a PER-SESSION derived key, not a shared literal.
//
// Before R12 both lib/clientToken.ts (client) and lib/clientTokenMiddleware.ts (server) computed
// the token as sha256('<literal>' + userAgent) from the SAME hardcoded constant. That constant
// shipped inside the client bundle, so it was public: anyone could compute a valid x-client-token
// and L1 added no boundary at all. This mirrors the R11 L2 fix (lib/requestSignature.server.ts
// deriveSigningKey): the token is now HMAC(REQUEST_SIGNATURE_SECRET, session identity | userAgent),
// derived server-side and handed only to an authenticated caller by GET /api/auth/signing-key.
//
// These assertions pin, in order:
//   (a) the derivation is deterministic for the same (address, sid, userAgent) and differs per sid
//   (b) a token computed the LEGACY way is rejected
//   (c) the middleware fails closed when REQUEST_SIGNATURE_SECRET is unset
//   (d) the retired literal is gone from every source file under lib/

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
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

const ROOT = path.resolve(__dirname, '..');

const ADDR = 'SYNTHWALLETL1AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const OTHER_ADDR = 'SYNTHWALLETL1BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
const SID_A = '5a1d1a27-0000-4000-8000-00000000000a';
const SID_B = '5a1d1a27-0000-4000-8000-00000000000b';
const UA = 'test-client/1.0';

// The retired, publicly-known L1 constant. Kept here as a NEGATIVE CONTROL only: it is what the
// server must now REJECT. It is not a credential and grants nothing.
const RETIRED_L1_CONSTANT = 'fry-rewards-client-';

// Mutable session the stubbed next-auth/jwt hands back, so a single import can exercise both the
// authenticated and the anonymous path.
let currentJwt = { address: ADDR, sid: SID_A };

stub('next-auth/jwt', { __esModule: true, getToken: async () => currentJwt });
stub('../lib/securityEventAggregation', { __esModule: true, logSecurityEventAggregated: async () => {} });

process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || 'unit-test-nextauth-secret';
process.env.REQUEST_SIGNATURE_SECRET =
  process.env.REQUEST_SIGNATURE_SECRET || 'unit-test-server-secret';

const { deriveClientToken, verifyClientToken } = require('../lib/clientTokenMiddleware.ts');

const legacyToken = (userAgent) =>
  crypto.createHash('sha256').update(RETIRED_L1_CONSTANT + userAgent).digest('hex');

const mkRes = () => ({
  statusCode: 0,
  body: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(payload) {
    this.body = payload;
    return this;
  },
});

const mkReq = (token, userAgent = UA) => ({
  method: 'POST',
  url: '/api/rewards/claim',
  headers: { 'x-client-token': token, 'user-agent': userAgent },
  body: { miner_key: 'FEM-TESTKEY0000000000000000000000000' },
  query: {},
});

// ------------------------------------------------------------------ (a) derivation
test('(a) derivation is deterministic for the same (address, sid, userAgent)', () => {
  assert.equal(deriveClientToken(ADDR, SID_A, UA), deriveClientToken(ADDR, SID_A, UA));
  assert.match(deriveClientToken(ADDR, SID_A, UA), /^[0-9a-f]{64}$/);
});

test('(a) derivation differs for a different sid, address or userAgent', () => {
  const base = deriveClientToken(ADDR, SID_A, UA);
  assert.notEqual(base, deriveClientToken(ADDR, SID_B, UA));
  assert.notEqual(base, deriveClientToken(OTHER_ADDR, SID_A, UA));
  assert.notEqual(base, deriveClientToken(ADDR, SID_A, 'other-client/2.0'));
});

test('(a) derivation is not the legacy sha256(constant + userAgent) value', () => {
  assert.notEqual(deriveClientToken(ADDR, SID_A, UA), legacyToken(UA));
});

// ------------------------------------------------------------------ (b) legacy rejected
test('(b) a correctly derived token for the live session is accepted', async () => {
  currentJwt = { address: ADDR, sid: SID_A };
  const res = mkRes();
  const ok = await verifyClientToken(mkReq(deriveClientToken(ADDR, SID_A, UA)), res);
  assert.equal(ok, true);
  assert.equal(res.statusCode, 0);
});

test('(b) a token computed the LEGACY way is rejected with INVALID_CLIENT_TOKEN', async () => {
  currentJwt = { address: ADDR, sid: SID_A };
  const res = mkRes();
  const ok = await verifyClientToken(mkReq(legacyToken(UA)), res);
  assert.equal(ok, false);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body?.code, 'INVALID_CLIENT_TOKEN');
});

test("(b) another session's derived token is rejected", async () => {
  currentJwt = { address: ADDR, sid: SID_A };
  const res = mkRes();
  const ok = await verifyClientToken(mkReq(deriveClientToken(ADDR, SID_B, UA)), res);
  assert.equal(ok, false);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body?.code, 'INVALID_CLIENT_TOKEN');
});

test('(b) a missing token still answers 403 MISSING_CLIENT_TOKEN', async () => {
  currentJwt = { address: ADDR, sid: SID_A };
  const req = mkReq('');
  delete req.headers['x-client-token'];
  const res = mkRes();
  const ok = await verifyClientToken(req, res);
  assert.equal(ok, false);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body?.code, 'MISSING_CLIENT_TOKEN');
});

test('(b) with no session the caller gets the unchanged 401, not a 403', async () => {
  currentJwt = null;
  const res = mkRes();
  const ok = await verifyClientToken(mkReq(legacyToken(UA)), res);
  currentJwt = { address: ADDR, sid: SID_A };
  assert.equal(ok, false);
  assert.equal(res.statusCode, 401);
});

// ------------------------------------------------------------------ (c) fail closed
test('(c) deriveClientToken throws when REQUEST_SIGNATURE_SECRET is unset', () => {
  const saved = process.env.REQUEST_SIGNATURE_SECRET;
  delete process.env.REQUEST_SIGNATURE_SECRET;
  try {
    assert.throws(() => deriveClientToken(ADDR, SID_A, UA), /REQUEST_SIGNATURE_SECRET/);
  } finally {
    process.env.REQUEST_SIGNATURE_SECRET = saved;
  }
});

test('(c) verifyClientToken fails closed when REQUEST_SIGNATURE_SECRET is unset', async () => {
  const saved = process.env.REQUEST_SIGNATURE_SECRET;
  const token = deriveClientToken(ADDR, SID_A, UA);
  currentJwt = { address: ADDR, sid: SID_A };
  delete process.env.REQUEST_SIGNATURE_SECRET;
  const res = mkRes();
  let ok;
  try {
    ok = await verifyClientToken(mkReq(token), res);
  } finally {
    process.env.REQUEST_SIGNATURE_SECRET = saved;
  }
  assert.equal(ok, false);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body?.code, 'INVALID_CLIENT_TOKEN');
});

// ------------------------------------------------------------------ (d) literal gone from lib/
test('(d) no source file under lib/ still contains the retired L1 constant', () => {
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(ts|tsx|js|jsx|mjs)$/.test(entry.name)) continue;
      if (entry.name.includes('.bak')) continue; // pre-fix snapshots are kept on purpose
      if (fs.readFileSync(full, 'utf8').includes(RETIRED_L1_CONSTANT)) {
        offenders.push(path.relative(ROOT, full));
      }
    }
  };
  walk(path.join(ROOT, 'lib'));
  assert.deepEqual(offenders, [], `retired L1 constant still present in: ${offenders.join(', ')}`);
});
