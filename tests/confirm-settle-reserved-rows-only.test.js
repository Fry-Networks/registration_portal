// Regression: /api/rewards/confirm must settle ONLY the reward rows its own claim reserved.
//
// The user-pays confirm used to write status:'claimed' through
//   arrayFilters [{ 'elem.reward_number': { $in: nos }, 'elem.status': { $in: ['claimable','claiming'] } }]
// reward_number is not unique inside a device's reward arrays (weekly twins share a number across
// different weeks; daily rows repeat numbers across dates), so one paid claim also closed sibling
// rows it never reserved and never paid — rows still 'claimable', rows reserved by another live
// claim — and stamped the paid record's amount onto them as claimed_amount.
//
// The fixture reproduces the live shape: two weekly rows numbered 18 reserved by the same group
// while the envelope lists number 18 once, a still-claimable sibling, a row reserved by a second
// group, a Date-vs-string epoch pair, a daily collision, and rows whose statuses the settle must
// never touch ('paid_onchain_partial', an older 'claimed').
//
// The fake collection resolves arrayFilters the way the server does (all matching elements are
// identified before any $set is applied; Date by value, ObjectId by hex, null matches missing) so a
// predicate that is too wide shows up here exactly as it does against MongoDB.

const test = require('node:test');
const assert = require('node:assert/strict');

require('ts-node').register({
  transpileOnly: true,
  compilerOptions: { module: 'commonjs', moduleResolution: 'node', target: 'ES2017', jsx: 'react' },
});

const { ObjectId } = require('mongodb');

const stub = (relPath, exports) => {
  const resolved = require.resolve(relPath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
};

const realAlgosdk = require('algosdk');
const VAULT = realAlgosdk.generateAccount();
const USER = realAlgosdk.generateAccount();
const USER_ADDR = String(USER.addr);
const MINER = 'FEM-SETTLEFIXTURE0000000000000000000';
const MINER2 = 'FEM-SETTLEFIXTURE0000000000000000002';
const TFRY = '2681521901';

// ------------------------------------------------------------------ faithful fake Mongo
const isOid = (v) => !!v && typeof v === 'object' && (v._bsontype === 'ObjectId' || v._bsontype === 'ObjectID');
const eq = (a, b) => {
  if (a instanceof Date || b instanceof Date) return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
  if (isOid(a) || isOid(b)) return isOid(a) && isOid(b) && a.toHexString() === b.toHexString();
  return a === b;
};
const cond = (have, want) => {
  if (want === null) return have === null || have === undefined;
  if (want && typeof want === 'object' && !(want instanceof Date) && !isOid(want) && !Array.isArray(want)) {
    return Object.entries(want).every(([op, v]) => {
      if (op === '$in') return v.some((x) => (x === null ? have === null || have === undefined : eq(have, x)));
      if (op === '$exists') return (have !== undefined) === v;
      if (op === '$ne') return !(v === null ? have === null || have === undefined : eq(have, v));
      throw new Error(`fake mongo: unsupported operator ${op}`);
    });
  }
  return eq(have, want);
};
const clone = (v) => {
  if (v instanceof Date) return new Date(v.getTime());
  if (isOid(v)) return new ObjectId(v.toHexString());
  if (Array.isArray(v)) return v.map(clone);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clone(x)]));
  return v;
};
const docMatches = (doc, filter) => Object.entries(filter || {}).every(([k, w]) => cond(doc[k], w));
const elemMatchesFilter = (el, f, id) =>
  Object.entries(f).every(([k, w]) => { const field = k.slice(id.length + 1); return cond(el?.[field], w); });

