// dashfix-round2 regressions:
// (1) computeActiveSet tier 3 counted ANY poc_reward_dailies row inside a 14-day window as
//     "online". A row is written for every device the reward job processes, so ~11.5k
//     disconnected devices rendered as green "Active" (measured: 11,534 active vs 24 with a
//     real heartbeat/lease). Tier 3 must mean recent *validated work*.
// (2) Server-side transaction building resolved suggested params from the single configured
//     algod. With that node down every executing claim/boost/conversion failed at build time
//     — claim *preview* never exercises this path, which is why it looked healthy.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

require('ts-node').register({
  transpileOnly: true,
  compilerOptions: { module: 'commonjs', moduleResolution: 'node', target: 'ES2017', jsx: 'react' },
});

const KEY = 'FEM-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

// ---------------------------------------------------------------- tier 3 semantics
const makeClient = (dailyDocs) => {
  const captured = { query: null };
  return {
    captured,
    client: {
      db: (name) => ({
        collection: (col) => {
          if (col === 'hardware') return { aggregate: () => ({ toArray: async () => [] }) };
          if (col === 'installations') return { distinct: async () => [] };
          if (col === 'poc_reward_dailies') {
            return {
              distinct: async (_field, q) => {
                captured.query = q;
                return dailyDocs.filter((d) => {
                  if (q.date && q.date.$gte && d.date < q.date.$gte) return false;
                  if (q.slots_valid && q.slots_valid.$gt !== undefined && !(d.slots_valid > q.slots_valid.$gt)) return false;
                  return true;
                }).map((d) => d.miner_key);
              },
            };
          }
          return { distinct: async () => [], find: () => ({ toArray: async () => [] }) };
        },
      }),
    },
  };
};

const { computeActiveSet, ACTIVITY_LOOKBACK_DAYS } = require('../lib/deviceActivity.ts');
const dayStr = (daysAgo) => new Date(Date.now() - daysAgo * 86400000).toISOString().slice(0, 10);

test('the activity lookback is one day', () => {
  assert.equal(ACTIVITY_LOOKBACK_DAYS, 1);
});

test('a device whose only daily row did no validated work is not "active"', async () => {
  const { client } = makeClient([{ miner_key: KEY, date: dayStr(0), slots_valid: 0 }]);
  const active = await computeActiveSet(client, [KEY]);
  assert.equal(active.has(KEY), false, 'a processed-but-idle device must not read as online');
});

test('a device with validated work today is "active"', async () => {
  const { client } = makeClient([{ miner_key: KEY, date: dayStr(0), slots_valid: 42 }]);
  const active = await computeActiveSet(client, [KEY]);
  assert.equal(active.has(KEY), true);
});

test('validated work from two days ago is outside the window', async () => {
  const { client } = makeClient([{ miner_key: KEY, date: dayStr(2), slots_valid: 42 }]);
  const active = await computeActiveSet(client, [KEY]);
  assert.equal(active.has(KEY), false);
});

test('the dailies query filters on both recency and validated slots', async () => {
  const { client, captured } = makeClient([]);
  await computeActiveSet(client, [KEY]);
  assert.ok(captured.query, 'dailies tier never queried');
  assert.ok(captured.query.date && captured.query.date.$gte, 'no recency filter');
  assert.deepEqual(captured.query.slots_valid, { $gt: 0 }, 'no validated-work filter');
});

// ---------------------------------------------------------------- server-side txn params
const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

test('server-side transaction building uses the failover algod, browser path unchanged', () => {
  const src = read('lib/wallet/transactions.ts');
  const fn = src.slice(src.indexOf('const resolveSuggestedParams'), src.indexOf('export const buildPaymentTxn'));
  assert.match(fn, /typeof window === 'undefined'/, 'no server-only branch in resolveSuggestedParams');
  assert.match(fn, /getFailoverAlgodClient/, 'server branch does not use the failover client');
  assert.match(fn, /getAlgodClient\(params\.network\)/, 'browser path must keep the configured client');
});

test('the failover module carries no hardcoded private node address', () => {
  const src = read('lib/algorand/failover.ts');
  assert.doesNotMatch(src, /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/, 'private IP literal must not ship in a browser-reachable module');
});
