// R12 CONFIRM-WRITEBACK regression cover.
//
// The user-pays claim path writes three surfaces: main.device_transactions (the 90-day audit
// journal, written by withDeviceActionLock), main.reward_pending_claims (the pre-signed
// envelope) and main.device-rewards (the weekly/daily entries). /api/rewards/claim mints the
// envelope and leaves the audit row `pending` on purpose — nothing is on chain yet. The group
// is submitted later by /api/rewards/confirm, which consumed the envelope and moved the entries
// to `claimed`, but never touched the audit row. Measured in the R12 sweep: 0 of 1855 `pending`
// audit rows carried a txId while 747 of them already had `claimed` entries (worked example
// AHR3OGEL..., claim 2026-09-22T14:21:14, settled round 65289224, entry claimed 14:21:39, audit
// row still `pending`/txId null).
//
// Second defect covered here: the identifier that survives is the GAS-PAYMENT txid. algod's
// sendRawTransaction returns the txid of group member 0, which is the user's 10,000 uALGO
// payment leg (in one reported claim tx_id = UYVFM7QB..., while the fNODE actually moved in 27BRU5PF...).
// The audit row must carry the ASSET-TRANSFER txid, which is derivable from the vault-signed
// legs already stored on the envelope.
//
// Forward-only: nothing here backfills or re-statuses an existing row, and no path may ever
// move a settled audit row back to pending.

const test = require('node:test');
const assert = require('node:assert/strict');

require('ts-node').register({
  transpileOnly: true,
  compilerOptions: { module: 'commonjs', moduleResolution: 'node', target: 'ES2017', jsx: 'react' },
});

const stub = (relPath, exports) => {
  const resolved = require.resolve(relPath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
};

// Real algosdk, captured before the module cache is patched, so the fixtures below are genuine
// signed transactions with genuine group ids and txids.
const realAlgosdk = require('algosdk');

const VAULT = realAlgosdk.generateAccount();
const USER = realAlgosdk.generateAccount();
const SINK = realAlgosdk.generateAccount();
const USER_ADDR = String(USER.addr);
const MINER = 'FEM-CONFIRMWRITEBACK00000000000000000';
const ASSET = 2485202024; // fNODE

// ------------------------------------------------------------------ fixtures
// Mirrors lib/algorand/admin.ts buildUserPaysClaimGroup: leg0 = user -> vault ALGO gas payment,
// then the vault-signed reward legs (vault -> claimer), then the FFG holder-cut legs (vault -> sink).
const buildGroup = ({ nonce, withFeeLeg = false, extraRewardLeg = false, noRewardLeg = false }) => {
  const base = {
    fee: 0,
    flatFee: true,
    firstValid: nonce,
    lastValid: nonce + 100,
    genesisID: 'mainnet-v1.0',
    genesisHash: new Uint8Array(32),
    minFee: 1000,
  };
  const leg0 = realAlgosdk.makePaymentTxnWithSuggestedParamsFromObject({
    sender: USER.addr,
    receiver: VAULT.addr,
    amount: 10000,
    suggestedParams: { ...base, fee: 3000 },
  });
  const rewardLeg = realAlgosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender: VAULT.addr,
    receiver: USER.addr,
    assetIndex: ASSET,
    amount: 33070000,
    suggestedParams: { ...base },
  });
  // A second reward leg to the SAME claimer: a real group can pay a device more than once
  // (weekly + daily in one claim), and only the first was ever recorded.
  const secondRewardLeg = realAlgosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender: VAULT.addr,
    receiver: USER.addr,
    assetIndex: ASSET,
    amount: 7770000,
    suggestedParams: { ...base },
  });
  const feeLeg = realAlgosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender: VAULT.addr,
    receiver: SINK.addr,
    assetIndex: ASSET,
    amount: 1000000,
    suggestedParams: { ...base },
  });
  const rewardLegs = noRewardLeg ? [] : (extraRewardLeg ? [rewardLeg, secondRewardLeg] : [rewardLeg]);
  const serverLegs = withFeeLeg || noRewardLeg ? [...rewardLegs, feeLeg] : rewardLegs;
  realAlgosdk.assignGroupID([leg0, ...serverLegs]);
  return {
    groupId: Buffer.from(leg0.group).toString('base64'),
    signedUserLegB64: Buffer.from(leg0.signTxn(USER.sk)).toString('base64'),
    signedServerLegsB64: serverLegs.map((t) => Buffer.from(t.signTxn(VAULT.sk)).toString('base64')),
    gasTxId: leg0.txID(),
    assetTxId: rewardLeg.txID(),
    secondAssetTxId: secondRewardLeg.txID(),
    feeLegTxId: feeLeg.txID(),
  };
};

