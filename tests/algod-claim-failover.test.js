// Regression test for the second live claim blocker found during dashfix-20260807
// verification: claim/boost/confirm all built their algod client from ALGOD_URL
// (self-hosted ATLAS00). With that node down every claim burned three retries against a
// dead TCP endpoint and then answered 500 "Unable to verify rewards vault balance", and
// Instant Claim could not fetch suggested params at all. The claim surface must fail over
// to the public nodes like the balance paths already do.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

require('ts-node').register({
  transpileOnly: true,
  compilerOptions: { module: 'commonjs', moduleResolution: 'node', target: 'ES2017', jsx: 'react' },
});

// 'all-down' → every endpoint refuses; 'public-up' → only the public nodes answer.
const state = { mode: 'all-down' };

class FakeAlgodv2 {
  constructor(_token, server) {
    this.server = server;
  }
  status() {
    const server = this.server;
    return {
      do: async () => {
        const isPrivate = !/nodely|algonode/.test(server);
        if (state.mode === 'all-down' || isPrivate) {
          throw new Error(`connect ECONNREFUSED ${server}`);
        }
        return { lastRound: 1 };
      },
    };
  }
}

const algosdkPath = require.resolve('algosdk');
const realAlgosdk = require('algosdk');
require.cache[algosdkPath] = {
  id: algosdkPath,
  filename: algosdkPath,
  loaded: true,
  exports: Object.assign({}, realAlgosdk, {
    __esModule: true,
    default: Object.assign({}, realAlgosdk, { Algodv2: FakeAlgodv2 }),
    Algodv2: FakeAlgodv2,
  }),
};

const { getFailoverAlgodClient, AlgodUnavailableError } = require('../lib/algorand/failover.ts');

// Order matters: the all-down case must run before anything healthy is cached.
test('throws AlgodUnavailableError when no algod endpoint answers', async () => {
  state.mode = 'all-down';
  await assert.rejects(() => getFailoverAlgodClient(), (err) => {
    assert.ok(err instanceof AlgodUnavailableError, `expected AlgodUnavailableError, got ${err && err.name}`);
    return true;
  });
});

test('returns a working public node when the self-hosted node is down', async () => {
  state.mode = 'public-up';
  const client = await getFailoverAlgodClient();
  assert.ok(client, 'no client returned');
  assert.match(client.server, /nodely|algonode/, `expected a public node, got ${client.server}`);
});

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

test('the claim surface uses the failover client instead of the single configured node', () => {
  for (const rel of ['pages/api/rewards/claim.ts', 'pages/api/rewards/boost.ts', 'pages/api/rewards/confirm.ts']) {
    const src = read(rel);
    assert.match(src, /getFailoverAlgodClient/, `${rel} still builds its algod client without failover`);
    assert.doesNotMatch(
      src.replace(/import[^;]+;/g, ''),
      /=\s*getAlgodClient\(\)/,
      `${rel} still calls getAlgodClient() directly`
    );
  }
});
