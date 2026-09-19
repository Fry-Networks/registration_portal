const test = require('node:test');
const assert = require('node:assert/strict');

// Regression tests for the three algod OOS fixes:
//   A — getNetworkConfig prefers ALGOD_URL/ALGOD_TOKEN (server env) over the
//       public algonode default.
//   B — getAssetBalance throws on algod failure instead of returning null
//       (null must keep meaning "not opted in", never "algod down").
//   C — getAssetBalance returns full precision (no .toFixed(2) corruption).
//   D — get-token-balance API returns 503 when the balance is unverifiable.

process.env.ALGOD_URL = 'http://100.69.195.100:8190';
process.env.ALGOD_TOKEN = 'test-algod-token';

require('ts-node').register({ transpileOnly: true, compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });

const TEST_ADDR = 'SYNTHWALLETC3AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const FRY_ASSET = 924268058;

// Mutable switch driving the fake algod/indexer.
const state = { mode: 'ok', amount: 1234567 };

class FakeAlgodv2 {
  constructor() {}
  accountInformation() {
    return {
      do: async () => {
        if (state.mode === 'down') {
          throw new Error('algod down (test)');
        }
        return { assets: [{ 'asset-id': FRY_ASSET, amount: state.amount }] };
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
        if (state.mode === 'down') {
          throw new Error('indexer down (test)');
        }
        return { asset: { params: { decimals: 6 } } };
      },
    };
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

const { getNetworkConfig } = require('../lib/wallet/config.ts');
const { getAssetBalance } = require('../lib/algorand/balances.ts');
const tokenBalanceHandler = require('../pages/api/algorand/get-token-balance.ts').default;

const mockResponse = () => ({
  statusCode: 0,
  payload: null,
  headers: {},
  status(code) { this.statusCode = code; return this; },
  json(body) { this.payload = body; return this; },
  setHeader(k, v) { this.headers[k] = v; return this; },
});

test('A: getNetworkConfig(mainnet) prefers ALGOD_URL over public algonode', () => {
  const cfg = getNetworkConfig('mainnet');
  assert.equal(cfg.algod.baseServer, 'http://100.69.195.100');
  assert.equal(cfg.algod.port, 8190);
  assert.equal(cfg.algod.token, 'test-algod-token');
});

test('A2: testnet config is unaffected by ALGOD_URL', () => {
  const cfg = getNetworkConfig('testnet');
  assert.equal(cfg.algod.baseServer, 'https://testnet-api.algonode.cloud');
});

test('B: getAssetBalance throws on algod failure (never null)', async () => {
  state.mode = 'down';
  await assert.rejects(
    () => getAssetBalance(TEST_ADDR, String(FRY_ASSET)),
    (err) => err && err.name === 'AlgodUnavailableError',
    'expected AlgodUnavailableError when algod is down (pre-fix code resolves null)'
  );
});

test('C: getAssetBalance returns full precision, no toFixed(2)', async () => {
  state.mode = 'ok';
  state.amount = 1234567; // 1.234567 at 6 decimals
  const balance = await getAssetBalance(TEST_ADDR, String(FRY_ASSET));
  assert.equal(balance, 1.234567, `expected 1.234567, got ${balance}`);
});

test('D: get-token-balance returns 503 when balance unverifiable', async () => {
  state.mode = 'down';
  const res = mockResponse();
  await tokenBalanceHandler(
    { method: 'POST', body: { address: TEST_ADDR, asset_id: String(FRY_ASSET) } },
    res
  );
  assert.equal(
    res.statusCode,
    503,
    `expected 503, got ${res.statusCode} with payload ${JSON.stringify(res.payload)}`
  );
});
