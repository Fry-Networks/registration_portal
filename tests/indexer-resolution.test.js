// Regression test for the FRY 1.0 burn-verification outage (dashfix-round2).
//
// lib/wallet/clients.ts derived the indexer URL as algod.baseServer.replace('api','idx').
// With ALGOD_URL pointing at a self-hosted node by IP there is no "api" substring, so the
// indexer client pointed at the (down) node itself. Every server-side indexer call failed —
// including set_post_snapshot's LookupTransactionByID, which verifies a FRY 1.0 burn AFTER
// the user's tokens have already left their wallet. Production evidence 2026-08-08 15:45:40:
//   {"endpoint":"/api/conversion/set_post_snapshot","error":"fetch failed",
//    "txId":"D52VUENQO6SGBG4MJECRDTGMJUPG6MSOKMIYH64CEAOXQSUGUHTQ", ...}
// The user burned 172,525.15 FRY 1.0 and got nothing.

const test = require('node:test');
const assert = require('node:assert/strict');

require('ts-node').register({
  transpileOnly: true,
  compilerOptions: { module: 'commonjs', moduleResolution: 'node', target: 'ES2017', jsx: 'react' },
});

const load = (env) => {
  for (const k of ['ALGOD_URL', 'INDEXER_URL', 'NEXT_PUBLIC_ALGOD_SERVER', 'NEXT_PUBLIC_INDEXER_SERVER']) delete process.env[k];
  Object.assign(process.env, env);
  // config + clients cache network settings at module scope — reload both.
  delete require.cache[require.resolve('../lib/wallet/config.ts')];
  delete require.cache[require.resolve('../lib/wallet/clients.ts')];
  return require('../lib/wallet/clients.ts');
};

const serverOf = (client) => {
  // algosdk keeps the base URL on the private http client; accept either shape.
  const c = client.c || client;
  const bu = (c.bc && (c.bc.baseURL || c.bc.address)) || c.baseURL || c.address;
  return String(bu && bu.href ? bu.href : bu);
};

test('a self-hosted algod URL does not drag the indexer down with it', () => {
  const { getIndexerClient } = load({ ALGOD_URL: 'http://100.69.195.100:8190' });
  const url = serverOf(getIndexerClient());
  assert.doesNotMatch(url, /100\.69\.195\.100/, `indexer must not point at the algod-only host (got ${url})`);
  assert.match(url, /idx|indexer/i, `indexer must resolve to an indexer host (got ${url})`);
});

test('an explicit INDEXER_URL always wins', () => {
  const { getIndexerClient } = load({ ALGOD_URL: 'http://100.69.195.100:8190', INDEXER_URL: 'https://my-idx.example.com' });
  assert.match(serverOf(getIndexerClient()), /my-idx\.example\.com/);
});

test('the public api→idx derivation still applies when it actually changes the host', () => {
  const { getIndexerClient } = load({ ALGOD_URL: 'https://mainnet-api.4160.nodely.dev' });
  assert.match(serverOf(getIndexerClient()), /mainnet-idx\.4160\.nodely\.dev/);
});

test('the algod client itself is untouched by the indexer fix', () => {
  const { getAlgodClient } = load({ ALGOD_URL: 'http://100.69.195.100:8190' });
  assert.match(serverOf(getAlgodClient()), /100\.69\.195\.100/, 'algod must still honour ALGOD_URL');
});