const rewardsCollection = (store) => ({
  findOne: async (filter) => { const d = store.docs.find((x) => docMatches(x, filter)); return d ? clone(d) : null; },
  updateOne: async (filter, update, options = {}) => {
    const d = store.docs.find((x) => docMatches(x, filter));
    store.writes.push({ filter, update, options });
    if (!d) return { matchedCount: 0, modifiedCount: 0 };
    const af = options.arrayFilters || [];
    const ops = [];
    for (const [kind, spec] of [['$set', update.$set || {}], ['$unset', update.$unset || {}]]) {
      for (const [path, value] of Object.entries(spec)) {
        const m = path.match(/^([a-z_]+)\.\$\[([a-z]+)\]\.(.+)$/);
        if (!m) { ops.push({ kind, target: d, field: path, value }); continue; }
        const f = af.find((x) => Object.keys(x).some((k) => k.startsWith(m[2] + '.')));
        if (!f) throw new Error(`No array filter found for identifier '${m[2]}'`);
        // Resolve matching elements ONCE, before any write (server semantics).
        (ops.resolved = ops.resolved || new Map());
        const key = m[1] + '|' + m[2];
        if (!ops.resolved.has(key)) ops.resolved.set(key, (d[m[1]] || []).filter((el) => elemMatchesFilter(el, f, m[2])));
        for (const el of ops.resolved.get(key)) ops.push({ kind, target: el, field: m[3], value });
      }
    }
    let changed = false;
    for (const o of ops) {
      if (o.kind === '$set') { if (!eq(o.target[o.field], o.value)) changed = true; o.target[o.field] = o.value; }
      else if (o.field in o.target) { delete o.target[o.field]; changed = true; }
    }
    return { matchedCount: 1, modifiedCount: changed ? 1 : 0 };
  },
});

const state = { pending: [], deleted: [], loggedErrors: [] };
const store = { docs: [], writes: [] };
const pendingCollection = {
  findOne: async (filter) => state.pending.find((p) => docMatches(p, filter)) || null,
  deleteOne: async (filter) => {
    const i = state.pending.findIndex((p) => docMatches(p, filter));
    if (i >= 0) state.deleted.push(state.pending.splice(i, 1)[0]);
    return { deletedCount: i >= 0 ? 1 : 0 };
  },
  insertOne: async () => ({ insertedId: 'x' }),
};
const fakeCollection = (name) => {
  if (name === 'device-rewards') return rewardsCollection(store);
  if (name === 'reward_pending_claims') return pendingCollection;
  return { findOne: async () => null, updateOne: async () => ({ modifiedCount: 0 }), insertOne: async () => ({ insertedId: 'x' }), createIndex: async () => 'ok' };
};

// ------------------------------------------------------------------ stubs (as claim-confirm-writeback.test.js)
let currentGasTxId = '';
const algosdkStub = Object.create(realAlgosdk);
Object.defineProperty(algosdkStub, '__esModule', { value: true, enumerable: true });
Object.defineProperty(algosdkStub, 'waitForConfirmation', { value: async () => ({ confirmedRound: 65400000 }), enumerable: true, configurable: true });
Object.defineProperty(algosdkStub, 'default', { get: () => algosdkStub, enumerable: true });
stub('algosdk', algosdkStub);
stub('next-auth', { __esModule: true, getServerSession: async () => ({ user: { address: USER_ADDR } }) });
stub('../pages/api/auth/[...nextauth].ts', { __esModule: true, authOptions: {} });
stub('../lib/mongoclient', { __esModule: true, default: Promise.resolve({ db: () => ({ collection: fakeCollection }) }) });
stub('../lib/adminCheck', { __esModule: true, isAdminRequest: async () => true, isAdminWallet: async () => true, extractWalletFromRequest: () => USER_ADDR });
stub('../lib/clientTokenMiddleware', { __esModule: true, verifyClientToken: async () => true });
stub('../lib/requestSignature.server', { __esModule: true, verifyRequestSignatureAsync: async () => true });
stub('../lib/deviceFingerprint', { __esModule: true, verifyDeviceFingerprintMiddleware: async () => 'ok' });
stub('../lib/logger', { __esModule: true, loggers: { apiError: (endpoint, error, metadata) => { state.loggedErrors.push({ endpoint, error, metadata }); }, txnLog: () => {}, api: () => {}, security: () => {} } });
stub('../lib/discord-webhook', { __esModule: true, notifyDiscordError: async () => {} });
stub('../lib/utils', { __esModule: true, getTransactionTime: async () => new Date('2026-09-24T12:00:00Z') });
stub('../lib/algorand/admin', { __esModule: true, loadMnemonicAccountPair: () => ({ address: String(VAULT.addr), account: { addr: VAULT.addr } }) });
stub('../lib/wallet/clients', { __esModule: true, getAlgodClient: () => ({}), getIndexerClient: () => ({}) });
stub('../pages/api/algorand/verify-txn.ts', { __esModule: true, verifyTransaction: async () => 'ok' });
stub('../lib/algorand/verification', { __esModule: true, VERIFY_RESULT: { OK: 'ok', NOT_FOUND: 'not_found' } });
stub('../lib/db/requestLocks', { __esModule: true, confirmJournalEntryByGroupId: async () => true });
stub('../lib/algorand/failover', {
  __esModule: true,
  getFailoverAlgodClient: async () => ({ sendRawTransaction: () => ({ do: async () => ({ txid: currentGasTxId }) }) }),
});

