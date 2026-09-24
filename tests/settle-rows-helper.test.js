// Unit tests for lib/rewards/settle.js (the shared settle helper used by /api/rewards/confirm and
// the custodial branch of /api/rewards/claim).

const test = require('node:test');
const assert = require('node:assert/strict');
const { ObjectId } = require('mongodb');
const { settleRows, planSettle, pinFor, positionalGuard, sameElement, elemMatches, effectiveAmount, micro } = require('../lib/rewards/settle');

require('ts-node').register({ transpileOnly: true, compilerOptions: { module: 'commonjs', moduleResolution: 'node', target: 'ES2017', jsx: 'react' } });

const coll = (doc, over = {}) => {
  const calls = [];
  return {
    calls,
    findOne: over.findOne || (async () => doc),
    updateOne: over.updateOne || (async (f, u, o) => { calls.push({ f, u, o }); return { modifiedCount: 1 }; }),
  };
};

test('pinFor pins _id and the stored epoch exactly (Date stays Date, string stays string, missing -> $exists:false)', () => {
  const id = new ObjectId(); const d = new Date('2026-02-05T00:00:00Z');
  assert.deepEqual(pinFor({ _id: id, reward_number: 7, week_start: d }, 'weekly', 'claiming', 'G'),
    { 'elem.reward_number': 7, 'elem.status': 'claiming', 'elem.claiming_group': 'G', 'elem._id': id, 'elem.week_start': d });
  assert.deepEqual(pinFor({ reward_number: 7, date: '2026-02-05' }, 'daily', 'claimable', null),
    { 'elem.reward_number': 7, 'elem.status': 'claimable', 'elem._id': { $exists: false }, 'elem.date': '2026-02-05' });
  assert.deepEqual(pinFor({ reward_number: 7 }, 'weekly', 'claimable', null)['elem.week_start'], { $exists: false });
});

test('elemMatches: a Date pin never matches a string epoch and vice versa; ObjectId by value; null matches missing', () => {
  const d = new Date('2026-02-05T00:00:00Z');
  assert.equal(elemMatches({ reward_number: 1, status: 's', week_start: '2026-02-05' }, { 'elem.reward_number': 1, 'elem.status': 's', 'elem.week_start': d }), false);
  assert.equal(elemMatches({ reward_number: 1, status: 's', week_start: new Date(d) }, { 'elem.reward_number': 1, 'elem.status': 's', 'elem.week_start': d }), true);
  const id = new ObjectId();
  assert.equal(elemMatches({ _id: new ObjectId(id.toHexString()) }, { 'elem._id': id }), true);
  assert.equal(elemMatches({}, { 'elem.x': null }), true);
  assert.throws(() => elemMatches({ a: 1 }, { 'elem.a': { $gt: 0 } }), /unsupported operator/);
});

test('effectiveAmount mirrors lib/rewards/effective.ts', () => {
  const real = require('../lib/rewards/effective.ts');
  for (const row of [{ amount: 5 }, { amount: 5, corrected_amount: 0.55 }, { amount: '7.5' }, {}, { corrected_amount: 0 }]) {
    assert.equal(effectiveAmount(row), real.effectiveAmount(row), JSON.stringify(row));
  }
});

test('micro compares at 6 decimals: twins 0.004 apart are distinct', () => {
  assert.notEqual(micro(42.354), micro(42.35));
  assert.equal(micro(0.1 + 0.2), micro(0.3));
});

test('user-pays: a repeat settle is idempotent (alreadySettled, no writes, clean)', async () => {
  const doc = { _id: 1, weekly_rewards: [{ reward_number: 3, status: 'claimed', claiming_group: 'G', tx_id: 'T', claimed_amount: 9.5, amount: 9.5 }], daily_rewards: [] };
  const c = coll(doc);
  const out = await settleRows(c, { minerKey: 'M', groupId: 'G', txId: 'T', claimedAt: new Date(), records: [{ source: 'weekly', reward_number: 3, amount: 9.5 }] });
  assert.deepEqual([out.settled, out.alreadySettled, out.clean, c.calls.length], [0, 1, true, 0]);
});

test('a write that matches nothing (row changed under us) is RACE and not clean', async () => {
  const doc = { _id: 1, weekly_rewards: [{ reward_number: 3, status: 'claiming', claiming_group: 'G', amount: 9.5 }], daily_rewards: [] };
  const out = await settleRows(coll(doc, { updateOne: async () => ({ modifiedCount: 0 }) }), { minerKey: 'M', groupId: 'G', txId: 'T', claimedAt: new Date(), records: [{ source: 'weekly', reward_number: 3, amount: 9.5 }] });
  assert.equal(out.clean, false); assert.deepEqual(out.issues.map((i) => i.code), ['RACE']);
});