// ------------------------------------------------------------------ fake Mongo
const state = {
  journal: [],        // main.device_transactions
  pending: [],        // main.reward_pending_claims
  rewardUpdates: [],  // main.device-rewards writes
  deleted: [],
  journalWrites: [],  // every device_transactions updateOne: { filter, update, options, result }
  loggedErrors: [],   // loggers.apiError calls
};

const valueAt = (doc, dotted) =>
  dotted.split('.').reduce((acc, seg) => (acc === null || acc === undefined ? undefined : acc[seg]), doc);

const matches = (doc, filter) =>
  Object.entries(filter || {}).every(([key, expected]) => {
    const actual = valueAt(doc, key);
    if (expected && typeof expected === 'object' && !Array.isArray(expected) && '$in' in expected) {
      return expected.$in.includes(actual);
    }
    return actual === expected;
  });

// $set uses DOTTED paths for the metadata sub-fields, so the fake has to walk them the way mongo
// does — a plain Object.assign would invent a literal "metadata.gasTxId" key and quietly hide a
// clobbered metadata object.
const setAt = (doc, dotted, value) => {
  const segs = dotted.split('.');
  let cursor = doc;
  for (let i = 0; i < segs.length - 1; i += 1) {
    if (cursor[segs[i]] === null || typeof cursor[segs[i]] !== 'object') cursor[segs[i]] = {};
    cursor = cursor[segs[i]];
  }
  cursor[segs[segs.length - 1]] = value;
};

// Mongo seeds an upserted document from the EQUALITY fields of the filter only.
const equalityFields = (filter) => {
  const doc = {};
  for (const [key, expected] of Object.entries(filter || {})) {
    if (expected && typeof expected === 'object' && !Array.isArray(expected) && !(expected instanceof Date)) continue;
    setAt(doc, key, expected);
  }
  return doc;
};

const journalCollection = {
  createIndex: async () => 'ok',
  findOne: async (filter) => state.journal.find((r) => matches(r, filter)) || null,
  // The third argument matters: without it the fake upserts nothing whatever the caller asks for,
  // so turning this write into a backfill (`{ upsert: true }`) would stay invisible.
  updateOne: async (filter, update, options = {}) => {
    const row = state.journal.find((r) => matches(r, filter));
    let result;
    if (row) {
      for (const [key, value] of Object.entries(update.$set || {})) setAt(row, key, value);
      result = { matchedCount: 1, modifiedCount: 1, upsertedCount: 0 };
    } else if (options.upsert) {
      const doc = equalityFields(filter);
      for (const [key, value] of Object.entries(update.$set || {})) setAt(doc, key, value);
      for (const [key, value] of Object.entries(update.$setOnInsert || {})) setAt(doc, key, value);
      state.journal.push(doc);
      result = { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 };
    } else {
      result = { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 };
    }
    state.journalWrites.push({ filter, update, options, result });
    return result;
  },
};

const fakeCollection = (name) => {
  if (name === 'device_transactions') return journalCollection;
  if (name === 'reward_pending_claims') {
    return {
      findOne: async (filter) => state.pending.find((p) => matches(p, filter)) || null,
      deleteOne: async (filter) => {
        const i = state.pending.findIndex((p) => matches(p, filter));
        if (i >= 0) state.deleted.push(state.pending.splice(i, 1)[0]);
        return { deletedCount: i >= 0 ? 1 : 0 };
      },
      insertOne: async () => ({ insertedId: 'x' }),
    };
  }
  if (name === 'device-rewards') {
    return {
      updateOne: async (filter, update, options) => {
        state.rewardUpdates.push({ filter, update, options });
        return { modifiedCount: 1 };
      },
      updateMany: async (filter, update, options) => {
        state.rewardUpdates.push({ filter, update, options });
        return { modifiedCount: 1 };
      },
      findOne: async () => null,
    };
  }
  return { findOne: async () => null, updateOne: async () => ({ modifiedCount: 0 }), insertOne: async () => ({ insertedId: 'x' }), createIndex: async () => 'ok' };
};

