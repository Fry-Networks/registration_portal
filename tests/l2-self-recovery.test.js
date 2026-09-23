// RC5 + RC6 (r12) — L2 self-recovery from clock skew and stale signing keys.
//
// RC5: a reported wallet was rejected
// five times with L2 details "Request expired: 7201s old" — a browser clock two hours behind.
// lib/requestSignature.server.ts:192 rejects anything older than MAX_AGE_SECONDS=900 and logs
// EXPIRED_TIMESTAMP, but the HTTP body the caller actually receives is code INVALID_SIGNATURE
// with NO serverTime, and lib/serverTime.ts only ever learned the offset from SUCCESSFUL
// responses. A client whose clock is skewed therefore never sees a serverTime, never corrects
// its offset, and can never recover on its own.
//
// RC6: 6,344 "Signature verification failed" events in 72h, 97% of them from three wallets.
// components/modals/Claim.tsx signs with raw Date.now() and never calls resetSigningKey(), so a
// stale per-session key is replayed on every attempt. Only lib/api/secureFetch.ts reset it, and
// Claim.tsx does not go through secureFetch. (RC5/RC6 fix: secureFetch now routes its 403s
// through recoverFromSignatureRejection() -- see section (e).)
//
// The contract pinned here:
//   (a) an expired-timestamp rejection carries a numeric serverTime in the 403 body;
//   (b) recoverFromSignatureRejection() applies that offset and drops the cached signing key;
//   (c) the retry is SINGLE-SHOT — a second consecutive 403 does not trigger a third attempt;
//   (d) NEGATIVE: a 403-rejected claim mutates nothing, so a retry cannot create a second
//       reservation or pending-claim ("preview") row.

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

const ADDR = 'SYNTHWALLETRC56AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const MINER = 'FEM-RC56TESTKEY00000000000000000000';
const VAULT = 'HXWYLLZDPTM5OXS3DPARMTG52RSBMMCQNKT4L2LZRRXYPNAWJBT6VIW6WU';
const ASSET = '2485202024';

// The exact skew observed for the reported wallet, in seconds.
const OBSERVED_SKEW_SECONDS = 7201;

process.env.REQUEST_SIGNATURE_SECRET =
  process.env.REQUEST_SIGNATURE_SECRET || 'unit-test-server-secret';
process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || 'unit-test-nextauth-secret';

// ---------------------------------------------------------------- shared stubs
// lib/requestSignature.server is deliberately NOT stubbed: the age check at :192 is the very
// behaviour under test, so the real module runs. Only its Discord/DB sink is stubbed out.
stub('../lib/securityEventAggregation', {
  __esModule: true,
  logSecurityEventAggregated: async () => {},
});
stub('../lib/logger', {
  __esModule: true,
  loggers: { apiError: () => {}, security: () => {}, info: () => {}, warn: () => {}, error: () => {} },
});
stub('next-auth', { __esModule: true, getServerSession: async () => ({ user: { address: ADDR } }) });
stub('next-auth/jwt', { __esModule: true, getToken: async () => ({ sid: 'rc56-session-id', sub: ADDR, address: ADDR }) });
stub('../pages/api/auth/[...nextauth].ts', { __esModule: true, authOptions: {} });
stub('../lib/adminCheck', {
  __esModule: true,
  isAdminRequest: async () => false,
  isAdminWallet: async () => false,
  extractWalletFromRequest: () => ADDR,
});
stub('../lib/clientTokenMiddleware', { __esModule: true, verifyClientToken: async () => true, deriveClientToken: () => 'tok' });
stub('../lib/deviceFingerprint', { __esModule: true, verifyDeviceFingerprintMiddleware: async () => 'ok' });

const mkRes = () => {
  const out = { statusCode: null, body: null };
  const res = {
    status(code) { out.statusCode = code; return res; },
    json(body) { out.body = body; return res; },
    setHeader() { return res; },
    end() { return res; },
  };
  return { res, out };
};

const expiredTimestamp = () => Math.floor(Date.now() / 1000) - OBSERVED_SKEW_SECONDS;