test('never throws: findOne rejects -> FAILED; second write rejects -> first still settled, WRITE_FAILED', async () => {
  const a = await settleRows(coll(null, { findOne: async () => { throw new Error('db down'); } }), { minerKey: 'M', groupId: 'G', txId: 'T', claimedAt: new Date(), records: [{ source: 'weekly', reward_number: 1, amount: 1 }] });
  assert.deepEqual(a.issues.map((i) => i.code), ['FAILED']); assert.equal(a.clean, false);
  let n = 0;
  const doc = { _id: 1, weekly_rewards: [{ reward_number: 1, status: 'claiming', claiming_group: 'G', amount: 1 }, { reward_number: 2, status: 'claiming', claiming_group: 'G', amount: 2 }], daily_rewards: [] };
  const b = await settleRows(coll(doc, { updateOne: async () => { n += 1; if (n === 2) throw new Error('boom'); return { modifiedCount: 1 }; } }),
    { minerKey: 'M', groupId: 'G', txId: 'T', claimedAt: new Date(), records: [{ source: 'weekly', reward_number: 1, amount: 1 }, { source: 'weekly', reward_number: 2, amount: 2 }] });
  assert.equal(b.settled, 1); assert.deepEqual(b.issues.map((i) => i.code), ['WRITE_FAILED']); assert.equal(b.clean, false);
});

test('validation is per record: a bad record is reported and skipped, valid records still settle (both modes)', async () => {
  const doc = { _id: 1, weekly_rewards: [{ reward_number: 1, status: 'claiming', claiming_group: 'G', amount: 1 }], daily_rewards: [] };
  const up = await settleRows(coll(doc), { minerKey: 'M', groupId: 'G', txId: 'T', claimedAt: new Date(), records: [{ source: 'monthly', reward_number: 9, amount: 9 }, { source: 'weekly', reward_number: 1, amount: 1 }] });
  assert.deepEqual([up.settled, up.issues.map((i) => i.code), up.clean], [1, ['BAD_RECORD'], false]);
  assert.ok(planSettle({ weekly_rewards: [], daily_rewards: [] }, { txId: 'T', records: [{ source: 'weekly', reward_number: 1, amount: 1 }] }).issues.has('NO_GROUP'));
  const row = { reward_number: '7', status: 'claimable', amount: 2 };
  const cdoc = { _id: 1, weekly_rewards: [row, { reward_number: 8, status: 'claimable', amount: 3 }], daily_rewards: [] };
  const cu = await settleRows(coll(cdoc), { minerKey: 'M', txId: 'T', claimedAt: new Date(),
    records: [{ source: 'weekly', reward_number: 8, amount: 4 }, { source: 'weekly', reward_number: '7', amount: 2 }], selected: [cdoc.weekly_rewards[1], row] });
  assert.deepEqual([cu.settled, cu.issues.map((i) => i.code)], [1, ['SELECTION_MISMATCH']], 'misaligned record skipped, string-numbered row still settled');
});

test('positionalGuard addresses exactly arr.<index> with the stored identity (values as read)', () => {
  const d = new Date('2026-01-08T00:00:00Z');
  assert.deepEqual(positionalGuard({ reward_number: 4, week_start: d }, 'weekly', 5, 'claimable', null),
    { 'weekly_rewards.5.reward_number': 4, 'weekly_rewards.5.status': 'claimable', 'weekly_rewards.5._id': { $exists: false }, 'weekly_rewards.5.week_start': d });
  assert.deepEqual(Object.keys(positionalGuard({ _id: new ObjectId(), reward_number: 4, date: '2026-01-08' }, 'daily', 0, 'claiming', 'G')).sort(),
    ['daily_rewards.0._id', 'daily_rewards.0.claiming_group', 'daily_rewards.0.date', 'daily_rewards.0.reward_number', 'daily_rewards.0.status']);
});

test('sameElement: every field must match (a held twin differs), BSON-aware', () => {
  const d = new Date('2026-01-08T00:00:00Z');
  assert.equal(sameElement({ rn: 1, ws: d, n: { a: [1, 2] } }, { rn: 1, ws: new Date(d), n: { a: [1, 2] } }), true);
  assert.equal(sameElement({ rn: 1, ws: d }, { rn: 1, ws: d, payout_hold: true }), false);
  assert.equal(sameElement({ rn: 1, ws: d }, { rn: 1, ws: '2026-01-08T00:00:00.000Z' }), false);
});

test('custodial: identical twins — one selected settles exactly one element positionally; both selected settle both', async () => {
  const twin = () => ({ reward_number: 4, status: 'claimable', amount: 3, week_start: '2026-01-01' });
  const doc1 = { _id: 1, weekly_rewards: [twin(), twin()], daily_rewards: [] };
  const c1 = coll(doc1);
  const one = await settleRows(c1, { minerKey: 'M', txId: 'T', claimedAt: new Date(), records: [{ source: 'weekly', reward_number: 4, amount: 3 }], selected: [doc1.weekly_rewards[0]] });
  assert.deepEqual([one.settled, one.clean, c1.calls.length], [1, true, 1]);
  assert.ok(Object.keys(c1.calls[0].u.$set).every((k) => k.startsWith('weekly_rewards.0.')), 'positional write to index 0');
  assert.equal(c1.calls[0].f['weekly_rewards.0.status'], 'claimable');
  const doc2 = { _id: 1, weekly_rewards: [twin(), twin()], daily_rewards: [] };
  const c2 = coll(doc2);
  const both = await settleRows(c2, { minerKey: 'M', txId: 'T', claimedAt: new Date(), records: [{ source: 'weekly', reward_number: 4, amount: 3 }, { source: 'weekly', reward_number: 4, amount: 3 }], selected: [doc2.weekly_rewards[0], doc2.weekly_rewards[1]] });
  assert.deepEqual([both.settled, both.clean, c2.calls.length], [2, true, 2]);
});
