// Regression tests for the Discord "0 of 2 online" / "green but no rewards" reports
// (dashfix-20260807).
//
// 1. /api/devices/status-summary used to answer 200 {total:0, online:0} whenever the
//    activity lookup failed, which the Network Status tile renders as "0 of N online" —
//    indistinguishable from every miner being down. A failed lookup must say so.
// 2. A device can heartbeat (is_active true, green "Active") and still earn nothing,
//    because hardwareapi marks PoC.hardware.reward_eligible=false (version / liveness
//    gate) and dbRewards short-circuits on it. The device APIs must carry that verdict.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

require('ts-node').register({
  transpileOnly: true,
  compilerOptions: { module: 'commonjs', moduleResolution: 'node', target: 'ES2017', jsx: 'react' },
});

const ADDR = 'SYNTHWALLETL6AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const KEY_A = 'FEM-K3QVR1OQ8Q76EP59OERY68SUTT16YF3L';
const KEY_B = 'FEM-ABCECB4JMH7HR6K7M8PWWA9RSDLAW111';

const stub = (relPath, exports) => {
  const resolved = require.resolve(relPath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
};

// 'ok' → PoC answers; 'down' → every PoC/dailies lookup throws.
const state = { mode: 'ok' };

const boom = () => {
  throw new Error('mongo unavailable');
};

const fakeClient = {
  db: (name) => {
    if (name === 'main') {
      return {
        collection: (col) => {
          if (col === 'devices' || col === 'test-devices') {
            return {
              find: () => ({
                project: () => ({
                  toArray: async () => [
                    { _id: '1', miner_key: KEY_A },
                    { _id: '2', miner_key: KEY_B },
                  ],
                }),
              }),
            };
          }
          if (col === 'poc_reward_dailies') {
            return { distinct: async () => (state.mode === 'down' ? boom() : []) };
          }
          return { find: () => ({ toArray: async () => [] }) };
        },
      };
    }
    // PoC
    return {
      collection: (col) => {
        if (col === 'hardware') {
          return {
            aggregate: () => ({ toArray: async () => (state.mode === 'down' ? boom() : []) }),
            find: () => ({ toArray: async () => (state.mode === 'down' ? boom() : []) }),
          };
        }
        if (col === 'installations') {
          return { distinct: async () => (state.mode === 'down' ? boom() : []) };
        }
        return { find: () => ({ toArray: async () => [] }) };
      },
    };
  },
};

stub('next-auth', { __esModule: true, getServerSession: async () => ({ user: { address: ADDR } }) });
stub('../pages/api/auth/[...nextauth].ts', { __esModule: true, authOptions: {} });
stub('../lib/mongoclient', { __esModule: true, default: Promise.resolve(fakeClient) });

const statusSummary = require('../pages/api/devices/status-summary.ts').default;

const callStatusSummary = async () => {
  const captured = { code: 0, body: null };
  const res = {
    status(c) {
      captured.code = c;
      return res;
    },
    json(b) {
      captured.body = b;
      return res;
    },
  };
  await statusSummary({ method: 'POST', headers: {}, body: {} }, res);
  return captured;
};

test('status-summary reports unavailable instead of a false "0 online" when the lookup fails', async () => {
  state.mode = 'down';
  const { code, body } = await callStatusSummary();
  assert.equal(code, 503, `expected 503 on lookup failure, got ${code} ${JSON.stringify(body)}`);
  assert.equal(body.success, false);
  assert.notEqual(body.online, 0, 'a failed lookup must not report an online count at all');
});

test('status-summary still answers 200 with real counts when the lookup works', async () => {
  state.mode = 'ok';
  const { code, body } = await callStatusSummary();
  assert.equal(code, 200);
  assert.equal(body.success, true);
  assert.equal(body.total, 2);
  assert.equal(body.online, 0); // genuinely nothing active in the fixture
});

// ---------------------------------------------------------------- reward eligibility

const { getRewardEligibility } = require('../lib/deviceActivity.ts');

const eligibilityClient = (hardwareDocs) => ({
  db: () => ({
    collection: (col) => {
      if (col === 'hardware') return { find: () => ({ toArray: async () => hardwareDocs }) };
      if (col === 'versions') {
        return {
          find: () => ({
            toArray: async () => [
              { miner_code: 'FEM', windows: { poc_version_needed: '1.0.0' }, poc_version_needed: '1.0.0' },
            ],
          }),
        };
      }
      return { find: () => ({ toArray: async () => [] }) };
    },
  }),
});

test('an outdated but heartbeating miner is reported as update_required', async () => {
  const client = eligibilityClient([
    {
      miner_key: KEY_A,
      reward_eligible: false,
      lastUpdated: new Date().toISOString(),
      software: { os: 'windows', poc_version_installed: '0.9.1' },
    },
  ]);
  const map = await getRewardEligibility(client, [KEY_A]);
  const v = map.get(KEY_A);
  assert.ok(v, 'no verdict returned');
  assert.equal(v.eligible, false);
  assert.equal(v.reason, 'update_required');
  assert.equal(v.pocVersionInstalled, '0.9.1');
  assert.equal(v.pocVersionRequired, '1.0.0');
});

test('a stale-heartbeat miner is reported as no_recent_heartbeat', async () => {
  const client = eligibilityClient([
    {
      miner_key: KEY_A,
      reward_eligible: false,
      lastUpdated: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
      software: { os: 'windows', poc_version_installed: '1.0.0' },
    },
  ]);
  const v = (await getRewardEligibility(client, [KEY_A])).get(KEY_A);
  assert.equal(v.reason, 'no_recent_heartbeat');
});

test('an eligible miner and a miner with no PoC document are not flagged as blocked', async () => {
  const client = eligibilityClient([
    {
      miner_key: KEY_A,
      reward_eligible: true,
      lastUpdated: new Date().toISOString(),
      software: { os: 'windows', poc_version_installed: '1.0.0' },
    },
  ]);
  const map = await getRewardEligibility(client, [KEY_A, KEY_B]);
  assert.equal(map.get(KEY_A).eligible, true);
  assert.equal(map.get(KEY_B).eligible, null, 'a device with no PoC doc must not be labelled ineligible');
});

// ---------------------------------------------------------------- wiring

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

test('the device APIs attach the reward verdict alongside is_active', () => {
  for (const rel of ['pages/api/devices/batch.ts', 'pages/api/devices/[miner_key].ts']) {
    const src = read(rel);
    assert.match(src, /getRewardEligibility/, `${rel} does not look up reward eligibility`);
    assert.match(src, /reward_eligible/, `${rel} does not attach reward_eligible`);
    assert.match(src, /reward_block_reason/, `${rel} does not attach reward_block_reason`);
  }
});

test('the device card shows a "Not earning" pill when the reward verdict is false', () => {
  const src = read('components/DeviceListItem.tsx');
  assert.match(src, /device\.reward_eligible === false/, 'no reward-eligibility branch in the card');
  assert.match(src, /Not earning/, 'no "Not earning" label rendered');
  assert.match(src, /rewardBlockHint/, 'the pill carries no explanation');
});
