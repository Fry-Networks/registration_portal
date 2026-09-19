const test = require('node:test');
const assert = require('node:assert/strict');

// Regression tests for the remaining algod OOS fixes:
//   A — getFRYAssetBalances throws when the vault balance is unverifiable
//       (pre-fix: returns 0 → false "insufficient vault balance").
//   B — getAlgoBalance throws on algod failure (pre-fix: returns null).
//   C — get-algo-balance API returns full-precision number (pre-fix: "1.235").
//   D — auth account-info failover: primary down → fallback serves;
//       all down → AlgodUnavailableError; getSigningAddress survives.
//   E — transfer_post_snapshot returns 503 when the vault check is
//       unavailable (pre-fix: 402 "insufficient vault balance").

process.env.ALGOD_URL = 'http://100.69.195.100:8190';
process.env.ALGOD_TOKEN = 'test-algod-token';

// target ES2017 so `class extends Error` keeps its prototype chain —
// instanceof checks on AlgodUnavailableError must behave like the SWC
// production build, not like ES5 downlevel output.
require('ts-node').register({ transpileOnly: true, compilerOptions: { module: 'commonjs', moduleResolution: 'node', target: 'ES2017' } });

const TEST_ADDR = 'SYNTHWALLETC3AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const FRY_1_ID = 924268058;
const TFRY_ID = 2681521901;
const PRIMARY_HOST = '100.69.195.100';

// Address/method/server-aware fake algod state.
const state = {
  primaryDown: false,      // accountInformation fails only on the primary host
  allAccountInfoDown: false, // accountInformation fails everywhere
  userAccountOnly: false,  // accountInformation succeeds only for TEST_ADDR
  assetInfoDown: false,    // accountAssetInformation fails
  indexerDown: false,      // indexer lookups fail
  microAlgos: 1234567,
};

class FakeAlgodv2 {
  constructor(_token, baseServer) {
    this.baseServer = String(baseServer ?? '');
  }
  accountInformation(addr) {
    return {
      do: async () => {
        if (state.allAccountInfoDown) throw new Error('algod down (test)');
        if (state.primaryDown && this.baseServer.includes(PRIMARY_HOST)) {
          throw new Error('primary down (test)');
        }
        if (state.userAccountOnly && addr !== TEST_ADDR) {
          throw new Error('vault algod down (test)');
        }
        return {
          amount: state.microAlgos,
          assets: [
            { 'asset-id': FRY_1_ID, amount: 50_000_000 },
            { 'asset-id': TFRY_ID, amount: 0 },
          ],
        };
      },
    };
  }
  accountAssetInformation() {
    return {
      do: async () => {
        if (state.assetInfoDown) throw new Error('accountAssetInformation down (test)');
        return { 'asset-holding': { amount: 5_000_000 } };
      },
    };
  }
  getTransactionParams() {
    return { do: async () => ({}) };
  }
}

class FakeIndexer {
  constructor() {}
  lookupAssetByID() {
    return {
      do: async () => {
        if (state.indexerDown) throw new Error('indexer down (test)');
        return { asset: { params: { decimals: 6 } } };
      },
    };
  }
  lookupAccountByID() {
    const req = {
      includeAll: () => req,
      do: async () => {
        if (state.indexerDown) throw new Error('indexer down (test)');
        return { account: { assets: [] } };
      },
    };
    return req;
  }
}