// ------------------------------------------------------------------ stubs
let sendBehaviour = 'ok';
let currentGasTxId = '';
const submitted = [];

// algosdk re-exports its members as accessor properties, so a plain assignment to the
// override is silently dropped — defineProperty is required to shadow one.
const algosdkStub = Object.create(realAlgosdk);
Object.defineProperty(algosdkStub, '__esModule', { value: true, enumerable: true });
Object.defineProperty(algosdkStub, 'waitForConfirmation', {
  value: async () => ({ confirmedRound: 65289224 }),
  enumerable: true,
  configurable: true,
});
Object.defineProperty(algosdkStub, 'default', { get: () => algosdkStub, enumerable: true });
stub('algosdk', algosdkStub);

stub('next-auth', { __esModule: true, getServerSession: async () => ({ user: { address: USER_ADDR } }) });
stub('../pages/api/auth/[...nextauth].ts', { __esModule: true, authOptions: {} });
stub('../lib/mongoclient', { __esModule: true, default: Promise.resolve({ db: () => ({ collection: fakeCollection }) }) });
stub('../lib/adminCheck', { __esModule: true, isAdminRequest: async () => true, isAdminWallet: async () => true, extractWalletFromRequest: () => USER_ADDR });
stub('../lib/clientTokenMiddleware', { __esModule: true, verifyClientToken: async () => true });
stub('../lib/requestSignature.server', { __esModule: true, verifyRequestSignatureAsync: async () => true });
stub('../lib/deviceFingerprint', { __esModule: true, verifyDeviceFingerprintMiddleware: async () => 'ok' });
stub('../lib/logger', {
  __esModule: true,
  loggers: {
    apiError: (endpoint, error, metadata) => { state.loggedErrors.push({ endpoint, error, metadata }); },
    txnLog: () => {},
    api: () => {},
    security: () => {},
  },
});
stub('../lib/discord-webhook', { __esModule: true, notifyDiscordError: async () => {} });
stub('../lib/utils', { __esModule: true, getTransactionTime: async () => new Date('2026-09-22T14:21:39Z') });
stub('../lib/algorand/admin', { __esModule: true, loadMnemonicAccountPair: () => ({ address: String(VAULT.addr), account: { addr: VAULT.addr } }) });
stub('../lib/wallet/clients', { __esModule: true, getAlgodClient: () => ({}), getIndexerClient: () => ({}) });
stub('../pages/api/algorand/verify-txn.ts', { __esModule: true, verifyTransaction: async () => 'ok' });
stub('../lib/algorand/verification', { __esModule: true, VERIFY_RESULT: { OK: 'ok', NOT_FOUND: 'not_found' } });
stub('../lib/algorand/failover', {
  __esModule: true,
  getFailoverAlgodClient: async () => ({
    sendRawTransaction: (group) => ({
      do: async () => {
        submitted.push(group);
        if (sendBehaviour === 'reject') {
          throw new Error('TransactionPool.Remember: txgroup rejected: overspend');
        }
        // algod returns the txid of group member 0 — the user's gas payment leg.
        return { txid: currentGasTxId };
      },
    }),
  }),
});

const handler = require('../pages/api/rewards/confirm.ts').default;

// ------------------------------------------------------------------ helpers
const seedJournal = (groupId, overrides = {}) => {
  const row = {
    miner_key: MINER,
    action: 'claim',
    idempotencyKey: `idem-${groupId}`,
    walletAddress: USER_ADDR,
    request: { miner_key: MINER },
    status: 'pending',
    txId: undefined,
    metadata: { preview: false, rewardSelection: 'all', mode: 'user_pays', groupId },
    createdAt: new Date('2026-09-22T14:21:15Z'),
    updatedAt: new Date('2026-09-22T14:21:15Z'),
    ...overrides,
  };
  state.journal.push(row);
  return row;
};

const seedPending = (group) => {
  state.pending.push({
    groupId: group.groupId,
    miner_key: MINER,
    claimingAddress: USER_ADDR,
    signedServerLegsB64: group.signedServerLegsB64,
    records: [{ source: 'weekly', reward_number: 35, amount: 33.07 }],
    status: 'pending',
  });
};

const reset = () => {
  state.journal.length = 0;
  state.pending.length = 0;
  state.rewardUpdates.length = 0;
  state.deleted.length = 0;
  state.journalWrites.length = 0;
  state.loggedErrors.length = 0;
  submitted.length = 0;
  sendBehaviour = 'ok';
};

