// Regression: the custodial branch of /api/rewards/claim must settle ONLY the rows the claim
// selected and paid.
//
// It used the same settle predicate as the user-pays confirm — reward_number $in + status
// 'claimable'|'claiming', no epoch, no identity — so paying one row also closed every sibling with
// the same number: rows under review (payout_hold), rows another live claim had reserved, rows the
// PoC evidence gate had just dropped, and it copied the last record's amount onto every twin as
// claimed_amount. The custodial branch reserves nothing, so the fix settles by the exact element
// identities the claim selected.
//
// Same stub pattern as claim-matured-no-instant-fee.test.js, but with a fake collection that
// resolves arrayFilters the way MongoDB does and the REAL lib/rewards/reservation (not stubbed).

const test = require('node:test');
const assert = require('node:assert/strict');

require('ts-node').register({
  transpileOnly: true,
  compilerOptions: { module: 'commonjs', moduleResolution: 'node', target: 'ES2017', jsx: 'react' },
});

const { ObjectId } = require('mongodb');

const ADDR = 'SYNTHWALLETCUSTODIALAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const MINER = 'FEM-CUSTODIALSETTLE00000000000000000';
const TFRY = '2681521901';
const SINK = 'U5TA6XANQ7G3XTKTBP5VEUXHSHZO2GWMZN75OU3BIHTQ5D7LDXZA7ATXSI';
const VAULT = 'HXWYLLZDPTM5OXS3DPARMTG52RSBMMCQNKT4L2LZRRXYPNAWJBT6VIW6WU';