const stubModule = (relPath, exports) => {
  const resolved = require.resolve(relPath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
};

const fakeAlgosdk = { Algodv2: FakeAlgodv2, Indexer: FakeIndexer };
stubModule('algosdk', { __esModule: true, ...fakeAlgosdk, default: fakeAlgosdk });

stubModule('next-auth', {
  __esModule: true,
  getServerSession: async () => ({ user: { address: TEST_ADDR } }),
});
stubModule('../pages/api/auth/[...nextauth].ts', { __esModule: true, authOptions: {} });

const fakeDb = {
  db: () => ({
    collection: (name) => ({
      findOne: async () => {
        if (name === 'post-snapshot-conversions') {
          return { address: TEST_ADDR, burned: true, claimed: false };
        }
        if (name === 'fry-conversions') {
          return { address: TEST_ADDR, amount: 10 };
        }
        return null;
      },
      updateOne: async () => ({ modifiedCount: 1, matchedCount: 1 }),
    }),
  }),
};
stubModule('../lib/mongoclient.ts', { __esModule: true, default: Promise.resolve(fakeDb) });

const { getFRYAssetBalances } = require('../lib/utils.ts');
const { getAlgoBalance } = require('../lib/algorand/balances.ts');
const failover = require('../lib/algorand/failover.ts');
const { getSigningAddress } = require('../lib/algorand/authAddr.ts');
const algoBalanceHandler = require('../pages/api/algorand/get-algo-balance.ts').default;
const transferPostSnapshotHandler = require('../pages/api/conversion/transfer_post_snapshot.ts').default;

const resetState = () => {
  state.primaryDown = false;
  state.allAccountInfoDown = false;
  state.userAccountOnly = false;
  state.assetInfoDown = false;
  state.indexerDown = false;
  state.microAlgos = 1234567;
};

const mockResponse = () => ({
  statusCode: 0,
  payload: null,
  headers: {},
  status(code) { this.statusCode = code; return this; },
  json(body) { this.payload = body; return this; },
  setHeader(k, v) { this.headers[k] = v; return this; },
});

test('A: getFRYAssetBalances throws when vault balance unverifiable', async () => {
  resetState();
  state.assetInfoDown = true;
  state.allAccountInfoDown = true;
  state.indexerDown = true;
  await assert.rejects(
    () => getFRYAssetBalances(String(FRY_1_ID)),
    (err) => err && err.name === 'AlgodUnavailableError',
    'expected AlgodUnavailableError (pre-fix code resolves 0)'
  );
});

test('B: getAlgoBalance throws on algod failure (never null)', async () => {
  resetState();
  state.allAccountInfoDown = true;
  await assert.rejects(
    () => getAlgoBalance(TEST_ADDR),
    (err) => err && err.name === 'AlgodUnavailableError',
    'expected AlgodUnavailableError (pre-fix code resolves null)'
  );
});

test('C: get-algo-balance API returns full-precision number', async () => {
  resetState();
  const res = mockResponse();
  await algoBalanceHandler({ method: 'POST', body: { address: TEST_ADDR } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(
    res.payload.balance,
    1.234567,
    `expected numeric 1.234567, got ${JSON.stringify(res.payload.balance)}`
  );
});

test('D1: getFailoverAccountInfo survives primary-down via fallback', async () => {
  resetState();
  state.primaryDown = true;
  const info = await failover.getFailoverAccountInfo(TEST_ADDR);
  assert.equal(Number(info.amount), 1234567);
});

test('D2: getSigningAddress survives primary-down', async () => {
  resetState();
  state.primaryDown = true;
  const signer = await getSigningAddress(TEST_ADDR, true);
  assert.equal(signer, TEST_ADDR);
});

test('D3: getFailoverAccountInfo throws when all endpoints down', async () => {
  resetState();
  state.allAccountInfoDown = true;
  await assert.rejects(
    () => failover.getFailoverAccountInfo(TEST_ADDR),
    (err) => err && err.name === 'AlgodUnavailableError'
  );
});

test('E: transfer_post_snapshot returns 503 when vault check unavailable', async () => {
  resetState();
  // User account resolves (eligibility + opt-in pass); vault account + indexer fail.
  state.userAccountOnly = true;
  state.assetInfoDown = true;
  state.indexerDown = true;
  const res = mockResponse();
  await transferPostSnapshotHandler(
    { method: 'POST', body: { address: TEST_ADDR } },
    res
  );
  assert.equal(
    res.statusCode,
    503,
    `expected 503 when vault unverifiable, got ${res.statusCode} with payload ${JSON.stringify(res.payload)}`
  );
});