const handler = require('../pages/api/rewards/confirm.ts').default;
const { releaseStaleReservations } = require('../lib/rewards/reservation');

// ------------------------------------------------------------------ fixtures
let nonce = 5000;
const buildGroup = () => {
  nonce += 1;
  const base = { fee: 0, flatFee: true, firstValid: nonce, lastValid: nonce + 100, genesisID: 'mainnet-v1.0', genesisHash: new Uint8Array(32), minFee: 1000 };
  const leg0 = realAlgosdk.makePaymentTxnWithSuggestedParamsFromObject({ sender: USER.addr, receiver: VAULT.addr, amount: 10000, suggestedParams: { ...base, fee: 3000 } });
  const leg1 = realAlgosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({ sender: VAULT.addr, receiver: USER.addr, assetIndex: Number(TFRY), amount: 1000000, suggestedParams: { ...base } });
  realAlgosdk.assignGroupID([leg0, leg1]);
  return {
    groupId: Buffer.from(leg0.group).toString('base64'),
    signedUserLegB64: Buffer.from(leg0.signTxn(USER.sk)).toString('base64'),
    signedServerLegsB64: [Buffer.from(leg1.signTxn(VAULT.sk)).toString('base64')],
    gasTxId: leg0.txID(),
  };
};

const oid = () => new ObjectId();
const W = (o) => ({ asset_id: TFRY, ...o });