const stub = (relPath, exports) => {
  const resolved = require.resolve(relPath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
};

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
const pathGet = (doc, k) => k.split('.').reduce((acc, seg) => (acc === null || acc === undefined ? undefined : Array.isArray(acc) && /^\d+$/.test(seg) ? acc[Number(seg)] : acc[seg]), doc);
const docMatches = (doc, filter) => Object.entries(filter || {}).every(([k, w]) => cond(k.includes('.') ? pathGet(doc, k) : doc[k], w));
const elemMatchesFilter = (el, f, id) => Object.entries(f).every(([k, w]) => cond(el?.[k.slice(id.length + 1)], w));
const store = { docs: [], pending: [], writes: [] };
const rewardsCollection = {
  findOne: async (filter, opts) => { const d = store.docs.find((x) => docMatches(x, filter)); if (d && opts && opts.projection && state.mutateOnSettleRead) { state.mutateOnSettleRead(d); state.mutateOnSettleRead = null; } return d ? clone(d) : null; },
  updateOne: async (filter, update, options = {}) => {
    if (state.failSettleWrites && JSON.stringify(update.$set || {}).includes('"claimed"')) throw new Error('simulated write failure');
    const d = store.docs.find((x) => docMatches(x, filter));
    store.writes.push({ filter, update, options });
    if (!d) return { matchedCount: 0, modifiedCount: 0 };
    const af = options.arrayFilters || []; const resolved = new Map(); const ops = [];
    for (const [kind, spec] of [['$set', update.$set || {}], ['$unset', update.$unset || {}], ['$inc', update.$inc || {}]]) {
      for (const [path, value] of Object.entries(spec)) {
        const pm = path.match(/^([a-z_]+)\.(\d+)\.(.+)$/);
        if (pm) { const el = (d[pm[1]] || [])[Number(pm[2])]; if (!el) throw new Error(`fake mongo: no element at ${path}`); ops.push({ kind, target: el, field: pm[3], value }); continue; }
        const m = path.match(/^([a-z_]+)\.\$\[([a-z]+)\]\.(.+)$/);
        if (!m) { ops.push({ kind, target: d, field: path, value }); continue; }
        const f = af.find((x) => Object.keys(x).some((k) => k.startsWith(m[2] + '.')));
        if (!f) throw new Error(`No array filter found for identifier '${m[2]}'`);
        const key = m[1] + '|' + m[2];
        if (!resolved.has(key)) resolved.set(key, (d[m[1]] || []).filter((el) => elemMatchesFilter(el, f, m[2])));
        for (const el of resolved.get(key)) ops.push({ kind, target: el, field: m[3], value });
      }
    }
    let changed = false;
    for (const o of ops) {
      if (o.kind === '$set') { if (!eq(o.target[o.field], o.value)) changed = true; o.target[o.field] = o.value; }
      else if (o.kind === '$inc') { o.target[o.field] = (o.target[o.field] || 0) + o.value; changed = true; }
      else if (o.field in o.target) { delete o.target[o.field]; changed = true; }
    }
    return { matchedCount: 1, modifiedCount: changed ? 1 : 0 };
  },
};
const pendingCollection = {
  findOne: async (filter) => store.pending.find((p) => docMatches(p, filter)) || null,
  insertOne: async () => ({ insertedId: 'x' }), deleteOne: async () => ({ deletedCount: 0 }),
};
const state = { transfers: [], loggedErrors: [], noEvidence: new Set(), failSettleWrites: false, mutateOnSettleRead: null };
const fakeCollection = (name) => {
  if (name === 'devices') return { findOne: async () => ({ miner_key: MINER, address: ADDR, reward_wallet: ADDR }) };
  if (name === 'device-rewards') return rewardsCollection;
  if (name === 'reward_pending_claims') return pendingCollection;
  if (name === 'fry_fee_genesis') return { findOne: async () => ({ _id: 'config', fee_enabled: true, fee_bps: 3000, holder_share_num: 1, holder_share_den: 3, fee_note_prefix: 'ffg-fee:', fee_sink_addresses: [SINK], fee_source: 'instant_claim' }) };
  return { findOne: async () => null, updateOne: async () => ({ modifiedCount: 1 }), insertOne: async () => ({ insertedId: 'x' }) };
};

// ------------------------------------------------------------------ stubs (as claim-matured-no-instant-fee.test.js)
stub('next-auth', { __esModule: true, getServerSession: async () => ({ user: { address: ADDR } }) });
stub('../pages/api/auth/[...nextauth].ts', { __esModule: true, authOptions: {} });
stub('../lib/mongoclient', { __esModule: true, default: Promise.resolve({ db: () => ({ collection: fakeCollection }) }) });
stub('../lib/adminCheck', { __esModule: true, isAdminRequest: async () => true, isAdminWallet: async () => true, extractWalletFromRequest: () => ADDR });
stub('../lib/clientTokenMiddleware', { __esModule: true, verifyClientToken: async () => true });
stub('../lib/requestSignature.server', { __esModule: true, verifyRequestSignatureAsync: async () => true });
stub('../lib/deviceFingerprint', { __esModule: true, verifyDeviceFingerprintMiddleware: async () => 'ok' });
stub('../lib/logger', { __esModule: true, loggers: { apiError: (endpoint, error, metadata) => state.loggedErrors.push({ endpoint, error, metadata }) } });
stub('../lib/rewardsVault.server', { __esModule: true, getRewardsVaultAddress: () => VAULT });
stub('../lib/utils', { __esModule: true, getAssetDecimals: async () => 6, fNODE: { id: '2485202024', decimals: 6 }, tFRY: { id: TFRY, decimals: 6 } });
stub('../lib/rewards/pocEvidence', {
  __esModule: true,
  loadEvidence: async () => ({ dates: new Set(), leases: [] }),
  hasEvidenceInWindow: (_ev, start) => !state.noEvidence.has(new Date(start).toISOString()),
});
stub('../lib/monitoring/walletHealth', { __esModule: true, monitorWalletHealth: async () => {} });
stub('../lib/monitoring/transactionMonitor', { __esModule: true, monitorTransaction: async () => {} });
stub('../lib/algorand/optIn', { __esModule: true, ensureWalletAssetOptIn: async () => {} });
stub('../lib/algorand/withRetry', { __esModule: true, withRetry: async (fn) => fn() });
stub('../lib/wallet/clients', { __esModule: true, getAlgodClient: () => ({ accountAssetInformation: () => ({ do: async () => ({ 'asset-holding': { amount: 10_000_000_000 } }) }) }), getIndexerClient: () => ({}) });
stub('../lib/algorand/failover', {
  __esModule: true,
  AlgodUnavailableError: class AlgodUnavailableError extends Error {},
  getFailoverAccountInfo: async () => ({}),
  getFailoverAssetBalance: async () => 0,
  getFailoverAlgodClient: async () => ({ accountAssetInformation: () => ({ do: async () => ({ 'asset-holding': { amount: 10_000_000_000 } }) }) }),
});
stub('../lib/wallet/transactions', { __esModule: true, buildAssetTransferTxn: async (args) => { state.transfers.push(args); return `txn:${args.receiver}:${args.amount}`; } });
stub('../lib/algorand/admin', {
  __esModule: true,
  decodeUnsignedTransaction: (t) => t,
  loadMnemonicAccountPair: () => ({ account: { addr: { toString: () => VAULT } } }),
  signAndSubmitCustodialTransactions: async () => ({ txId: 'CUSTODIALTX' }),
  buildUserPaysClaimGroup: async () => { throw new Error('user-pays must not run in this test'); },
});
stub('../lib/api/deviceAction', { __esModule: true, withDeviceActionLock: async (_req, _res, _meta, run) => run() });

const handler = require('../pages/api/rewards/claim.ts').default;

const runClaim = async (body) => {
  state.transfers = [];
  process.env.REWARD_USER_PAYS_GAS = 'false';
  const captured = { status: null, body: null };
  const res = { status(c) { captured.status = c; return this; }, json(p) { captured.body = p; return this; } };
  let thrown = null;
  try { await handler({ method: 'POST', headers: {}, body: { miner_key: MINER, ...body } }, res); } catch (e) { thrown = e; }
  return { ...captured, thrown };
};
const reset = () => { store.docs.length = 0; store.pending.length = 0; store.writes.length = 0; state.loggedErrors.length = 0; state.noEvidence = new Set(); state.failSettleWrites = false; state.mutateOnSettleRead = null; };
const W = (o) => ({ asset_id: TFRY, unlock_at: new Date('2026-06-01T00:00:00Z'), ...o });
const live = () => store.docs[0];

test('C1 fixture sanity: five siblings share reward_number 18 with the one row the claim selects', () => {
  reset();
  const doc = seedC1();
  assert.equal(doc.weekly_rewards.filter((e) => e.reward_number === 18).length, 6);
  assert.equal(doc.weekly_rewards.filter((e) => e.reward_number === 18 && e.status === 'claimable' && e.corrected_by && !e.payout_hold).length, 1);
});

function seedC1() {
  const doc = {
    _id: new ObjectId(), miner_key: MINER, total_claimable: 1000, total_claimed: 0,
    weekly_rewards: [
      W({ _id: new ObjectId(), reward_number: 18, status: 'claimable', amount: 100, corrected_amount: 12.5, corrected_by: 'fem_final_f3y', week_start: new Date('2026-01-08T00:00:00Z'), week_end: new Date('2026-01-14T23:59:59Z') }), // S1 selected
      W({ _id: new ObjectId(), reward_number: 18, status: 'claimable', amount: 25.75, corrected_by: 'fem_final_f3y', payout_hold: true, week_start: new Date('2026-03-19T00:00:00Z'), week_end: new Date('2026-03-25T23:59:59Z') }), // S2 held
      W({ reward_number: 18, status: 'claiming', claiming_group: 'G9', claiming_at: new Date('2026-09-24T11:00:00Z'), amount: 90, corrected_by: 'fem_final_f3y', week_start: new Date('2026-02-06T00:00:00Z'), week_end: new Date('2026-02-12T23:59:59Z') }), // S3 other live claim
      W({ reward_number: 18, status: 'paid_onchain_partial', claiming_group: 'G1', tx_id: 'R12BGAS', r12b_run: 'r12b-fixture', amount: 100, week_start: new Date('2026-02-13T00:00:00Z'), week_end: new Date('2026-02-19T23:59:59Z') }), // S4 partial-payment shape
      W({ reward_number: 18, status: 'claimed', tx_id: 'OLDTX', claimed_amount: 55, amount: 55, week_start: new Date('2025-06-05T00:00:00Z'), week_end: new Date('2025-06-11T23:59:59Z') }), // S5 older claimed
      W({ reward_number: 18, status: 'claimable', amount: 77, week_start: new Date('2026-05-07T00:00:00Z'), week_end: new Date('2026-05-13T23:59:59Z') }), // S6 no corrected_by, no PoC evidence -> dropped
    ],
    daily_rewards: [],
  };
  store.docs.push(doc);
  store.pending.push({ groupId: 'G9', miner_key: MINER, records: [] });
  state.noEvidence.add(new Date('2026-05-07T00:00:00Z').toISOString());
  return doc;
}

test('C1: claiming number 18 settles only the selected row; held, reserved, partially-paid, claimed and evidence-dropped siblings are untouched', async () => {
  reset();
  const before = clone(seedC1());
  const out = await runClaim({ no: 18 });
  assert.equal(out.thrown, null, `claim threw: ${JSON.stringify(out.thrown && (out.thrown.response || out.thrown.message))}`);
  const d = live();
  const s1 = d.weekly_rewards[0];
  assert.equal(s1.status, 'claimed'); assert.equal(s1.tx_id, 'CUSTODIALTX'); assert.equal(s1.claimed_amount, 12.5); assert.ok(s1.claimed_at instanceof Date);
  for (const i of [1, 2, 3, 4, 5]) assert.deepStrictEqual(d.weekly_rewards[i], before.weekly_rewards[i], `sibling weekly[${i}] must be untouched`);
});

test('C2: claim-all with two unheld twins numbered 18 settles each with its OWN claimed_amount', async () => {
  reset();
  store.docs.push({
    _id: new ObjectId(), miner_key: MINER, total_claimable: 1000, total_claimed: 0,
    weekly_rewards: [
      W({ _id: new ObjectId(), reward_number: 18, status: 'claimable', amount: 100, corrected_amount: 12.5, corrected_by: 'fem_final_f3y', week_start: new Date('2026-01-08T00:00:00Z'), week_end: new Date('2026-01-14T23:59:59Z') }),
      W({ reward_number: 18, status: 'claimable', amount: 25.75, corrected_by: 'fem_final_f3y', week_start: new Date('2026-03-19T00:00:00Z'), week_end: new Date('2026-03-25T23:59:59Z') }),
    ],
    daily_rewards: [],
  });
  const out = await runClaim({});
  assert.equal(out.thrown, null, `claim threw: ${JSON.stringify(out.thrown && (out.thrown.response || out.thrown.message))}`);
  const d = live();
  assert.deepEqual(d.weekly_rewards.map((e) => [e.status, e.tx_id, e.claimed_amount]), [['claimed', 'CUSTODIALTX', 12.5], ['claimed', 'CUSTODIALTX', 25.75]]);
});

test('C3 guard: the custodial legs are unchanged — one full-amount transfer to the claimer, no fee leg', async () => {
  reset();
  seedC1();
  await runClaim({ no: 18 });
  assert.deepEqual(state.transfers.map((t) => [t.receiver, t.amount]), [[ADDR, 12500000]]);
  assert.ok(!state.transfers.some((t) => t.receiver === SINK), 'no FFG fee leg on a matured claim (gate unchanged)');
});

test('C4: a held twin identical except payout_hold is never settled, and the selected paid row is', async () => {
  reset();
  const ws = new Date('2026-01-08T00:00:00Z'); const we = new Date('2026-01-14T23:59:59Z');
  store.docs.push({ _id: new ObjectId(), miner_key: MINER, total_claimable: 100, total_claimed: 0, weekly_rewards: [
    W({ reward_number: 18, status: 'claimable', amount: 12.5, corrected_by: 'fem_final_f3y', week_start: ws, week_end: we }),
    W({ reward_number: 18, status: 'claimable', amount: 12.5, corrected_by: 'fem_final_f3y', payout_hold: true, week_start: ws, week_end: we }),
  ], daily_rewards: [] });
  const before = clone(live());
  const out = await runClaim({ no: 18 });
  assert.equal(out.thrown, null, JSON.stringify(out.thrown && (out.thrown.response || out.thrown.message)));
  assert.deepEqual([live().weekly_rewards[0].status, live().weekly_rewards[0].tx_id, live().weekly_rewards[0].claimed_amount], ['claimed', 'CUSTODIALTX', 12.5], 'selected paid row settled');
  assert.deepStrictEqual(live().weekly_rewards[1], before.weekly_rewards[1], 'held twin untouched');
});

test('C5: a database failure while settling fails the request and leaves the claim totals untouched', async () => {
  reset();
  seedC1();
  state.failSettleWrites = true;
  const out = await runClaim({ no: 18 });
  assert.ok(out.thrown, 'request must fail');
  assert.ok(!(out.thrown && out.thrown.response && out.thrown.response.code === 'ALREADY_TRANSITIONED'), 'must not answer "no longer claimable" after an on-chain payment');
  assert.equal(live().total_claimable, 1000); assert.equal(live().total_claimed, 0);
});

test('C6 guard: a row with a string reward_number does not block the other paid rows from settling', async () => {
  reset();
  store.docs.push({ _id: new ObjectId(), miner_key: MINER, total_claimable: 100, total_claimed: 0, weekly_rewards: [
    W({ reward_number: 21, status: 'claimable', amount: 3, corrected_by: 'fem_final_f3y', week_start: new Date('2026-02-05T00:00:00Z'), week_end: new Date('2026-02-11T23:59:59Z') }),
    W({ reward_number: '22', status: 'claimable', amount: 4, corrected_by: 'fem_final_f3y', week_start: new Date('2026-02-12T00:00:00Z'), week_end: new Date('2026-02-18T23:59:59Z') }),
  ], daily_rewards: [] });
  const out = await runClaim({});
  assert.equal(out.thrown, null, JSON.stringify(out.thrown && (out.thrown.response || out.thrown.message)));
  assert.equal(live().weekly_rewards[0].status, 'claimed');
  assert.equal(live().weekly_rewards[1].status, 'claimed', 'the string-numbered row itself settles');
});

test('C7: a paid row changed between the claim snapshot and the settle (corrected_amount) still settles, AMOUNT_DRIFT logged', async () => {
  reset();
  seedC1();
  state.mutateOnSettleRead = (d) => { d.weekly_rewards[0].corrected_amount = 140.1; };
  const out = await runClaim({ no: 18 });
  assert.equal(out.thrown, null, JSON.stringify(out.thrown && (out.thrown.response || out.thrown.message)));
  assert.equal(live().weekly_rewards[0].status, 'claimed', 'paid row must not stay claimable');
  assert.equal(live().weekly_rewards[0].claimed_amount, 12.5, 'claimed_amount = the amount actually paid');
  assert.ok(state.loggedErrors.some((e) => e.metadata && e.metadata.issueType === 'REWARD_CLAIM_SETTLE_AMOUNT_DRIFT'));
});
