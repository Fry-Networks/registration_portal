const test = require('node:test');
const assert = require('node:assert/strict');

require('ts-node').register({ transpileOnly: true, compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });

// Regression test for the FRY 1.0 post-snapshot silent algod failure:
// when the on-chain balance query fails, get_post_snapshot must return 503
// (balance unverifiable) instead of 200 with eligible_fry1 = 0 (false
// "no post-snapshot FRY 1.0 eligible").

const TEST_ADDR = 'SYNTHWALLETC3AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const FRY_1_ID = '924268058';

// Mutable switch: 'ok' → algod answers with a 50 FRY 1.0 holding,
// 'down' → every algod path throws.
const state = { mode: 'ok' };

const stubModule = (relPath, exports) => {
  const resolved = require.resolve(relPath);
  require.cache[resolved] = {
    id: resolved,
    filename: resolved,
    loaded: true,
    exports,
  };
};

// Stub the heavy/imported-for-side-effect modules BEFORE the handler loads.
stubModule('next-auth', {
  __esModule: true,
  getServerSession: async () => ({ user: { address: TEST_ADDR } }),
});

stubModule('../pages/api/auth/[...nextauth].ts', {
  __esModule: true,
  authOptions: {},
});

const fakeDb = {
  db: () => ({
    collection: (name) => ({
      findOne: async () => {
        if (name === 'fry-conversions') {
          return { address: TEST_ADDR, amount: 10 };
        }
        return null; // post-snapshot-conversions: no record yet
      },
    }),
  }),
};

stubModule('../lib/mongoclient.ts', {
  __esModule: true,
  default: Promise.resolve(fakeDb),
});

// Pre-fix code path: direct algod client from lib/wallet/clients.
// getIndexerClient/resetClients are needed because lib/utils.ts calls
// getIndexerClient() at module scope.
stubModule('../lib/wallet/clients.ts', {
  __esModule: true,
  getAlgodClient: () => ({
    accountInformation: () => ({
      do: async () => {
        if (state.mode === 'down') {
          throw new Error('algod unreachable (test)');
        }
        return { assets: [{ 'asset-id': Number(FRY_1_ID), amount: 50_000_000 }] };
      },
    }),
  }),
  getIndexerClient: () => ({}),
  resetClients: () => {},
});

// Post-fix code path: failover utility.
class AlgodUnavailableError extends Error {}
stubModule('../lib/algorand/failover.ts', {
  __esModule: true,
  AlgodUnavailableError,
  getFailoverAssetBalance: async () => {
    if (state.mode === 'down') {
      throw new AlgodUnavailableError('All algod endpoints failed (test)');
    }
    return 50;
  },
});

const handler = require('../pages/api/conversion/get_post_snapshot.ts').default;

const mockResponse = () => {
  return {
    statusCode: 0,
    payload: null,
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.payload = body;
      return this;
    },
    setHeader(key, value) {
      this.headers[key] = value;
      return this;
    },
  };
};

const mockRequest = () => ({ method: 'POST', body: { address: TEST_ADDR } });

test('algod failure returns 503, never a false "not eligible" zero', async () => {
  state.mode = 'down';
  const res = mockResponse();

  await handler(mockRequest(), res);

  assert.equal(
    res.statusCode,
    503,
    `expected 503 when balance is unverifiable, got ${res.statusCode} with payload ${JSON.stringify(res.payload)}`
  );
  assert.ok(res.payload, 'expected an error payload');
  assert.notEqual(res.payload.success, true, 'must not report success when algod is down');
});

test('happy path computes eligibility from live balance', async () => {
  state.mode = 'ok';
  const res = mockResponse();

  await handler(mockRequest(), res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.success, true);
  // balance 50 - snapshot 10 = 40 eligible FRY 1.0 → 40 / 40 = 1 tFRY
  assert.equal(res.payload.post_snapshot.eligible_fry1, 40);
  assert.equal(res.payload.post_snapshot.eligible_tFRY, 1);
});