// ================================================================ (a) server contract
//
// RC5/RC6 review (r12): the two tests that stood here drove enforceWalletApiSecurity while NAMING
// /api/rewards/get-reward-summary-batch and /api/rewards/get-asset-totals. Those routes do not use
// that helper -- each verifies the signature inline and emits its OWN 403 -- so the assertions said
// nothing about the endpoints the reported wallet was actually rejected on, and the serverTime added in
// 527590a was a no-op there. The route contract is now pinned by driving the real handlers. The
// helper keeps its own coverage below, named after an endpoint that genuinely goes through it.

// Every reward route that verifies an L2 signature inline instead of through
// enforceWalletApiSecurity. The reported wallet's EXPIRED_TIMESTAMP events were on the 1st, 2nd and 4th.
const INLINE_SIGNATURE_ROUTES = [
  { endpoint: '/api/rewards/get-reward-summary-batch', body: { miner_keys: [MINER] } },
  { endpoint: '/api/rewards/get-reward-summary', body: { miner_key: MINER } },
  { endpoint: '/api/rewards/get-rewards-page', body: { miner_key: MINER, page: 1 } },
  { endpoint: '/api/rewards/get-asset-totals', body: {} },
  { endpoint: '/api/rewards/boost', body: { miner_key: MINER, no: 1 } },
];

// Deferred to test-run time so every stub below is registered before the handler is loaded.
const callRoute = async (endpoint, headers, body) => {
  const handler = require(`../pages${endpoint}.ts`).default;
  const { res, out } = mkRes();
  await handler({ method: 'POST', url: endpoint, headers, body }, res);
  return out;
};

for (const route of INLINE_SIGNATURE_ROUTES) {
  test(`(a) ${route.endpoint} answers an expired timestamp with a 403 carrying serverTime`, async () => {
    const out = await callRoute(
      route.endpoint,
      {
        'x-request-signature': 'f'.repeat(64),
        'x-request-timestamp': String(expiredTimestamp()),
      },
      route.body
    );

    assert.equal(out.statusCode, 403, `expected 403, got ${out.statusCode}: ${JSON.stringify(out.body)}`);
    assert.equal(out.body.code, 'INVALID_SIGNATURE', 'the code string must not change');
    assert.equal(
      typeof out.body.serverTime,
      'number',
      `${route.endpoint}: the 403 body must carry a numeric serverTime, got ${JSON.stringify(out.body)}`
    );
    assert.ok(
      Math.abs(out.body.serverTime - Date.now()) < 60_000,
      `serverTime must be the server's own clock, got ${out.body.serverTime}`
    );
  });

  test(`(a) ${route.endpoint} answers a missing signature with a 403 carrying serverTime`, async () => {
    const out = await callRoute(route.endpoint, {}, route.body);

    assert.equal(out.statusCode, 403, `expected 403, got ${out.statusCode}: ${JSON.stringify(out.body)}`);
    assert.equal(out.body.code, 'MISSING_SIGNATURE');
    assert.equal(
      typeof out.body.serverTime,
      'number',
      `${route.endpoint}: ${JSON.stringify(out.body)}`
    );
  });
}

// The shared helper keeps the coverage it had, unchanged assertion for assertion, but named after
// a route that really does call it (pages/api/stake/precheck.ts:32, and thirteen others).
const { enforceWalletApiSecurity } = require('../lib/api/enforceWalletSecurity.ts');
const HELPER_ENDPOINT = '/api/stake/precheck';

test('(a) enforceWalletApiSecurity: an expired-timestamp rejection carries a numeric serverTime the client can use', async () => {
  const { res, out } = mkRes();
  const req = {
    method: 'POST',
    url: HELPER_ENDPOINT,
    headers: {
      'x-request-signature': 'f'.repeat(64),
      'x-request-timestamp': String(expiredTimestamp()),
    },
    body: { miner_key: MINER },
  };

  const result = await enforceWalletApiSecurity(req, res, {
    endpoint: HELPER_ENDPOINT,
    method: 'POST',
  });

  assert.equal(result, null, 'the skewed request must still be refused');
  assert.equal(out.statusCode, 403);
  assert.equal(out.body.code, 'INVALID_SIGNATURE', 'the code string must not change');
  assert.equal(
    typeof out.body.serverTime,
    'number',
    `the 403 body must carry a numeric serverTime, got ${JSON.stringify(out.body)}`
  );
  assert.ok(
    Math.abs(out.body.serverTime - Date.now()) < 60_000,
    `serverTime must be the server's own clock, got ${out.body.serverTime}`
  );
});

