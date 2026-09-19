// Regression tests for the duplicate-payment race (final run 1785320000).
//
// Pre-fix, reward rows stayed `claimable` until a successful /confirm, so a second claim for the
// same rows minted a second payable envelope. ESM3XCELKLF2 was paid 710,815,000 nine times that
// way. These assertions describe the reservation that closes it.
const assert = require('node:assert/strict');
const test = require('node:test');

const {
  CLAIMABLE, CLAIMING, SETTLEABLE_FROM,
  numbersFor, reserveRows, releaseRows, mayReleaseExpiredReservation
} = require('../lib/rewards/reservation.js');

// Minimal stand-in for a device-rewards document driven through updateOne + arrayFilters.
function fakeCollection(doc) {
  return {
    doc,
    calls: [],
    async updateOne(filter, update, options) {
      this.calls.push({ filter, update, options });
      const af = (options && options.arrayFilters && options.arrayFilters[0]) || {};
      const setKeys = Object.keys(update.$set || {});
      const unsetKeys = Object.keys(update.$unset || {});
      const arr = setKeys.concat(unsetKeys)[0].split('.')[0];
      let modified = 0;
      for (const row of doc[arr] || []) {
        const wantNos = af['elem.reward_number'] && af['elem.reward_number'].$in;
        if (wantNos && !wantNos.includes(row.reward_number)) continue;
        if (af['elem.status'] && row.status !== af['elem.status']) continue;
        if (af['elem.claiming_group'] && row.claiming_group !== af['elem.claiming_group']) continue;
        if (af['elem.tx_id'] && af['elem.tx_id'].$exists === false && row.tx_id !== undefined) continue;
        for (const k of setKeys) row[k.split('.').pop()] = update.$set[k];
        for (const k of unsetKeys) delete row[k.split('.').pop()];
        modified = 1;
      }
      return { modifiedCount: modified };
    }
  };
}

const RECORDS = [
  { source: 'weekly', reward_number: 31 },
  { source: 'weekly', reward_number: 32 },
  { source: 'daily', reward_number: 7 },
];

function freshDoc() {
  return {
    miner_key: 'FEM-TEST',
    weekly_rewards: [
      { reward_number: 31, status: CLAIMABLE },
      { reward_number: 32, status: CLAIMABLE },
      { reward_number: 33, status: CLAIMABLE },
    ],
    daily_rewards: [{ reward_number: 7, status: CLAIMABLE }],
  };
}

test('a second claim for the same rows finds nothing claimable', async () => {
  const c = fakeCollection(freshDoc());
  const first = await reserveRows(c, 'FEM-TEST', RECORDS, 'group-A');
  assert.ok(first > 0, 'first claim must reserve');

  // What claim.ts does when it selects: only `claimable` rows are eligible.
  const stillClaimable = c.doc.weekly_rewards
    .concat(c.doc.daily_rewards)
    .filter((r) => RECORDS.some((x) => x.reward_number === r.reward_number) && r.status === CLAIMABLE);
  assert.deepEqual(stillClaimable, [], 'reserved rows must be invisible to a second claim');
});

test('reservation stamps the owning group so releases cannot cross claims', async () => {
  const c = fakeCollection(freshDoc());
  await reserveRows(c, 'FEM-TEST', RECORDS, 'group-A');
  for (const row of c.doc.weekly_rewards.filter((r) => r.reward_number !== 33)) {
    assert.equal(row.status, CLAIMING);
    assert.equal(row.claiming_group, 'group-A');
  }
  // A different group must not be able to release them.
  await releaseRows(c, 'FEM-TEST', RECORDS, 'group-B');
  assert.equal(c.doc.weekly_rewards[0].status, CLAIMING, 'another group must not release');

  await releaseRows(c, 'FEM-TEST', RECORDS, 'group-A');
  assert.equal(c.doc.weekly_rewards[0].status, CLAIMABLE, 'the owning group releases');
  assert.equal(c.doc.weekly_rewards[0].claiming_group, undefined);
});

test('an unrelated entitlement is still claimable', async () => {
  const c = fakeCollection(freshDoc());
  await reserveRows(c, 'FEM-TEST', RECORDS, 'group-A');
  const untouched = c.doc.weekly_rewards.find((r) => r.reward_number === 33);
  assert.equal(untouched.status, CLAIMABLE, 'reserving one claim must not freeze the rest');
});

test('confirm can settle from either claimable or claiming', () => {
  assert.ok(SETTLEABLE_FROM.includes(CLAIMABLE));
  assert.ok(SETTLEABLE_FROM.includes(CLAIMING));
});

test('an expired reservation is released only on proof nothing was paid', () => {
  assert.equal(mayReleaseExpiredReservation({ paid: false }), true);
  assert.equal(mayReleaseExpiredReservation({ paid: true }), false);
  assert.equal(mayReleaseExpiredReservation({ paid: null }), false, 'unknown must not release');
  assert.equal(mayReleaseExpiredReservation({}), false);
  assert.equal(mayReleaseExpiredReservation(null), false);
});

test('numbersFor splits records by source', () => {
  assert.deepEqual(numbersFor(RECORDS, 'weekly'), [31, 32]);
  assert.deepEqual(numbersFor(RECORDS, 'daily'), [7]);
  assert.deepEqual(numbersFor([], 'weekly'), []);
});

test('an abandoned claim releases its rows; a paid-but-unconfirmed one does not', async () => {
  const { releaseStaleReservations } = require('../lib/rewards/reservation.js');

  const doc = freshDoc();
  const rewards = fakeCollection(doc);
  await reserveRows(rewards, 'FEM-TEST', RECORDS, 'group-gone');
  rewards.findOne = async () => doc;

  // No envelope survives -> the mint never completed -> rows must come back.
  const noEnvelopes = { async findOne() { return null; } };
  const released = await releaseStaleReservations(rewards, noEnvelopes, 'FEM-TEST');
  assert.equal(released, 1);
  assert.equal(doc.weekly_rewards[0].status, CLAIMABLE);

  // Envelope still present -> a claim is in flight (possibly paid, awaiting confirm) -> hands off.
  const doc2 = freshDoc();
  const rewards2 = fakeCollection(doc2);
  await reserveRows(rewards2, 'FEM-TEST', RECORDS, 'group-live');
  rewards2.findOne = async () => doc2;
  const liveEnvelope = { async findOne() { return { groupId: 'group-live' }; } };
  assert.equal(await releaseStaleReservations(rewards2, liveEnvelope, 'FEM-TEST'), 0);
  assert.equal(doc2.weekly_rewards[0].status, CLAIMING, 'a live claim keeps its reservation');
});

test('a reserved row that already carries a tx_id is never released', async () => {
  const { releaseStaleReservations } = require('../lib/rewards/reservation.js');
  const doc = freshDoc();
  const rewards = fakeCollection(doc);
  await reserveRows(rewards, 'FEM-TEST', RECORDS, 'group-paid');
  doc.weekly_rewards[0].tx_id = 'ALREADYPAID';
  rewards.findOne = async () => doc;
  await releaseStaleReservations(rewards, { async findOne() { return null; } }, 'FEM-TEST');
  assert.equal(doc.weekly_rewards[0].status, CLAIMING, 'a paid row must stay reserved');
});
