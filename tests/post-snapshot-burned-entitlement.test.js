const test = require('node:test');
const assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: true, compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });

// BUG-3 follow-up (dashfix-round4): a burned-but-unclaimed wallet must see its
// RECORDED entitlement in the post-snapshot preview. The live-balance recompute
// is 0 after the burn, which rendered "Claim 0.00000 tFRY" for all 74 stranded
// burns even though transfer_post_snapshot pays the recorded amount.

const TEST_ADDR = 'SYNTHWALLETC3AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

const stubModule = (relPath, exports) => { const r = require.resolve(relPath); require.cache[r] = { id: r, filename: r, loaded: true, exports }; };

stubModule('next-auth', { __esModule: true, getServerSession: async () => ({ user: { address: TEST_ADDR } }) });
stubModule('../pages/api/auth/[...nextauth].ts', { __esModule: true, authOptions: {} });

const fakeDb = { db: () => ({ collection: (name) => ({ findOne: async () => {
  if (name === 'fry-conversions') return { address: TEST_ADDR, amount: 167602.76 };
  if (name === 'post-snapshot-conversions') return { address: TEST_ADDR, burned: true, claimed: false, claim_txId: null, claimed_at: null, eligible_fry1: 172525.1528, eligible_tFRY: 4313.12882 };
  return null; } }) }) };
stubModule('../lib/mongoclient.ts', { __esModule: true, default: Promise.resolve(fakeDb) });
stubModule('../lib/wallet/clients.ts', { __esModule: true, getAlgodClient: () => ({}), getIndexerClient: () => ({}), resetClients: () => {} });
class AlgodUnavailableError extends Error {}
stubModule('../lib/algorand/failover.ts', { __esModule: true, AlgodUnavailableError, getFailoverAssetBalance: async () => 167602.76 });

const handler = require('../pages/api/conversion/get_post_snapshot.ts').default;

const mockResponse = () => ({ statusCode: 0, payload: null, headers: {},
  status(c) { this.statusCode = c; return this; },
  json(p) { this.payload = p; return this; },
  setHeader() { return this; } });

test('burned-but-unclaimed preview shows the recorded entitlement', async () => {
  const res = mockResponse();
  await handler({ method: 'POST', body: { address: TEST_ADDR } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.post_snapshot.burned, true);
  assert.equal(res.payload.post_snapshot.claimed, false);
  assert.equal(res.payload.post_snapshot.eligible_tFRY, 4313.12882);
  assert.equal(res.payload.post_snapshot.eligible_fry1, 172525.1528);
});