const runConfirm = async (group) => {
  currentGasTxId = group.gasTxId;
  const captured = { status: null, body: null };
  const res = {
    status(code) { captured.status = code; return this; },
    json(payload) { captured.body = payload; return this; },
  };
  const req = {
    method: 'POST',
    url: '/api/rewards/confirm',
    headers: {},
    socket: {},
    body: { groupId: group.groupId, signedUserLegB64: group.signedUserLegB64 },
  };
  await handler(req, res);
  return captured;
};

// ------------------------------------------------------------------ tests

test('(a) POSITIVE: a confirmed user-pays claim marks the audit row confirmed and persists a txId', async () => {
  reset();
  const group = buildGroup({ nonce: 1000 });
  seedPending(group);
  const row = seedJournal(group.groupId);

  const captured = await runConfirm(group);

  assert.equal(captured.status, 200, `expected 200, got ${captured.status}: ${JSON.stringify(captured.body)}`);
  assert.equal(captured.body?.success, true);
  assert.equal(
    row.status,
    'confirmed',
    `device_transactions row stayed "${row.status}" after a settled claim — this is the 1855-row defect`
  );
  assert.ok(
    typeof row.txId === 'string' && row.txId.length > 0,
    `device_transactions row carries no txId after a settled claim (txId=${String(row.txId)})`
  );
});

test('(d) the identifier persisted on the audit row is the ASSET-TRANSFER txid, not the gas-payment txid', async () => {
  reset();
  const group = buildGroup({ nonce: 2000, withFeeLeg: true });
  seedPending(group);
  const row = seedJournal(group.groupId);

  await runConfirm(group);

  assert.notEqual(
    group.assetTxId,
    group.gasTxId,
    'fixture is broken: the gas leg and the asset leg must have different txids'
  );
  assert.equal(
    row.txId,
    group.assetTxId,
    `audit row stored ${String(row.txId)}; expected the asset-transfer leg ${group.assetTxId} (gas leg was ${group.gasTxId})`
  );
  assert.notEqual(row.txId, group.feeLegTxId, 'audit row must not store the FFG holder-cut leg');
});

test('(b) NEGATIVE: a rejected submit never marks the audit row confirmed and never invents a txId', async () => {
  reset();
  const group = buildGroup({ nonce: 3000 });
  seedPending(group);
  const row = seedJournal(group.groupId);
  sendBehaviour = 'reject';

  const captured = await runConfirm(group);

  assert.equal(captured.status, 500, `expected the existing 500 shape, got ${captured.status}`);
  assert.equal(captured.body?.success, false);
  assert.equal(row.status, 'pending', `a rejected submit moved the audit row to "${row.status}"`);
  assert.equal(row.txId, undefined, `a rejected submit wrote txId ${String(row.txId)}`);
  assert.equal(state.deleted.length, 0, 'a rejected submit consumed the pending envelope');
  assert.equal(state.rewardUpdates.length, 0, 'a rejected submit wrote claimed entries');
});

test('(b2) NEGATIVE: an expired envelope answers 410 and leaves the audit row untouched', async () => {
  reset();
  const group = buildGroup({ nonce: 3500 });
  const row = seedJournal(group.groupId); // envelope deliberately absent

  const captured = await runConfirm(group);

  assert.equal(captured.status, 410, `expected 410 CLAIM_GROUP_EXPIRED, got ${captured.status}`);
  assert.equal(row.status, 'pending');
  assert.equal(row.txId, undefined);
});

test('(c) NEGATIVE: an already-confirmed audit row is never reopened or rewritten', async () => {
  reset();
  const group = buildGroup({ nonce: 4000 });
  seedPending(group);
  const settled = seedJournal(group.groupId, { status: 'confirmed', txId: 'ALREADYSETTLEDTXID0000000000000000000000000000000000000' });

  await runConfirm(group);

  assert.equal(settled.status, 'confirmed', `a settled audit row was moved to "${settled.status}"`);
  assert.equal(
    settled.txId,
    'ALREADYSETTLEDTXID0000000000000000000000000000000000000',
    'a settled audit row had its txId overwritten'
  );
});

