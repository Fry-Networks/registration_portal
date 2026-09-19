// R11 regression test: /api/rewards/claim must not pay a voided reward row.
//
// Before R11, claim.ts filtered only on `status === 'claimable' && !isHeld(r)` and never
// imported isVoided. A row carrying voided_by but no payout_hold was invisible in every UI
// total (effective.ts excludes it) yet still selected for payment by the claim path — the one
// code path that moves real tokens.
//
// claim.ts is a Next.js handler with heavy I/O, so the selection predicate is asserted at the
// source level. That is deliberate: it is the actual claim path being checked, not a local
// re-implementation of it (a re-implementation would pass whether or not claim.ts was fixed).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

require('ts-node').register({
  transpileOnly: true,
  compilerOptions: { module: 'commonjs', moduleResolution: 'node', target: 'ES2017', jsx: 'react' },
});

const CLAIM = path.join(__dirname, '..', 'pages', 'api', 'rewards', 'claim.ts');
const src = fs.readFileSync(CLAIM, 'utf8');

test('claim.ts imports isVoided from the effective helpers', () => {
  const importLine = src.split('\n').find((l) => l.includes("from '../../../lib/rewards/effective'"));
  assert.ok(importLine, 'claim.ts must import from lib/rewards/effective');
  assert.match(
    importLine,
    /\bisVoided\b/,
    'claim.ts must import isVoided — without it the claim path cannot honour voided rows'
  );
});

test('both claimable selections exclude voided rows', () => {
  const lines = src.split('\n').filter((l) => /(weekly|daily)Claimables\s*=\s*\(/.test(l));
  assert.equal(lines.length, 2, 'expected exactly the weekly and daily claimable selections');
  for (const l of lines) {
    assert.match(l, /!isVoided\(/, `claimable selection must exclude voided rows: ${l.trim()}`);
    assert.match(l, /!isHeld\(/, `claimable selection must still exclude held rows: ${l.trim()}`);
  }
});

test('a voided row is not reported as merely "on hold"', () => {
  const lines = src.split('\n').filter((l) => /status === 'claimable' && .*isHeld\(/.test(l) && /\.some\(/.test(l));
  assert.ok(lines.length >= 1, 'expected the held-detection predicates');
  for (const l of lines) {
    assert.match(l, /!isVoided\(/, `held-detection must skip voided rows: ${l.trim()}`);
  }
});

// Behavioural assertions against the real helpers — these guard effective.ts itself.
const { isHeld, isVoided, effectiveAmount, computeClaimableTotals } = require('../lib/rewards/effective.ts');

const VOIDED_NO_HOLD = {
  status: 'claimable',
  amount: 9463.68,
  voided_by: 'oneshot-r11-test',
  reward_number: 42,
  asset_id: '2485202024',
};
const HEALTHY = { status: 'claimable', amount: 100, reward_number: 7, asset_id: '2485202024' };

test('the gap fixture really is voided-but-not-held', () => {
  assert.equal(isVoided(VOIDED_NO_HOLD), true);
  assert.equal(isHeld(VOIDED_NO_HOLD), false, 'if this were held, the gap would not exist');
});

test('voided rows contribute nothing to claimable totals', () => {
  const totals = computeClaimableTotals({ weekly_rewards: [VOIDED_NO_HOLD, HEALTHY], daily_rewards: [] });
  assert.equal(totals.claimable, 100, 'only the healthy row counts');
  assert.equal(totals.held, 0, 'a voided row must not be counted as held either');
  assert.equal(effectiveAmount(HEALTHY), 100);
});