const seedMain = (G, G2) => {
  const ids = { W1: oid(), W4: oid(), W5: oid(), W6: oid() };
  const doc = {
    _id: oid(),
    miner_key: MINER,
    weekly_rewards: [
      W({ _id: ids.W1, reward_number: 17, status: 'claiming', claiming_group: G, claiming_at: new Date('2026-09-24T11:59:00Z'), amount: 90, corrected_amount: 11.25, week_start: new Date('2025-12-25T00:00:00Z') }),       // W1 paid
      W({ reward_number: 18, status: 'claiming', claiming_group: G, claiming_at: new Date('2026-09-24T11:59:00Z'), amount: 100, corrected_amount: 12.5, week_start: new Date('2026-01-08T00:00:00Z') }),                  // W2 paid (no _id)
      W({ reward_number: 18, status: 'claiming', claiming_group: G, claiming_at: new Date('2026-09-24T11:59:00Z'), amount: 200, corrected_amount: 25.75, week_start: new Date('2026-03-19T00:00:00Z') }),                     // W3 reserved twin, NOT in records
      W({ _id: ids.W4, reward_number: 31, status: 'claimable', amount: 50, week_start: '2025-07-31' }),                                                                                                                   // W4 claimable sibling
      W({ _id: ids.W5, reward_number: 31, status: 'claiming', claiming_group: G, claiming_at: new Date('2026-09-24T11:59:00Z'), amount: 6.4, week_start: new Date('2026-07-30T00:00:00Z') }),                              // W5 paid
      W({ _id: ids.W6, reward_number: 18, status: 'paid_onchain_partial', claiming_group: G, tx_id: 'R12BGASFIXTURE', r12b_run: 'r12b-fixture', r12b_paid_amount: 9.5, r12b_fee_leg_amount: 1.25, amount: 12.5, week_start: new Date('2026-05-15T00:00:00Z') }), // W6 partial-payment shape
      W({ reward_number: 17, status: 'claimed', tx_id: 'OLDTX', claimed_amount: 7.7, claiming_group: 'OLDG', amount: 7.7, week_start: new Date('2025-06-05T00:00:00Z') }),                                               // W7 older claimed
      W({ reward_number: 31, status: 'claiming', claiming_group: G2, claiming_at: new Date('2026-09-24T11:58:00Z'), amount: 70, week_start: new Date('2026-08-27T00:00:00Z') }),                                          // W8 other live group
      W({ reward_number: 40, status: 'claiming', claiming_group: G, claiming_at: new Date('2026-09-24T11:59:00Z'), amount: 10, week_start: '2026-02-05' }),                                                               // W9 paid (string epoch)
      W({ reward_number: 40, status: 'claiming', claiming_group: G, claiming_at: new Date('2026-09-24T11:59:00Z'), amount: 20, week_start: new Date('2026-02-05T00:00:00Z') }),                                          // W10 reserved, Date epoch, NOT in records
    ],
    daily_rewards: [
      W({ reward_number: 5, status: 'claiming', claiming_group: G, claiming_at: new Date('2026-09-24T11:59:00Z'), amount: 3.21, date: '2026-08-01' }), // D1 paid
      W({ reward_number: 5, status: 'claimable', amount: 2.5, date: '2026-07-02' }),                                                                     // D2 claimable sibling
      W({ reward_number: 5, status: 'claimed', tx_id: 'OLDTX2', claimed_amount: 1.1, amount: 1.1, date: '2026-06-01' }),                                  // D3 older claimed
    ],
  };
  store.docs.push(doc);
  return doc;
};
const RECORDS = [
  { source: 'weekly', reward_number: 17, asset_id: TFRY, amount: 11.25 },
  { source: 'weekly', reward_number: 18, asset_id: TFRY, amount: 12.5 },
  { source: 'weekly', reward_number: 31, asset_id: TFRY, amount: 6.4 },
  { source: 'weekly', reward_number: 40, asset_id: TFRY, amount: 10 },
  { source: 'daily', reward_number: 5, asset_id: TFRY, amount: 3.21 },
];
const seedPending = (group, minerKey, records) => {
  state.pending.push({ groupId: group.groupId, miner_key: minerKey, claimingAddress: USER_ADDR, signedServerLegsB64: group.signedServerLegsB64, status: 'pending', ...(records ? { records } : {}) });
};
const reset = () => { state.pending.length = 0; state.deleted.length = 0; state.loggedErrors.length = 0; store.docs.length = 0; store.writes.length = 0; };
const runConfirm = async (group) => {
  currentGasTxId = group.gasTxId;
  const captured = { status: null, body: null };
  const res = { status(code) { captured.status = code; return this; }, json(p) { captured.body = p; return this; } };
  await handler({ method: 'POST', url: '/api/rewards/confirm', headers: {}, socket: {}, body: { groupId: group.groupId, signedUserLegB64: group.signedUserLegB64 } }, res);
  return captured;
};
const liveDoc = (minerKey = MINER) => store.docs.find((d) => d.miner_key === minerKey);
const settleIssues = () => state.loggedErrors.filter((e) => String(e.metadata?.issueType || '').startsWith('REWARD_CONFIRM_SETTLE_')).map((e) => e.metadata.issueType);

// ------------------------------------------------------------------ tests

test('fixture sanity: colliding reward_numbers, a claimable sibling and a Date/string epoch pair exist', () => {
  reset();
  const doc = seedMain('G-sanity', 'G2-sanity');
  const w = doc.weekly_rewards;
  assert.equal(w.filter((e) => e.reward_number === 18).length, 3, 'three weekly rows numbered 18');
  assert.ok(w.some((e) => e.reward_number === 31 && e.status === 'claimable'), 'a claimable sibling numbered 31');
  assert.ok(w.some((e) => e.reward_number === 40 && typeof e.week_start === 'string') && w.some((e) => e.reward_number === 40 && e.week_start instanceof Date), 'string and Date epochs for number 40');
  assert.ok(doc.daily_rewards.filter((e) => e.reward_number === 5).length === 3, 'daily number 5 collides');
});