test('(c2) NEGATIVE: the writeback targets exactly this device AND this group, nothing else', async () => {
  reset();
  const mine = buildGroup({ nonce: 5000 });
  const abandoned = buildGroup({ nonce: 6000 });
  // Both decoys are seeded BEFORE the real row, so a filter that drops either key reaches them
  // first. (i) another device that happens to be mid-claim under the same group id, and (ii) the
  // SAME device's earlier abandoned attempt, which is the shape the evidence actually shows
  // (AHR3OGEL... posted a claim at 14:21:14 and another at 14:22:42, both still `pending`).
  const otherDeviceRow = seedJournal(mine.groupId, {
    miner_key: 'FEM-SOMEONEELSE000000000000000000000',
    idempotencyKey: 'idem-other-device',
  });
  const abandonedAttemptRow = seedJournal(abandoned.groupId, { idempotencyKey: 'idem-earlier-attempt' });
  seedPending(mine);
  const mineRow = seedJournal(mine.groupId);

  await runConfirm(mine);

  assert.equal(mineRow.status, 'confirmed', 'this claim did not confirm its own audit row');
  assert.equal(mineRow.txId, mine.assetTxId);
  assert.equal(otherDeviceRow.status, 'pending', "another device's audit row was confirmed by this claim");
  assert.equal(otherDeviceRow.txId, undefined, "another device's audit row received a txId");
  assert.equal(abandonedAttemptRow.status, 'pending', "this device's earlier abandoned attempt was confirmed");
  assert.equal(abandonedAttemptRow.txId, undefined, "this device's earlier abandoned attempt received a txId");
});

test('(e) BOTH transaction ids are persisted, discriminated, and the /claim metadata survives', async () => {
  reset();
  const group = buildGroup({ nonce: 7000, withFeeLeg: true });
  seedPending(group);
  const row = seedJournal(group.groupId);

  const captured = await runConfirm(group);

  // The 200 response and the reward entries still carry the GAS id - that split is deliberate and
  // unchanged by this task; what changed is that the audit row now records both, and says which
  // is which, so the two surfaces can be joined.
  assert.equal(captured.body?.txId, group.gasTxId, 'the response should still return the submitted group id');
  assert.equal(row.txId, group.assetTxId, 'the audit row must key on the asset-transfer leg');
  assert.equal(row.txIdSource, 'asset-transfer', `txIdSource was ${String(row.txIdSource)}`);
  assert.equal(row.metadata.gasTxId, group.gasTxId, 'the gas id is not joinable from the audit row');
  assert.deepEqual(row.metadata.assetTxIds, [group.assetTxId]);
  // The dotted $set must not eat the metadata /claim wrote - including the groupId the writeback
  // itself filters on, which a whole-object $set would have destroyed.
  assert.equal(row.metadata.groupId, group.groupId, 'the writeback clobbered metadata.groupId');
  assert.equal(row.metadata.mode, 'user_pays', 'the writeback clobbered metadata written by /claim');
});

test('(f) every reward leg paid to the claimer is recorded, not only the first', async () => {
  reset();
  const group = buildGroup({ nonce: 7500, withFeeLeg: true, extraRewardLeg: true });
  seedPending(group);
  const row = seedJournal(group.groupId);

  await runConfirm(group);

  assert.deepEqual(
    row.metadata.assetTxIds,
    [group.assetTxId, group.secondAssetTxId],
    'a group paying the claimer twice must record both legs',
  );
  assert.equal(row.txId, group.assetTxId, 'txId stays the first reward leg');
  assert.ok(!row.metadata.assetTxIds.includes(group.feeLegTxId), 'the FFG holder-cut leg is not a reward leg');
});

test('(g) with no reward leg to the claimer the gas-id fallback is flagged, not silent', async () => {
  reset();
  const group = buildGroup({ nonce: 8000, noRewardLeg: true });
  seedPending(group);
  const row = seedJournal(group.groupId);

  await runConfirm(group);

  assert.equal(row.txId, group.gasTxId, 'the fallback should still store something, not nothing');
  assert.equal(
    row.txIdSource,
    'group-gas-fallback',
    `a gas-id fallback must be marked on the row (txIdSource=${String(row.txIdSource)})`,
  );
  assert.equal(row.metadata.assetTxIds, undefined, 'no reward leg was found, so none may be claimed');
  const flagged = state.loggedErrors.filter((e) => e.metadata?.issueType === 'REWARD_CONFIRM_ASSET_LEG_UNRESOLVED');
  assert.equal(flagged.length, 1, 'the silent gas-id fallback was not logged');
  // loggers.apiError(endpoint, error, ErrorLogMetadata) - the free-form context sits one level
  // down, under ErrorLogMetadata.metadata.
  assert.equal(flagged[0].metadata.metadata.groupId, group.groupId);
  assert.equal(flagged[0].metadata.metadata.gasTxId, group.gasTxId);
  assert.equal(flagged[0].metadata.metadata.serverLegCount, group.signedServerLegsB64.length);
});

