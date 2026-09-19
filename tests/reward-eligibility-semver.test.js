// BUG-8 (Kataroni): a device running a NEWER PoC version than the pin was labeled
// "update_required" by the dashboard while hardwareapi's semver >= gate passes it.
// getRewardEligibility must mirror the server's semantic comparison (dashfix-round4).

const test = require('node:test');
const assert = require('node:assert/strict');

require('ts-node').register({
  transpileOnly: true,
  compilerOptions: { module: 'commonjs', moduleResolution: 'node', target: 'ES2017', jsx: 'react' },
});

const { getRewardEligibility } = require('../lib/deviceActivity');

const KEY = 'FEM-SEMVERTESTKEY0000000000000000AA';

const mkClient = (hwDoc, versionDoc) => ({
  db: () => ({
    collection: (col) => {
      if (col === 'hardware') return { find: () => ({ toArray: async () => [hwDoc] }) };
      if (col === 'versions') return { find: () => ({ toArray: async () => [versionDoc] }) };
      return { find: () => ({ toArray: async () => [] }) };
    },
  }),
});

const FEM_VERSIONS = { miner_code: 'FEM', windows: { poc_version_needed: '1.0.0' } };
const fresh = new Date().toISOString();
const stale = new Date(Date.now() - 3 * 86400000).toISOString();

test('newer-than-pin installed version is NOT update_required', async () => {
  const client = mkClient({ miner_key: KEY, reward_eligible: false, lastUpdated: fresh,
    software: { os: 'windows', poc_version_installed: '1.6.8' } }, FEM_VERSIONS);
  const v = (await getRewardEligibility(client, [KEY])).get(KEY);
  assert.equal(v.eligible, false);
  assert.notEqual(v.reason, 'update_required');
});

test('older-than-pin installed version IS update_required', async () => {
  const client = mkClient({ miner_key: KEY, reward_eligible: false, lastUpdated: fresh,
    software: { os: 'windows', poc_version_installed: '0.9.9' } }, FEM_VERSIONS);
  const v = (await getRewardEligibility(client, [KEY])).get(KEY);
  assert.equal(v.reason, 'update_required');
});

test('equal version with stale heartbeat reports no_recent_heartbeat', async () => {
  const client = mkClient({ miner_key: KEY, reward_eligible: false, lastUpdated: stale,
    software: { os: 'windows', poc_version_installed: '1.0.0' } }, FEM_VERSIONS);
  const v = (await getRewardEligibility(client, [KEY])).get(KEY);
  assert.equal(v.reason, 'no_recent_heartbeat');
});
