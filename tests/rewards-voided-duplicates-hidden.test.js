// Regression test for OOS #3 of the 2026-09-10 dashboard oneshot: ~4k weekly rows that were
// already paid (a `claimed` twin with tx_id for the same asset + week) still sat as `claimable`
// and, after the A-gate display fix, surfaced as "Awaiting PoC evidence". They are neutralised
// row-by-row with payout_hold + voided_by (never a new status: dbRewards' Mongoose enum would
// break save()). The dashboard must not show or count rows carrying `voided_by` anywhere —
// not as claimable, not as held, not in the history list — while the claim path stays untouched
// (payout_hold already blocks payment there).
//
// Set RD_SOURCE_SUFFIX to a backup suffix (e.g. '.bak.1789143233') to run these assertions
// against the pre-fix snapshots, which fail.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SUFFIX = process.env.RD_SOURCE_SUFFIX || '';
const read = (rel) => fs.readFileSync(path.join(ROOT, rel + SUFFIX), 'utf8').replace(/\r\n/g, '\n');

test('effective.ts exports isVoided keyed on a non-empty voided_by marker', () => {
  const src = read('lib/rewards/effective.ts');
  assert.match(src, /export const isVoided = \(row: RewardRow\): boolean =>/);
  assert.match(src, /typeof row\?\.voided_by === 'string' && row\.voided_by\.length > 0/);
  assert.match(src, /voided_by\?: unknown;/);
});

test('computeClaimableTotals drops voided rows before looking at status', () => {
  const src = read('lib/rewards/effective.ts');
  const body = src.slice(src.indexOf('export function computeClaimableTotals'), src.indexOf('export const passesAGate'));
  assert.match(body, /const consider = \(row: RewardRow\) => \{\n\s+if \(isVoided\(row\)\) return;\n\s+if \(row\?\.status !== 'claimable'\) return;/);
});

test('computeGatedTotals drops voided rows before looking at status (so they land in no bucket)', () => {
  const src = read('lib/rewards/effective.ts');
  const body = src.slice(src.indexOf('export function computeGatedTotals'), src.indexOf('export function sumRowsByAssetForStatus'));
  assert.match(body, /const consider = \(row: any, kind: 'weekly' \| 'daily'\) => \{\n\s+if \(isVoided\(row\)\) return;\n\s+if \(row\?\.status !== 'claimable'\) return;/);
});

test('sumRowsByAssetForStatus skips voided weekly and daily rows', () => {
  const src = read('lib/rewards/effective.ts');
  const body = src.slice(src.indexOf('export function sumRowsByAssetForStatus'));
  assert.match(body, /if \(isVoided\(wr\)\) continue;/);
  assert.match(body, /if \(isVoided\(dr\)\) continue;/);
});

test('get-rewards-page filters voided weekly and daily rows out of the list', () => {
  const src = read('pages/api/rewards/get-rewards-page.ts');
  assert.match(src, /import \{[^}]*\bisVoided\b[^}]*\} from '\.\.\/\.\.\/\.\.\/lib\/rewards\/effective'/);
  assert.match(src, /\.filter\(\(wr: any\) => !isVoided\(wr\) && wr\.unlock_at/);
  assert.match(src, /\.filter\(\(dr: any\) => !isVoided\(dr\) && dr\.created_at/);
});

test('history.tsx server-side props filter voided weekly and daily rows out of the SSR list', () => {
  const src = read('pages/history.tsx');
  const ssr = src.slice(src.indexOf('getServerSideProps'));
  assert.match(src, /\bisVoided\b[^\n]*from '\.\.\/lib\/rewards\/effective'/);
  assert.match(ssr, /\.filter\(\(wr: any\) => !isVoided\(wr\) && wr\.unlock_at/);
  assert.match(ssr, /\.filter\(\(dr: any\) => !isVoided\(dr\) && dr\.created_at/);
});

test('the claim path is untouched by the voided filter (payout_hold already blocks payment)', () => {
  const src = read('pages/api/rewards/claim.ts');
  assert.doesNotMatch(src, /isVoided/);
});
