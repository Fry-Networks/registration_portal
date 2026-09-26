// Regression test for a TOCTOU gap in the user-pays claim path (oneshot4-20260923T182503Z, B3).
//
// pages/api/rewards/claim.ts computes `records`/`summary`/`assetLegs` ONCE from a snapshot read
// (that is where isVoided/isHeld get applied, via lib/rewards/effective.ts), then reuses that
// snapshot unchanged across a chain of awaited algod round-trips (decimals lookup, vault-liquidity
// check, per-asset opt-in check, FFG sink-opted-in check, buildUserPaysClaimGroup) before finally
// calling reserveRows(). reserveRows's arrayFilter validated only `status`, never voided_by /
// payout_hold / ghost_device / evidence_unavailable -- all fields written exclusively by an
// external reward pipeline (zero write sites in this repo). A row that pipeline voided or held
// DURING that async window still carried status:'claimable' and so still reserved, still rode the
// stale (already-decided-against) amount into the payout total.
//
// Verified against live production data that this gap has NOT fired against the 1,104-row
// stranded-claim backlog reported the same day: zero of those rows carry voided_by. This test
// closes the gap for future claims; it does not explain or touch that backlog.
//
// Fix: add the same negatives lib/rewards/effective.ts's isVoided/isHeld check to reserveRows's
// existing arrayFilter. This makes reservation STRICTER -- the failure mode becomes "this row does
// not reserve" (nothing written, nothing to strand) rather than "reserve it anyway at a stale
// amount". Only the arrayFilter predicate changes; releaseStaleReservations is untouched.

const test = require('node:test');
const assert = require('node:assert/strict');

const { CLAIMABLE, CLAIMING, reserveRows } = require('../lib/rewards/reservation.js');

// Walks whatever predicate reserveRows actually sends, rather than hand-picking the fields the
// OLD code used -- so a tightened filter is genuinely exercised instead of silently ignored.
function evalPredicate(row, predicate) {
  for (const [key, want] of Object.entries(predicate)) {
    const field = key.startsWith('elem.') ? key.slice('elem.'.length) : key;
    const have = row[field];
    if (want && typeof want === 'object' && !Array.isArray(want)) {
      if ('$in' in want) { if (!want.$in.includes(have)) return false; continue; }
      if ('$exists' in want) { if ((have !== undefined) !== want.$exists) return false; continue; }
      if ('$ne' in want) { if (have === want.$ne) return false; continue; }
      throw new Error(`unsupported operator in fake arrayFilter: ${JSON.stringify(want)}`);
    }
    if (have !== want) return false;
  }
  return true;
}

function fakeCollection(doc) {
  return {
    doc,
    async updateOne(filter, update, options) {
      const af = (options && options.arrayFilters && options.arrayFilters[0]) || {};
      const setKeys = Object.keys(update.$set || {});
      const arr = setKeys[0].split('.')[0];
      let modified = 0;
      for (const row of doc[arr] || []) {
        if (!evalPredicate(row, af)) continue;
        for (const k of setKeys) row[k.split('.').pop()] = update.$set[k];
        modified = 1;
      }
      return { modifiedCount: modified };
    }
  };
}

test('a voided duplicate is not reserved even though status is still claimable', async () => {
  const doc = {
    miner_key: 'FEM-TEST',
    weekly_rewards: [
      { reward_number: 1, status: CLAIMABLE, voided_by: 'oos3-dup-cleanup-1789143233' }
    ],
    daily_rewards: []
  };
  const c = fakeCollection(doc);
  await reserveRows(c, 'FEM-TEST', [{ source: 'weekly', reward_number: 1 }], 'group-A');
  assert.equal(doc.weekly_rewards[0].status, CLAIMABLE,
    'a row the reward pipeline already voided must not flip to claiming');
  assert.equal(doc.weekly_rewards[0].claiming_group, undefined);
});

test('a held row (payout_hold) is not reserved even though status is still claimable', async () => {
  const doc = {
    miner_key: 'FEM-TEST',
    weekly_rewards: [{ reward_number: 1, status: CLAIMABLE, payout_hold: true }],
    daily_rewards: []
  };
  const c = fakeCollection(doc);
  await reserveRows(c, 'FEM-TEST', [{ source: 'weekly', reward_number: 1 }], 'group-A');
  assert.equal(doc.weekly_rewards[0].status, CLAIMABLE, 'a payout_hold row must not be reserved');
});

test('a ghost_device row is not reserved', async () => {
  const doc = {
    miner_key: 'FEM-TEST',
    weekly_rewards: [{ reward_number: 1, status: CLAIMABLE, ghost_device: true }],
    daily_rewards: []
  };
  const c = fakeCollection(doc);
  await reserveRows(c, 'FEM-TEST', [{ source: 'weekly', reward_number: 1 }], 'group-A');
  assert.equal(doc.weekly_rewards[0].status, CLAIMABLE, 'a ghost_device row must not be reserved');
});

test('an evidence_unavailable row is not reserved', async () => {
  const doc = {
    miner_key: 'FEM-TEST',
    weekly_rewards: [{ reward_number: 1, status: CLAIMABLE, evidence_unavailable: true }],
    daily_rewards: []
  };
  const c = fakeCollection(doc);
  await reserveRows(c, 'FEM-TEST', [{ source: 'weekly', reward_number: 1 }], 'group-A');
  assert.equal(doc.weekly_rewards[0].status, CLAIMABLE,
    'an evidence_unavailable row must not be reserved');
});

test('an ordinary claimable row with none of these flags still reserves normally', async () => {
  const doc = {
    miner_key: 'FEM-TEST',
    weekly_rewards: [{ reward_number: 1, status: CLAIMABLE }],
    daily_rewards: []
  };
  const c = fakeCollection(doc);
  const reserved = await reserveRows(c, 'FEM-TEST', [{ source: 'weekly', reward_number: 1 }], 'group-A');
  assert.ok(reserved > 0, 'the happy path must still reserve');
  assert.equal(doc.weekly_rewards[0].status, CLAIMING);
  assert.equal(doc.weekly_rewards[0].claiming_group, 'group-A');
});

test('a mixed batch reserves the clean row and skips the voided one', async () => {
  const doc = {
    miner_key: 'FEM-TEST',
    weekly_rewards: [
      { reward_number: 1, status: CLAIMABLE },
      { reward_number: 2, status: CLAIMABLE, voided_by: 'oos3-dup-cleanup-1789143233' }
    ],
    daily_rewards: []
  };
  const c = fakeCollection(doc);
  const records = [
    { source: 'weekly', reward_number: 1 },
    { source: 'weekly', reward_number: 2 }
  ];
  await reserveRows(c, 'FEM-TEST', records, 'group-A');
  assert.equal(doc.weekly_rewards[0].status, CLAIMING, 'the clean row still reserves');
  assert.equal(doc.weekly_rewards[1].status, CLAIMABLE, 'the voided row must not join the group');
});
