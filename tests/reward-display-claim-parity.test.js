// Regression tests for the display/claim claimable mismatch (mega-oneshot run).
//
// /api/rewards/claim drops two classes of row that the display endpoints were still counting:
//   1. rows under review (payout_hold / ghost_device / evidence_unavailable), and
//   2. rows without `corrected_by` that have no live PoC evidence in their own epoch window
//      (claim.ts's "A-gate", `_aGateOk`).
// Because the summary endpoints applied neither (1) for daily rows nor (2) at all, the dashboard
// advertised a claimable balance that /api/rewards/claim then refused with "No rewards available
// to claim." / "These rewards are under review". Fleet-wide at the time of the fix that was
// 24,980 weekly rows / 37.0M units sitting on the wrong side of the A-gate.
//
// Set RD_SOURCE_SUFFIX to a backup suffix (e.g. '.bak.1787561065') to run these assertions
// against the pre-fix snapshots, which fail.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SUFFIX = process.env.RD_SOURCE_SUFFIX || '';
const read = (rel) => fs.readFileSync(path.join(ROOT, rel + SUFFIX), 'utf8');

// Every endpoint that reports a claimable total to the user.
const DISPLAY_ENDPOINTS = [
  'pages/api/rewards/get-asset-totals.ts',
  'pages/api/rewards/get-reward-summary.ts',
  'pages/api/rewards/summary.ts'
];

for (const rel of DISPLAY_ENDPOINTS) {
  test(`${rel} reports claimable through the A-gated helper`, () => {
    const src = read(rel);
    assert.match(
      src,
      /computeGatedTotals/,
      `${rel} must compute claimable via computeGatedTotals so it matches what claim.ts will pay`
    );
  });

  test(`${rel} loads PoC evidence to apply the A-gate`, () => {
    const src = read(rel);
    assert.match(
      src,
      /loadEvidence(Batch)?\s*\(/,
      `${rel} must load PoC evidence; without it the A-gate cannot be applied`
    );
  });
}

test('effective.ts exposes an A-gate that mirrors claim.ts', () => {
  const src = read('lib/rewards/effective.ts');
  assert.match(src, /export function computeGatedTotals/);
  assert.match(src, /export const passesAGate/);
  // claim.ts trusts a row that carries corrected_by, and exempts activated virtual devices.
  assert.match(src, /corrected_by/);
  assert.match(src, /isDeviceAGateExempt/);
});

test('gated totals separate held from evidence-blocked value', () => {
  const src = read('lib/rewards/effective.ts');
  // Both buckets must be reported so the UI can explain the gap rather than silently
  // showing a smaller number than the user expects.
  assert.match(src, /pendingEvidence/);
  assert.match(src, /held/);
});

test('summary.ts no longer projects hold flags for weekly rows only', () => {
  const src = read('pages/api/rewards/summary.ts');
  const projectsWeeklyHold = /weekly_rewards\.payout_hold/.test(src);
  const projectsDailyHold = /daily_rewards\.payout_hold/.test(src);
  assert.equal(
    projectsWeeklyHold && !projectsDailyHold,
    false,
    'summary.ts projected weekly hold flags without the daily ones, so every held daily row ' +
      'read back as unheld and was counted as claimable'
  );
});

test('summary.ts does not report a lookup failure as a successful zero balance', () => {
  const src = read('pages/api/rewards/summary.ts');
  const catchBlock = src.slice(src.indexOf('} catch'));
  assert.equal(
    /status\(200\)/.test(catchBlock),
    false,
    'a failed summary lookup must not be returned as { success: true, claimable: 0 }'
  );
});

test('get-asset-totals buckets claimable by row asset_id, not by miner-key prefix', () => {
  const src = read('pages/api/rewards/get-asset-totals.ts');
  assert.match(
    src,
    /bucketForAsset/,
    'claimable must be attributed per reward-row asset_id; bucketing by device prefix put ' +
      'tFRY earnings in the fNODE column on an all-FEM fleet'
  );
  // The old shape assigned the whole device to one bucket up front.
  assert.equal(
    /const bucket = isMinerDevice \? tfry : fnode;/.test(src),
    false,
    'per-device bucket selection is what mixed the two assets together'
  );
});

test('pocEvidence exposes a batched loader for the summary endpoints', () => {
  const src = read('lib/rewards/pocEvidence.ts');
  assert.match(src, /export async function loadEvidenceBatch/);
  // Must not become 2 queries per device for a large operator.
  assert.match(src, /\$in/);
});