test('(h) NEGATIVE: a groupId with no audit row is never backfilled', async () => {
  reset();
  const group = buildGroup({ nonce: 9000 });
  seedPending(group);
  // Deliberately no seedJournal: this is the shape where /claim's audit row already aged out of
  // the 90-day TTL, or never existed. The writeback must leave the collection exactly as it is.

  const captured = await runConfirm(group);

  assert.equal(captured.status, 200, 'a missing audit row must not fail the settled claim');
  assert.equal(state.journal.length, 0, `the writeback backfilled ${state.journal.length} audit row(s)`);
  const writes = state.journalWrites.filter((w) => w.filter['metadata.groupId'] === group.groupId);
  assert.equal(writes.length, 1, 'expected exactly one writeback attempt');
  assert.notEqual(writes[0].options?.upsert, true, 'the writeback asked mongo to upsert - that is a backfill');
  assert.equal(writes[0].result.matchedCount, 0, `matchedCount was ${writes[0].result.matchedCount}`);
  assert.equal(writes[0].result.upsertedCount, 0, `upsertedCount was ${writes[0].result.upsertedCount}`);
});

// ------------------------------------------------------------- MEDIUM 1 cover
// confirmJournalEntryByGroupId answers false when it matched no open audit row. That boolean was
// discarded at the call site, so "this settled claim has no audit row" looked exactly like a clean
// writeback — the same blind spot that let 1855 pending rows go unnoticed in the first place. The
// payment is on chain by then, so it is reported and never retried, at the SAME severity as a
// writeback that threw (loggers.apiError, issueType REWARD_CONFIRM_JOURNAL_WRITEBACK_*).

test('(i) a settled claim whose audit row is missing is REPORTED, not silently swallowed', async () => {
  reset();
  const group = buildGroup({ nonce: 11000, withFeeLeg: true });
  seedPending(group);
  // No seedJournal: /claim's audit row aged out of the 90-day TTL, or never existed.

  const captured = await runConfirm(group);

  assert.equal(captured.status, 200, 'a missing audit row must not fail the settled claim');
  assert.equal(state.journal.length, 0, 'the missing row must not be backfilled');

  const missed = state.loggedErrors.filter(
    (e) => e.metadata?.issueType === 'REWARD_CONFIRM_JOURNAL_WRITEBACK_MISSED',
  );
  assert.equal(
    missed.length,
    1,
    `a writeback that matched no audit row was not reported (issueTypes seen: ${JSON.stringify(state.loggedErrors.map((e) => e.metadata?.issueType))})`,
  );
  assert.equal(missed[0].endpoint, '/api/rewards/confirm');
  assert.ok(missed[0].error instanceof Error, 'the miss must be reported through the Error channel');
  assert.equal(missed[0].metadata.part, 'rewards-confirm.userpays.journal');
  assert.equal(missed[0].metadata.miner_key, MINER);
  // loggers.apiError(endpoint, error, ErrorLogMetadata) — free-form context one level down.
  assert.equal(missed[0].metadata.metadata.groupId, group.groupId);
  assert.equal(missed[0].metadata.metadata.gasTxId, group.gasTxId);
  assert.equal(missed[0].metadata.metadata.txId, group.assetTxId);
  assert.equal(missed[0].metadata.metadata.txIdSource, 'asset-transfer');
});

test('(j) a writeback that DID land reports nothing', async () => {
  reset();
  const group = buildGroup({ nonce: 12000, withFeeLeg: true });
  seedPending(group);
  const row = seedJournal(group.groupId);

  const captured = await runConfirm(group);

  assert.equal(captured.status, 200);
  assert.equal(row.status, 'confirmed', 'fixture is broken: the writeback did not land');
  assert.equal(
    state.loggedErrors.filter((e) => String(e.metadata?.issueType || '').startsWith('REWARD_CONFIRM_JOURNAL_WRITEBACK')).length,
    0,
    `a successful writeback raised ${JSON.stringify(state.loggedErrors.map((e) => e.metadata?.issueType))}`,
  );
});