test('confirm settles exactly the reserved-and-paid elements and nothing else', async () => {
  reset();
  const group = buildGroup(); const G = group.groupId; const G2 = buildGroup().groupId;
  const before = clone(seedMain(G, G2));
  seedPending(group, MINER, RECORDS);
  state.pending.push({ groupId: G2, miner_key: MINER, claimingAddress: USER_ADDR, signedServerLegsB64: [], status: 'pending', records: [{ source: 'weekly', reward_number: 31, amount: 70 }] });

  const out = await runConfirm(group);
  assert.equal(out.status, 200, JSON.stringify(out.body));
  assert.equal(out.body.success, true);

  const d = liveDoc(); const tx = group.gasTxId;
  const paid = [[0, 11.25], [1, 12.5], [4, 6.4], [8, 10]];
  for (const [i, amt] of paid) {
    const e = d.weekly_rewards[i];
    assert.equal(e.status, 'claimed', `weekly[${i}] status`);
    assert.equal(e.tx_id, tx, `weekly[${i}] tx_id`);
    assert.equal(e.claimed_amount, amt, `weekly[${i}] claimed_amount`);
    assert.ok(e.claimed_at instanceof Date, `weekly[${i}] claimed_at`);
  }
  assert.equal(d.daily_rewards[0].status, 'claimed', 'daily[0] (paid) claimed');
  assert.equal(d.daily_rewards[0].claimed_amount, 3.21);
  const untouched = { weekly: [2, 3, 5, 6, 7, 9], daily: [1, 2] };
  for (const i of untouched.weekly) assert.deepStrictEqual(d.weekly_rewards[i], before.weekly_rewards[i], `weekly[${i}] must be untouched`);
  for (const i of untouched.daily) assert.deepStrictEqual(d.daily_rewards[i], before.daily_rewards[i], `daily[${i}] must be untouched`);
});

test("rows in 'paid_onchain_partial' (even carrying the group) and prior 'claimed' rows are never rewritten", async () => {
  reset();
  const group = buildGroup(); const G = group.groupId;
  const before = clone(seedMain(G, 'G2-none'));
  seedPending(group, MINER, RECORDS);
  await runConfirm(group);
  const d = liveDoc();
  assert.deepStrictEqual(d.weekly_rewards[5], before.weekly_rewards[5], 'paid_onchain_partial row untouched');
  assert.deepStrictEqual(d.weekly_rewards[6], before.weekly_rewards[6], 'older claimed row untouched');
  assert.deepStrictEqual(d.daily_rewards[2], before.daily_rewards[2], 'older claimed daily row untouched');
});

test('a clean settle deletes the envelope; the unpaid reserved twin is reported, not settled', async () => {
  reset();
  const group = buildGroup(); const G = group.groupId;
  seedMain(G, 'G2-none');
  seedPending(group, MINER, RECORDS);
  const out = await runConfirm(group);
  assert.equal(out.status, 200);
  assert.deepEqual(out.body && Object.keys(out.body).sort(), ['claimedAt', 'ok', 'success', 'txId']);
  assert.equal(state.pending.find((p) => p.groupId === G), undefined, 'envelope deleted');
  assert.deepEqual(settleIssues(), ['REWARD_CONFIRM_SETTLE_EXTRA_RESERVED']);
  const extra = state.loggedErrors.find((e) => e.metadata?.issueType === 'REWARD_CONFIRM_SETTLE_EXTRA_RESERVED');
  assert.deepEqual(extra.metadata.metadata.items.map((i) => [i.reward_number, i.amount]).sort(), [[18, 25.75], [40, 20]]);
});

test('end to end: after confirm, releaseStaleReservations returns the unpaid reserved twins to claimable', async () => {
  reset();
  const group = buildGroup(); const G = group.groupId; const G2 = buildGroup().groupId;
  const before = clone(seedMain(G, G2));
  seedPending(group, MINER, RECORDS);
  state.pending.push({ groupId: G2, miner_key: MINER, claimingAddress: USER_ADDR, signedServerLegsB64: [], status: 'pending', records: [] });
  await runConfirm(group);
  await releaseStaleReservations(rewardsCollection(store), pendingCollection, MINER);
  const d = liveDoc();
  for (const i of [2, 9]) {
    assert.equal(d.weekly_rewards[i].status, 'claimable', `weekly[${i}] released`);
    assert.equal(d.weekly_rewards[i].claiming_group, undefined, `weekly[${i}] group cleared`);
    assert.equal(d.weekly_rewards[i].tx_id, undefined, `weekly[${i}] carries no tx_id`);
  }
  assert.deepStrictEqual(d.weekly_rewards[7], before.weekly_rewards[7], 'row reserved by the other live envelope untouched');
  assert.equal(d.weekly_rewards[1].status, 'claimed', 'paid row stays claimed');
});

