// Regression tests for the "Claim button that can only fail" defect (dashb-rewards-hub run, 2026-09-10).
//
// /api/rewards/claim refuses a single-row claim with 403 REWARD_ON_HOLD when the row is held OR
// when it has no PoC evidence in its own window (the A-gate). /api/rewards/get-rewards-page only
// exposed the three hold flags as `onHold`, so an A-gate-blocked row rendered as "Claimable" with a
// Claim button, and users saw "These rewards are under review and cannot be claimed yet." Seen live
// on 4 devices in the 48h before the fix. Related display gaps: DailyRow ignored onHold entirely,
// Claim.tsx had no friendly text for REWARD_ON_HOLD, the home tile said "Nothing pending" whenever
// claimable was 0, and /devices counted FEM keys registered as nodes as miners ("33 miners, 0 nodes").
//
// Set RD_SOURCE_SUFFIX to a backup suffix (e.g. '.bak.1789090000') to run against the pre-fix files.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SUFFIX = process.env.RD_SOURCE_SUFFIX || '';
const read = (rel) => fs.readFileSync(path.join(ROOT, rel + SUFFIX), 'utf8');

test('get-rewards-page mirrors the claim A-gate per row (pendingEvidence)', () => {
  const src = read('pages/api/rewards/get-rewards-page.ts');
  assert.match(src, /loadEvidence\s*\(/, 'must load PoC evidence for the device');
  assert.match(src, /passesAGate\s*\(/, 'must evaluate the A-gate per row');
  assert.match(src, /pendingEvidence:\s*wr\.status === 'claimable'/, 'weekly rows carry pendingEvidence');
  assert.match(src, /pendingEvidence:\s*dr\.status === 'claimable'/, 'daily rows carry pendingEvidence');
});

test('history.tsx never offers Claim for rows the claim path refuses', () => {
  const src = read('pages/history.tsx');
  const claimableLines = src.split(/\r?\n/).filter((l) => /status === 'claimable' && !/.test(l));
  assert.ok(claimableLines.length >= 4, `expected the claimable filters to exist, found ${claimableLines.length}`);
  for (const l of claimableLines) {
    assert.match(l, /pendingEvidence/, `claimable filter must also exclude pendingEvidence: ${l.trim()}`);
  }
  assert.match(src, /Awaiting PoC evidence/, 'must label A-gate-blocked rows');
  assert.match(src, /awaiting PoC evidence \(/, 'summary chip for awaiting-evidence rows');
});

test('DailyRow only enables Claim for rows that are not held and have evidence', () => {
  const src = read('components/DailyRow.tsx');
  const line = src.split(/\r?\n/).find((l) => /const canClaim = /.test(l)) || '';
  assert.match(line, /onHold/, 'canClaim must honour onHold');
  assert.match(line, /pendingEvidence/, 'canClaim must honour pendingEvidence');
});

test('Claim modal explains REWARD_ON_HOLD instead of echoing the raw server string', () => {
  const src = read('components/modals/Claim.tsx');
  const hits = (src.match(/code === 'REWARD_ON_HOLD'/g) || []).length;
  assert.ok(hits >= 3, `expected REWARD_ON_HOLD handled in all 3 friendly maps, found ${hits}`);
});

test('summary endpoint reports why claimable is zero (pending, accruing, held, pendingEvidence)', () => {
  const src = read('pages/api/rewards/summary.ts');
  for (const k of ['pending:', 'accruing:', 'held:', 'pendingEvidence:']) {
    assert.ok(src.includes(k), `summary must return ${k}`);
  }
});

test('home tile only says "Nothing pending" after exhausting the non-claimable buckets', () => {
  const src = read('pages/index.tsx');
  assert.match(src, /rewardsMeta\.pendingEvidence > 0/, 'tile checks awaiting-evidence value');
  assert.match(src, /rewardsMeta\.held > 0/, 'tile checks held value');
  assert.match(src, /rewardsMeta\.pending > 0/, 'tile checks maturing value');
  assert.match(src, /rewardsMeta\.accruing > 0/, 'tile checks accruing value');
  assert.match(src, /new_registration/, 'zero-device hint links to the miner-key registration page');
  assert.doesNotMatch(src, /href: '\/register',/, 'quick action must not land on /register without a key');
});

test('/devices classifies portal-registered nodes as nodes, not only by key prefix', () => {
  const src = read('pages/devices.tsx');
  assert.match(src, /registered_portal_model === 'node'/, 'node classification must honour registered_portal_model');
  assert.doesNotMatch(src, /const NODE_PREFIXES = new Set\(\['RDN', 'SVN', 'SDN', 'CN'\]\);\n  const miners/, 'StatsGrid must not use the prefix-only set');
  assert.doesNotMatch(src, /return \['RDN', 'SVN', 'SDN', 'CN'\]\.includes\(prefix\);/, 'isNodeDevice must not be prefix-only');
  assert.match(src, /Register its miner key/, 'empty state hints at miner-key registration');
});