test('(a) enforceWalletApiSecurity: a missing-signature 403 also carries serverTime', async () => {
  const { res, out } = mkRes();
  const req = { method: 'POST', url: HELPER_ENDPOINT, headers: {}, body: {} };

  const result = await enforceWalletApiSecurity(req, res, {
    endpoint: HELPER_ENDPOINT,
    method: 'POST',
  });

  assert.equal(result, null);
  assert.equal(out.statusCode, 403);
  assert.equal(out.body.code, 'MISSING_SIGNATURE');
  assert.equal(typeof out.body.serverTime, 'number', `got ${JSON.stringify(out.body)}`);
});

// ================================================================ (b) client recovery
test('(b) the client helper applies the server offset and drops the cached signing key', async () => {
  const { getSigningKey, recoverFromSignatureRejection } = require('../lib/requestSignature.client.ts');
  const { getServerTime, resetServerTime } = require('../lib/serverTime.ts');

  resetServerTime();

  let keyFetches = 0;
  const realFetch = global.fetch;
  global.fetch = async (url) => {
    if (String(url).includes('/api/auth/signing-key')) {
      keyFetches += 1;
      return new Response(JSON.stringify({ key: `session-key-${keyFetches}` }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    throw new Error(`unexpected fetch: ${url}`);
  };

  try {
    assert.equal(await getSigningKey(), 'session-key-1');
    assert.equal(await getSigningKey(), 'session-key-1', 'the key is cached');
    assert.equal(keyFetches, 1);

    const skewMs = OBSERVED_SKEW_SECONDS * 1000;
    const warranted = recoverFromSignatureRejection(403, {
      success: false,
      code: 'INVALID_SIGNATURE',
      message: 'Invalid or expired request signature',
      serverTime: Date.now() + skewMs,
    });

    assert.equal(warranted, true, 'a signature rejection warrants exactly one retry');

    const drift = getServerTime() - Date.now();
    assert.ok(
      Math.abs(drift - skewMs) < 5_000,
      `the offset must be applied: expected ~${skewMs}ms, got ${drift}ms`
    );

    assert.equal(
      await getSigningKey(),
      'session-key-2',
      'resetSigningKey() must have dropped the cached key so a fresh one is fetched'
    );
    assert.equal(keyFetches, 2);
  } finally {
    global.fetch = realFetch;
    require('../lib/serverTime.ts').resetServerTime();
  }
});

test('(b) a 403 that is not a signature rejection is left alone', async () => {
  const { recoverFromSignatureRejection } = require('../lib/requestSignature.client.ts');
  const { getServerTime, resetServerTime } = require('../lib/serverTime.ts');
  resetServerTime();

  assert.equal(
    recoverFromSignatureRejection(403, { code: 'DEVICE_MISMATCH', serverTime: Date.now() + 999_000 }),
    false
  );
  assert.equal(recoverFromSignatureRejection(401, { code: 'INVALID_SIGNATURE' }), false);
  assert.equal(recoverFromSignatureRejection(403, null), false);
  assert.ok(
    Math.abs(getServerTime() - Date.now()) < 1_000,
    'a non-signature rejection must not move the clock offset'
  );
});

test('(b) a signature rejection without serverTime still refreshes the key', async () => {
  const { recoverFromSignatureRejection } = require('../lib/requestSignature.client.ts');
  const { getServerTime, resetServerTime } = require('../lib/serverTime.ts');
  resetServerTime();

  assert.equal(recoverFromSignatureRejection(403, { code: 'INVALID_SIGNATURE' }), true);
  assert.ok(
    Math.abs(getServerTime() - Date.now()) < 1_000,
    'no serverTime in the body means the offset is left untouched'
  );
});

// ================================================================ (c) single-shot
test('(c) the signature retry is single-shot', async () => {
  const { fetchWithSignatureRecovery } = require('../lib/requestSignature.client.ts');

  let attempts = 0;
  const alwaysRejects = async () => {
    attempts += 1;
    return new Response(
      JSON.stringify({ success: false, code: 'INVALID_SIGNATURE', serverTime: Date.now() }),
      { status: 403, headers: { 'Content-Type': 'application/json' } }
    );
  };

  const response = await fetchWithSignatureRecovery(alwaysRejects);

  assert.equal(response.status, 403, 'the second 403 is returned to the caller unchanged');
  assert.equal(attempts, 2, `a second consecutive 403 must not retry again, saw ${attempts} attempts`);
});

test('(c) a successful response is never retried', async () => {
  const { fetchWithSignatureRecovery } = require('../lib/requestSignature.client.ts');

  let attempts = 0;
  const ok = async () => {
    attempts += 1;
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const response = await fetchWithSignatureRecovery(ok);
  assert.equal(response.status, 200);
  assert.equal(attempts, 1);

  // A non-recoverable 403 is likewise passed straight through.
  let blocked = 0;
  const blockedFetch = async () => {
    blocked += 1;
    return new Response(JSON.stringify({ success: false, code: 'DEVICE_MISMATCH' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  const blockedResponse = await fetchWithSignatureRecovery(blockedFetch);
  assert.equal(blockedResponse.status, 403);
  assert.equal(blocked, 1);
});

// ================================================================ (d) NEGATIVE: no double write
// Every database handle the claim handler can reach is a spy. A rejected claim must record
// nothing at all, which is what makes the single retry safe.
const writes = [];
const recordingCollection = (name) => ({
  findOne: async () => {
    if (name === 'devices') return { miner_key: MINER, address: ADDR, reward_wallet: ADDR };
    if (name === 'device-rewards') return { miner_key: MINER, weekly_rewards: [], daily_rewards: [] };
    return null;
  },
  find: () => ({ toArray: async () => [], sort: () => ({ toArray: async () => [] }) }),
  countDocuments: async () => 0,
  insertOne: async (doc) => { writes.push({ collection: name, op: 'insertOne', doc }); return { insertedId: 'x' }; },
  insertMany: async () => { writes.push({ collection: name, op: 'insertMany' }); return { insertedCount: 0 }; },
  updateOne: async () => { writes.push({ collection: name, op: 'updateOne' }); return { modifiedCount: 1 }; },
  updateMany: async () => { writes.push({ collection: name, op: 'updateMany' }); return { modifiedCount: 1 }; },
  deleteOne: async () => { writes.push({ collection: name, op: 'deleteOne' }); return { deletedCount: 1 }; },
  findOneAndUpdate: async () => { writes.push({ collection: name, op: 'findOneAndUpdate' }); return { value: null }; },
  bulkWrite: async () => { writes.push({ collection: name, op: 'bulkWrite' }); return {}; },
});

let reserveCalls = 0;
let lockCalls = 0;

stub('../lib/mongoclient', {
  __esModule: true,
  default: Promise.resolve({ db: () => ({ collection: recordingCollection }) }),
});
stub('../lib/rewards/reservation', {
  __esModule: true,
  reserveRows: async () => { reserveCalls += 1; return 1; },
  releaseRows: async () => {},
  releaseStaleReservations: async () => {},
});
stub('../lib/api/deviceAction', {
  __esModule: true,
  withDeviceActionLock: async (_req, _res, _meta, run) => { lockCalls += 1; return run ? run() : undefined; },
});
stub('../lib/rewardsVault.server', { __esModule: true, getRewardsVaultAddress: () => VAULT });
stub('../lib/utils', {
  __esModule: true,
  getAssetDecimals: async () => 6,
  fNODE: { id: ASSET, decimals: 6 },
  tFRY: { id: '2681521901', decimals: 6 },
  getTransactionTime: async () => new Date(),
  REWARD_WALLET: VAULT,
  // RC5/RC6: the inline-signature reward routes compute module-level asset-id constants from
  // these at IMPORT time, so the stub has to expose them or the handler cannot be required at
  // all. Nothing below is reached on the 403 path under test; the ids are the real ones.
  normalizeAssetId: (value) => Number(value),
  FRY_1: { id: '924268058', decimals: 6 },
  FRY_2: { id: '2485314946', decimals: 6 },
  fVPN: { id: '2656692124', decimals: 6 },
  ALGO: { id: '0', decimals: 6 },
  FRYALGO_WALLET: VAULT,
  fixedInputSwap: async () => ({}),
});
stub('../lib/price', { __esModule: true, getFRYPrice: async () => 1, getAlgoUsdPrice: async () => 1 });
stub('../lib/discord-webhook', { __esModule: true, notifyDiscordError: async () => {} });
stub('../lib/rewards/pocEvidence', {
  __esModule: true,
  loadEvidence: async () => ({ dates: new Set(), leases: [] }),
  loadEvidenceBatch: async () => new Map(),
  emptyEvidence: () => ({ dates: new Set(), leases: [] }),
  hasEvidenceInWindow: () => true,
});
stub('../lib/monitoring/walletHealth', { __esModule: true, monitorWalletHealth: async () => {} });
stub('../lib/monitoring/transactionMonitor', { __esModule: true, monitorTransaction: async () => {} });
stub('../lib/algorand/optIn', { __esModule: true, ensureWalletAssetOptIn: async () => {} });
stub('../lib/algorand/withRetry', { __esModule: true, withRetry: async (fn) => fn() });
stub('../lib/wallet/clients', { __esModule: true, getAlgodClient: () => ({}), getIndexerClient: () => ({}) });
stub('../lib/wallet/transactions', { __esModule: true, buildAssetTransferTxn: async () => 'txn' });
stub('../lib/algorand/admin', {
  __esModule: true,
  decodeUnsignedTransaction: (t) => t,
  loadMnemonicAccountPair: () => ({ account: { addr: { toString: () => VAULT } } }),
  signAndSubmitCustodialTransactions: async () => ({ txId: 'TESTTXID' }),
  buildUserPaysClaimGroup: async () => ({ groupId: 'g', signedServerLegsB64: [], unsignedUserLegB64: 'u', unsignedServerLegsB64: [], expected: {} }),
});
stub('../lib/algorand/failover', {
  __esModule: true,
  AlgodUnavailableError: class extends Error {},
  getFailoverAccountInfo: async () => ({}),
  getFailoverAssetBalance: async () => 0,
  getFailoverAlgodClient: async () => ({}),
});

const claimHandler = require('../pages/api/rewards/claim.ts').default;

test('(d) the write spy actually records (guards against a vacuous assertion)', async () => {
  writes.length = 0;
  await recordingCollection('canary').insertOne({ canary: true });
  assert.equal(writes.length, 1);
  assert.equal(writes[0].collection, 'canary');
  writes.length = 0;
});

test('(d) a 403-rejected claim writes nothing, so one retry cannot double-reserve', async () => {
  writes.length = 0;
  reserveCalls = 0;
  lockCalls = 0;

  const attempt = async () => {
    const { res, out } = mkRes();
    await claimHandler(
      {
        method: 'POST',
        url: '/api/rewards/claim',
        headers: {
          'x-request-signature': 'f'.repeat(64),
          'x-request-timestamp': String(expiredTimestamp()),
        },
        body: { miner_key: MINER },
      },
      res
    );
    return out;
  };

  const first = await attempt();
  assert.equal(first.statusCode, 403, `expected 403, got ${first.statusCode}: ${JSON.stringify(first.body)}`);
  assert.equal(first.body.code, 'INVALID_SIGNATURE');
  assert.equal(typeof first.body.serverTime, 'number', `claim.ts 403 must carry serverTime, got ${JSON.stringify(first.body)}`);

  // The single-shot retry the client is now allowed to make. Still skewed here, so still 403.
  const second = await attempt();
  assert.equal(second.statusCode, 403);
  assert.equal(second.body.code, 'INVALID_SIGNATURE');

  assert.deepEqual(writes, [], `a rejected claim must not touch the database, saw ${JSON.stringify(writes)}`);
  assert.equal(lockCalls, 0, 'the device action lock must not be acquired behind a 403');
  assert.equal(reserveCalls, 0, 'no reward rows may be reserved behind a 403');
  // Was: `assert.ok(writes.length <= 1, ...)` -- vacuous after the strict deepEqual above, which
  // already pins writes to []. The retry is only self-correcting if the SECOND 403 also carries
  // the server clock, which nothing else asserts.
  assert.equal(
    typeof second.body.serverTime,
    'number',
    `the retry's 403 must also carry serverTime, got ${JSON.stringify(second.body)}`
  );
});
// ================================================================ (e) secureFetch
// RC6 review (r12): lib/api/secureFetch.ts signed with a raw Date.now() and carried its own retry
// that dropped the signing key but never looked at serverTime -- so the one client path that DID
// retry still re-signed with the same wrong clock. It now takes its timestamp from the tracked
// server offset and routes the rejection through the shared recoverFromSignatureRejection().
stub('../lib/clientToken', {
  __esModule: true,
  getClientToken: async () => 'client-token-1',
  refreshClientToken: async () => 'client-token-2',
});

test('(e) secureFetch re-signs with the server clock after a 403 that carries serverTime', async () => {
  const { secureFetch } = require('../lib/api/secureFetch.ts');
  const { resetServerTime, getServerTimeOffsetMs } = require('../lib/serverTime.ts');
  const { resetSigningKey } = require('../lib/requestSignature.client.ts');

  resetServerTime();
  resetSigningKey();

  const hadWindow = Object.prototype.hasOwnProperty.call(global, 'window');
  const realFetch = global.fetch;
  if (!hadWindow) global.window = {};

  const sentTimestamps = [];
  const skewMs = OBSERVED_SKEW_SECONDS * 1000;
  let calls = 0;

  global.fetch = async (url, init) => {
    if (String(url).includes('/api/auth/signing-key')) {
      return new Response(JSON.stringify({ key: `session-key-${calls}` }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    calls += 1;
    sentTimestamps.push(Number(init.headers['x-request-timestamp']));
    if (calls === 1) {
      // Exactly what the four reward routes now return.
      return new Response(
        JSON.stringify({
          success: false,
          code: 'INVALID_SIGNATURE',
          message: 'Invalid or expired request signature',
          serverTime: Date.now() + skewMs,
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    const response = await secureFetch('/api/rewards/get-reward-summary', { miner_key: MINER });

    assert.equal(response.status, 200, 'the corrected retry succeeds');
    assert.equal(calls, 2, `exactly one retry, saw ${calls} attempts`);
    assert.equal(sentTimestamps.length, 2);
    assert.ok(
      Math.abs(sentTimestamps[0] - Math.floor(Date.now() / 1000)) < 10,
      `the first attempt signs with the uncorrected local clock, got ${sentTimestamps[0]}`
    );
    assert.ok(
      Math.abs(sentTimestamps[1] - sentTimestamps[0] - OBSERVED_SKEW_SECONDS) < 10,
      `the retry must re-sign with the SERVER clock: expected ~${OBSERVED_SKEW_SECONDS}s later than ` +
        `${sentTimestamps[0]}, got ${sentTimestamps[1]} (delta ${sentTimestamps[1] - sentTimestamps[0]}s)`
    );
    assert.ok(
      Math.abs(getServerTimeOffsetMs() - skewMs) < 5_000,
      `the offset from the 403 body must have been applied, got ${getServerTimeOffsetMs()}ms`
    );
  } finally {
    global.fetch = realFetch;
    if (!hadWindow) delete global.window;
    resetServerTime();
    resetSigningKey();
  }
});

test('(e) secureFetch takes its timestamp from the tracked server offset, not the raw local clock', async () => {
  const { secureFetch } = require('../lib/api/secureFetch.ts');
  const { setServerTime, resetServerTime } = require('../lib/serverTime.ts');
  const { resetSigningKey } = require('../lib/requestSignature.client.ts');

  resetServerTime();
  resetSigningKey();

  const hadWindow = Object.prototype.hasOwnProperty.call(global, 'window');
  const realFetch = global.fetch;
  if (!hadWindow) global.window = {};

  const skewMs = OBSERVED_SKEW_SECONDS * 1000;
  let sent = null;

  global.fetch = async (url, init) => {
    if (String(url).includes('/api/auth/signing-key')) {
      return new Response(JSON.stringify({ key: 'session-key' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    sent = Number(init.headers['x-request-timestamp']);
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    // An earlier response already taught the client that its clock is two hours behind.
    setServerTime(Date.now() + skewMs);

    await secureFetch('/api/rewards/get-asset-totals', {});

    assert.ok(
      Math.abs(sent - Math.floor((Date.now() + skewMs) / 1000)) < 10,
      `the header must carry server time, got ${sent}, expected ~${Math.floor((Date.now() + skewMs) / 1000)}`
    );
  } finally {
    global.fetch = realFetch;
    if (!hadWindow) delete global.window;
    resetServerTime();
    resetSigningKey();
  }
});
