// Unit tests for lib/rewards/settle.js (the shared settle helper used by /api/rewards/confirm and
// the custodial branch of /api/rewards/claim).

const test = require('node:test');
const assert = require('node:assert/strict');
const { ObjectId } = require('mongodb');
const { settleRows, planSettle, pinFor, elemMatches, effectiveAmount, micro } = require('../lib/rewards/settle');

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

test('validation: unknown source is BAD_RECORD; user-pays without a group is NO_GROUP; custodial misalignment is SELECTION_MISMATCH', () => {
  const doc = { weekly_rewards: [], daily_rewards: [] };
  assert.ok(planSettle(doc, { txId: 'T', groupId: 'G', records: [{ source: 'monthly', reward_number: 1, amount: 1 }] }).issues.has('BAD_RECORD'));
  assert.ok(planSettle(doc, { txId: 'T', records: [{ source: 'weekly', reward_number: 1, amount: 1 }] }).issues.has('NO_GROUP'));
  assert.ok(planSettle(doc, { txId: 'T', selected: [], records: [{ source: 'weekly', reward_number: 1, amount: 1 }] }).issues.has('SELECTION_MISMATCH'));
  assert.ok(planSettle(doc, { txId: 'T', selected: [{ reward_number: 1, amount: 2 }], records: [{ source: 'weekly', reward_number: 1, amount: 1 }] }).issues.has('SELECTION_MISMATCH'));
});

test('custodial: two identical rows without _id, only one selected -> PIN_NOT_UNIQUE, nothing written; both selected -> one write settles both', async () => {
  const twin = () => ({ reward_number: 4, status: 'claimable', amount: 3, week_start: '2026-01-01' });
  const doc1 = { _id: 1, weekly_rewards: [twin(), twin()], daily_rewards: [] };
  const c1 = coll(doc1);
  const one = await settleRows(c1, { minerKey: 'M', txId: 'T', claimedAt: new Date(), records: [{ source: 'weekly', reward_number: 4, amount: 3 }], selected: [doc1.weekly_rewards[0]] });
  assert.deepEqual([one.settled, c1.calls.length, one.issues.map((i) => i.code)[0]], [0, 0, 'PIN_NOT_UNIQUE']);
  const doc2 = { _id: 1, weekly_rewards: [twin(), twin()], daily_rewards: [] };
  const c2 = coll(doc2);
  const both = await settleRows(c2, { minerKey: 'M', txId: 'T', claimedAt: new Date(), records: [{ source: 'weekly', reward_number: 4, amount: 3 }, { source: 'weekly', reward_number: 4, amount: 3 }], selected: [doc2.weekly_rewards[0], doc2.weekly_rewards[1]] });
  assert.deepEqual([both.settled, c2.calls.length, both.clean], [2, 1, true]);
});
