// Regression test for the staked-but-never-verified cohort.
//
// Evidence this reproduces (live main.devices, 2026-08-31): 76 devices hold a complete,
// current FRY 2.0 stake (asset_id '2485314946') yet verified is false. 76/76 of them have
// created_at AFTER staked.time, versus 1/4144 of the verified FRY 2.0 population — the
// device document was created after the stake already existed, so /api/stake/verification
// (the only writer of verified:true) never fired for them. Nothing reconciles that state.
//
// These assertions are behavioural: the predicate is transpiled and executed, not grepped.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const ROOT = path.join(__dirname, '..');

// Load a TS module in isolation, resolving its relative imports from a stub map so the
// predicate can be exercised without booting Next.js or a database. Only files read from
// this repository are evaluated, and each one runs in its own vm context whose `require`
// resolves nothing beyond the explicit stub map.
function loadTs(rel, stubs) {
  const filename = path.join(ROOT, rel);
  const js = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
  }).outputText;
  const mod = { exports: {} };
  const sandbox = {
    module: mod,
    exports: mod.exports,
    // legacyStake.ts reads process.env for the force-unverify timestamp.
    process: { env: {} },
    console,
    require: (id) => {
      if (Object.prototype.hasOwnProperty.call(stubs, id)) return stubs[id];
      throw new Error('unexpected runtime import: ' + id);
    },
  };
  vm.runInNewContext(js, vm.createContext(sandbox), { filename });
  return mod.exports;
}

const utils = { FRY_1: { id: '924268058', decimals: 6 }, FRY_2: { id: '2485314946', decimals: 6 } };
const legacyStake = loadTs('lib/legacyStake.ts', { './types': {}, './utils': utils });
const { shouldReconcileVerified } = loadTs('lib/stakeReconcile.ts', {
  './types': {}, './utils': utils, './legacyStake': legacyStake,
});

// Shaped from the real cohort document FEM-9P1DJ5F2R86M77PB09CP8BQDFLY2UESR.
const cohortDevice = (over = {}) => ({
  miner_key: 'FEM-9P1DJ5F2R86M77PB09CP8BQDFLY2UESR',
  address: 'SYNTHWALLETBXAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  reward_wallet: 'SYNTHWALLETILAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  created_at: new Date('2026-07-06T10:48:06.975Z'),
  verified: false,
  legacy_stake_unlocked: false,
  staked: {
    amount: 186.5,
    txId: 'WHMSNTZFWX3S3X7VUM3TBHWJJBQUMKAJ2NP7UJNSJYZCTTAYRBIQ',
    time: new Date('2025-11-22T14:12:37.646Z'),
    asset_id: '2485314946',
    type: 'two',
    lastWithdrawal: null,
    withdrawals: [],
  },
  ...over,
});

test('reconciles a device registered after its FRY 2.0 stake (the 76-device cohort)', () => {
  assert.strictEqual(shouldReconcileVerified(cohortDevice()), true);
});

test('reconciles regardless of split reward_wallet/address ownership', () => {
  // minerman's device: address !== reward_wallet. Ownership must not gate verification.
  const d = cohortDevice();
  assert.notStrictEqual(d.address, d.reward_wallet);
  assert.strictEqual(shouldReconcileVerified(d), true);
});

test('is a no-op for an already-verified device', () => {
  assert.strictEqual(shouldReconcileVerified(cohortDevice({ verified: true })), false);
});

test('never reconciles a FRY 1.0 legacy stake', () => {
  const d = cohortDevice();
  d.staked.asset_id = '924268058';
  assert.strictEqual(shouldReconcileVerified(d), false);
});

test('never reconciles a legacy-unlocked stake (the force-unverify path owns it)', () => {
  const d = cohortDevice({ legacy_stake_unlocked: true });
  d.staked.asset_id = '924268058';
  assert.strictEqual(shouldReconcileVerified(d), false);
});

test('never reconciles a withdrawn stake (asset_id nulled by migrate-stake-history)', () => {
  const d = cohortDevice();
  d.staked.asset_id = null;
  assert.strictEqual(shouldReconcileVerified(d), false);
});

test('never reconciles a stake with a recorded withdrawal', () => {
  const d = cohortDevice();
  d.staked.lastWithdrawal = { amount: 186.5, txId: 'X'.repeat(52), time: new Date(), asset_id: '2485314946' };
  assert.strictEqual(shouldReconcileVerified(d), false);
});

test('never reconciles a zero, negative, or missing amount', () => {
  for (const amount of [0, -1, null, undefined]) {
    const d = cohortDevice();
    d.staked.amount = amount;
    assert.strictEqual(shouldReconcileVerified(d), false, 'amount=' + amount);
  }
});

test('never reconciles a missing txId or missing stake time', () => {
  const noTx = cohortDevice(); noTx.staked.txId = null;
  assert.strictEqual(shouldReconcileVerified(noTx), false);
  const noTime = cohortDevice(); noTime.staked.time = null;
  assert.strictEqual(shouldReconcileVerified(noTime), false);
});

test('tolerates absent device / absent stake block', () => {
  assert.strictEqual(shouldReconcileVerified(null), false);
  assert.strictEqual(shouldReconcileVerified(undefined), false);
  assert.strictEqual(shouldReconcileVerified({ verified: false }), false);
});

// Wiring: the predicate must actually be applied on both device read paths, otherwise the
// cohort stays broken no matter how correct the predicate is.
for (const rel of ['pages/api/devices/batch.ts', 'pages/api/devices/[miner_key].ts']) {
  test(`${rel} applies the reconciliation and persists verified:true`, () => {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    assert.match(src, /shouldReconcileVerified/, 'route does not call the predicate');
    assert.match(src, /\$set:\s*\{\s*verified:\s*true\s*\}/, 'route does not persist verified:true');
  });
}