test('ambiguous twins (same number, same amount, both reserved, listed once) settle nothing and keep the envelope', async () => {
  reset();
  const group = buildGroup(); const G3 = group.groupId;
  const doc = { _id: oid(), miner_key: MINER2, weekly_rewards: [
    W({ reward_number: 22, status: 'claiming', claiming_group: G3, amount: 50, week_start: new Date('2026-04-02T00:00:00Z') }),
    W({ reward_number: 22, status: 'claiming', claiming_group: G3, amount: 50, week_start: new Date('2026-06-04T00:00:00Z') }),
  ], daily_rewards: [] };
  store.docs.push(doc); const before = clone(doc);
  seedPending(group, MINER2, [{ source: 'weekly', reward_number: 22, asset_id: TFRY, amount: 50 }]);
  const out = await runConfirm(group);
  assert.equal(out.status, 200, 'the payment is on chain; confirm still answers 200');
  assert.deepStrictEqual(liveDoc(MINER2), before, 'neither twin is written');
  assert.ok(state.pending.find((p) => p.groupId === G3), 'envelope retained for review');
  assert.deepEqual(settleIssues().sort(), ['REWARD_CONFIRM_SETTLE_AMBIGUOUS', 'REWARD_CONFIRM_SETTLE_ENVELOPE_RETAINED']);
});

test('a reserved row whose amount differs from the paid record is not settled; envelope kept', async () => {
  reset();
  const group = buildGroup(); const G4 = group.groupId;
  const doc = { _id: oid(), miner_key: MINER2, weekly_rewards: [
    W({ reward_number: 23, status: 'claiming', claiming_group: G4, amount: 40, week_start: new Date('2026-04-09T00:00:00Z') }),
  ], daily_rewards: [] };
  store.docs.push(doc); const before = clone(doc);
  seedPending(group, MINER2, [{ source: 'weekly', reward_number: 23, asset_id: TFRY, amount: 41 }]);
  await runConfirm(group);
  assert.deepStrictEqual(liveDoc(MINER2), before);
  assert.ok(state.pending.find((p) => p.groupId === G4), 'envelope retained');
  assert.ok(settleIssues().includes('REWARD_CONFIRM_SETTLE_AMOUNT_MISMATCH'));
});

test('an envelope with no records is never deleted and writes nothing', async () => {
  reset();
  const group = buildGroup(); const G5 = group.groupId;
  const before = clone(seedMain(G5, 'G2-none'));
  seedPending(group, MINER, null);
  await runConfirm(group);
  assert.deepStrictEqual(liveDoc(), before);
  assert.ok(state.pending.find((p) => p.groupId === G5), 'envelope retained');
  assert.ok(settleIssues().includes('REWARD_CONFIRM_SETTLE_NO_RECORDS'));
});

test('idempotent: a repeat confirm of the same paid group changes nothing', async () => {
  reset();
  const group = buildGroup(); const G = group.groupId;
  seedMain(G, 'G2-none');
  seedPending(group, MINER, RECORDS);
  await runConfirm(group);
  const after1 = clone(liveDoc());
  seedPending(group, MINER, RECORDS); // crash between settle and delete: envelope still present
  store.writes.length = 0;
  const out = await runConfirm(group);
  assert.equal(out.status, 200);
  assert.deepStrictEqual(liveDoc(), after1, 'second confirm is a no-op');
  assert.equal(store.writes.length, 0, 'no device-rewards write on the repeat');
  assert.equal(state.pending.find((p) => p.groupId === G), undefined, 'envelope deleted once fully settled');
});
