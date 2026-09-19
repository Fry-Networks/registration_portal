const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Guard for the dead device-ownership fallback. Commit 0d0c507 added a
// {user_id: <registration-users._id>} clause to these queries, but devices.user_id holds a
// legacy main.users._id, so the clause matched 0 of 907 candidate devices fleet-wide. These
// files must not reintroduce it. Set OD_SOURCE_SUFFIX to a backup suffix (e.g. '.bak.1785480941')
// to run the same assertions against the pre-removal snapshots, which fail.
const ROOT = path.resolve(__dirname, '..');
const SUFFIX = process.env.OD_SOURCE_SUFFIX || '';

const FILES = [
  'pages/api/my-keys.ts',
  'pages/api/devices/list.ts',
  'pages/api/devices/status-summary.ts',
  'pages/api/rewards/get-reward-summary.ts',
  'pages/api/rewards/get-reward-summary-batch.ts',
  'pages/devices.tsx',
  'lib/x402/ownership.ts'
];

const FORBIDDEN = [
  /ownershipClauses\.push\(\s*\{\s*user_id/,
  /clauses\.push\(\s*\{\s*user_id/,
  /ownedByUserId/,
  /\$or:\s*\[\s*\{\s*address:[^\]]*\{\s*user_id/s
];

for (const rel of FILES) {
  test(`no user_id ownership clause in ${rel}`, () => {
    const src = fs.readFileSync(path.join(ROOT, rel + SUFFIX), 'utf8');
    for (const re of FORBIDDEN) {
      assert.equal(re.test(src), false, `${rel} still builds a user_id ownership clause (${re})`);
    }
  });
}

test('every ownership site still filters by wallet address', () => {
  for (const rel of FILES) {
    const src = fs.readFileSync(path.join(ROOT, rel + SUFFIX), 'utf8');
    assert.ok(
      /address:\s*(session\.user\.address|walletAddress|owner)/.test(src) ||
        /device\.address === walletAddress/.test(src),
      `${rel} no longer filters devices by address`
    );
  }
});
