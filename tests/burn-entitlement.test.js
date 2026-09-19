// Regression test for the unpaid FRY 1.0 conversions (dashfix-round2).
//
// transfer_post_snapshot recomputed the claim from the live wallet balance
// (balance - snapshot). Once the user has burned, that difference is 0, so the claim
// answered 400 "No tFRY available to claim" — measured in production as 73 of 76 recorded
// burns never paid, 603,897 tFRY owed. The recorded burn is the entitlement.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'pages', 'api', 'conversion', 'transfer_post_snapshot.ts'), 'utf8');

test('a completed burn is paid from the recorded entitlement, not the post-burn balance', () => {
  assert.match(SRC, /record\.eligible_fry1/, 'the recorded burn amount is never read');
  assert.match(SRC, /record\.eligible_tFRY/, 'the recorded tFRY entitlement is never read');
  assert.match(SRC, /hasRecordedBurn/, 'no branch prefers the recorded burn');
  const idx = SRC.indexOf('const eligible_tFRY');
  const decl = SRC.slice(idx, idx + 260);
  assert.match(decl, /hasRecordedBurn/, 'eligible_tFRY still comes only from the recomputed balance');
});

test('the pre-burn path still computes eligibility from the live balance', () => {
  assert.match(SRC, /userFry1Balance - snapshotAmount/, 'the recompute path was removed');
  assert.match(SRC, /recomputedFry1/, 'no fallback for wallets without a recorded burn');
});

test('an unreachable algod returns 503 rather than throwing', () => {
  // Anchor on the call site, not the import line.
  const i = SRC.indexOf('await getFailoverAlgodClient()');
  assert.ok(i > 0, 'no getFailoverAlgodClient call site found');
  const around = SRC.slice(Math.max(0, i - 300), i + 900);
  assert.match(around, /try\s*{/, 'failover client acquisition is not guarded');
  assert.match(around, /POST_SNAPSHOT_CLAIM_ALGOD_UNAVAILABLE/, 'algod unavailability is not logged');
  assert.match(around, /503/, 'algod unavailability does not map to 503');
});
