// R12 CLAIM AVAILABILITY cover (HIGH from the adversarial review of 2d6d50c).
//
// 2d6d50c made a settled audit row durable by escalating the attempt key on the E11000 that the
// `open` upsert hits when a `confirmed` row already owns the key. The escalation walked a
// SEQUENCE - <base>, <base>#2, <base>#3, ... - bounded at MAX_JOURNAL_ATTEMPTS = 50, while the
// rows it walks past are only removed by the 90-day createdAt TTL. Every settled claim therefore
// consumed one attempt key for 90 days, and the 51st claim inside that window found all 50 keys
// taken and threw:
//
//   Unable to open a device_transactions attempt row for FEM-... after 50 attempts
//
// which withDeviceActionLock turns into an HTTP 500. A device that settles more than 50 claims in
// 90 days became permanently unable to claim - fNODE emits a daily reward, so 90 daily claims in
// a 90-day window is an ordinary usage pattern, not an abusive one.
//
// These tests drive the REAL lib/api/deviceAction.ts and lib/db/requestLocks.ts over a fake mongo
// that models the unique indexes (including the E11000 an upsert hits when its insert collides).
// Forward-only: nothing here backfills a row, and nothing may move a settled row back to pending.
//
// Also covered (MEDIUM 2 of the same review): the `update` phase's two safety properties -
// upsert:false (never backfill) and status $ne confirmed (never reopen) - which until now lived
// only in the docblock.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

require('ts-node').register({
  transpileOnly: true,
  compilerOptions: { module: 'commonjs', moduleResolution: 'node', target: 'ES2017', jsx: 'react' },
});

const stub = (relPath, exports) => {
  const resolved = require.resolve(relPath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
};

const MINER = 'FEM-UNBOUNDEDCLAIMS00000000000000000';
const ADDR = 'UNBOUNDEDCLAIMSWALLETADDRESS0000000000000000000000000AB';

// ------------------------------------------------------------------ fake Mongo
const state = {
  locks: [],          // main.device_request_locks   unique(miner_key, action)
  journal: [],        // main.device_transactions    unique(miner_key, idempotencyKey)
  journalWrites: [],  // every device_transactions updateOne: { filter, update, options, result }
};

const valueAt = (doc, dotted) =>
  dotted.split('.').reduce((acc, seg) => (acc === null || acc === undefined ? undefined : acc[seg]), doc);

const setAt = (doc, dotted, value) => {
  const segs = dotted.split('.');
  let cursor = doc;
  for (let i = 0; i < segs.length - 1; i += 1) {
    if (cursor[segs[i]] === null || typeof cursor[segs[i]] !== 'object') cursor[segs[i]] = {};
    cursor = cursor[segs[i]];
  }
  cursor[segs[segs.length - 1]] = value;
};

// Supports the operators/values these modules actually send: $in, $nin, $ne and a BSON regex
// (the driver serialises a JS RegExp straight into the query, and mongo can serve an anchored
// prefix regex from the unique(miner_key, idempotencyKey) index).
const matches = (doc, filter) =>
  Object.entries(filter || {}).every(([key, expected]) => {
    const actual = valueAt(doc, key);
    if (expected instanceof RegExp) return typeof actual === 'string' && expected.test(actual);
    if (expected && typeof expected === 'object' && !Array.isArray(expected) && !(expected instanceof Date)) {
      if ('$in' in expected) return expected.$in.includes(actual);
      if ('$nin' in expected) return !expected.$nin.includes(actual);
      if ('$ne' in expected) return actual !== expected.$ne;
    }
    return actual === expected;
  });

// Mongo seeds an upserted document from the EQUALITY fields of the filter only; $ne/$in/$nin and
// regex conditions contribute nothing. That is what makes the E11000 below reachable.
const equalityFields = (filter) => {
  const doc = {};
  for (const [key, expected] of Object.entries(filter || {})) {
    if (expected instanceof RegExp) continue;
    if (expected && typeof expected === 'object' && !Array.isArray(expected) && !(expected instanceof Date)) continue;
    setAt(doc, key, expected);
  }
  return doc;
};

const applyUpdate = (doc, update, isInsert) => {
  for (const [key, value] of Object.entries(update.$set || {})) setAt(doc, key, value);
  if (isInsert) for (const [key, value] of Object.entries(update.$setOnInsert || {})) setAt(doc, key, value);
};

const duplicateKeyError = (index) => {
  const error = new Error(`E11000 duplicate key error collection: main.device_transactions index: ${index}`);
  error.code = 11000;
  return error;
};

const journalCollection = {
  createIndex: async () => 'ok',
  findOne: async (filter) => state.journal.find((r) => matches(r, filter)) || null,
  find: (filter) => ({ toArray: async () => state.journal.filter((r) => matches(r, filter)) }),
  // The third argument matters: without it the fake would upsert whatever the caller asked for,
  // so turning the `update` phase into a backfill (`{ upsert: true }`) would stay invisible.
  updateOne: async (filter, update, options = {}) => {
    const row = state.journal.find((r) => matches(r, filter));
    let result;
    if (row) {
      applyUpdate(row, update, false);
      result = { matchedCount: 1, modifiedCount: 1, upsertedCount: 0 };
    } else if (options.upsert) {
      const doc = equalityFields(filter);
      // unique(miner_key, idempotencyKey)
      if (state.journal.some((r) => r.miner_key === doc.miner_key && r.idempotencyKey === doc.idempotencyKey)) {
        state.journalWrites.push({ filter, update, options, result: 'E11000' });
        throw duplicateKeyError('miner_key_1_idempotencyKey_1');
      }
      applyUpdate(doc, update, true);
      state.journal.push(doc);
      result = { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 };
    } else {
      result = { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 };
    }
    state.journalWrites.push({ filter, update, options, result });
    return result;
  },
};

const lockCollection = {
  createIndex: async () => 'ok',
  insertOne: async (doc) => {
    // unique(miner_key, action)
    if (state.locks.some((l) => l.miner_key === doc.miner_key && l.action === doc.action)) {
      throw duplicateKeyError('miner_key_1_action_1');
    }
    state.locks.push({ ...doc });
    return { acknowledged: true };
  },
  deleteOne: async (filter) => {
    const i = state.locks.findIndex((l) => matches(l, filter));
    if (i >= 0) state.locks.splice(i, 1);
    return { deletedCount: i >= 0 ? 1 : 0 };
  },
  deleteMany: async (filter) => {
    const before = state.locks.length;
    state.locks = state.locks.filter((l) => !matches(l, filter));
    return { deletedCount: before - state.locks.length };
  },
};

const fakeCollection = (name) => {
  if (name === 'device_request_locks') return lockCollection;
  if (name === 'device_transactions') return journalCollection;
  throw new Error(`Unexpected collection: ${name}`);
};

// ------------------------------------------------------------------ stubs
stub('../lib/mongoclient', { __esModule: true, default: Promise.resolve({ db: () => ({ collection: fakeCollection }) }) });
stub('../lib/discord-webhook', { __esModule: true, notifyDiscordError: async () => {} });
stub('../lib/api/operationRateLimit', { __esModule: true, enforceOperationRateLimit: async () => ({ allowed: true }) });

const { withDeviceActionLock } = require('../lib/api/deviceAction.ts');
const { confirmJournalEntryByGroupId, appendJournalEntry } = require('../lib/db/requestLocks.ts');

// ------------------------------------------------------------------ helpers
const reset = () => {
  state.locks.length = 0;
  state.journal.length = 0;
  state.journalWrites.length = 0;
};

const makeRes = () => {
  const captured = { status: null, body: null };
  return {
    captured,
    status(code) { captured.status = code; return this; },
    json(payload) { captured.body = payload; this.headersSent = true; return this; },
    headersSent: false,
  };
};

// Exactly what Claim.tsx posts for a claim-all: the body carries nothing but the miner key, so
// every claim this device ever makes hashes to the same BASE idempotency key.
const CLAIM_BODY = { miner_key: MINER };

// Mirrors lib/api/deviceAction.ts deriveIdempotencyKey for the default (header-less) request.
const BASE_KEY = crypto
  .createHash('sha256')
  .update(JSON.stringify({ body: { ...CLAIM_BODY }, miner_key: MINER, address: ADDR, action: 'claim' }))
  .update('POST')
  .digest('hex');

const runClaim = async (groupId, handlerBody) => {
  const req = {
    method: 'POST',
    url: '/api/rewards/claim',
    headers: {},
    socket: { remoteAddress: '127.0.0.1' },
    body: { ...CLAIM_BODY },
  };
  const res = makeRes();
  await withDeviceActionLock(
    req,
    res,
    { action: 'claim', miner_key: MINER, address: ADDR, metadata: { preview: false, rewardSelection: 'all' } },
    handlerBody ||
      (async () => ({
        // Mirrors the user-pays return of pages/api/rewards/claim.ts: the envelope is only
        // pre-signed here, so the audit row is deliberately left `pending`.
        response: { success: true, mode: 'user_pays', groupId },
        journal: { status: 'pending', metadata: { mode: 'user_pays', groupId } },
      })),
  );
  return res.captured;
};

const claimRows = () => state.journal.filter((r) => r.action === 'claim');
const rowFor = (groupId) => state.journal.find((r) => r.metadata && r.metadata.groupId === groupId);

// ------------------------------------------------------------------ tests

// The regression itself. 2d6d50c fails this at cycle 51 with a 500.
test('(U1) a device can settle an unbounded number of claims inside one TTL window', async () => {
  reset();

  const CYCLES = 60; // comfortably past the old MAX_JOURNAL_ATTEMPTS = 50
  const seenKeys = new Set();

  for (let i = 1; i <= CYCLES; i += 1) {
    const groupId = `GROUP-${i}`;
    const captured = await runClaim(groupId);

    assert.equal(
      captured.status,
      200,
      `claim #${i} answered ${captured.status} ${JSON.stringify(captured.body)} - a device must never run out of attempt keys`,
    );

    const row = rowFor(groupId);
    assert.ok(row, `claim #${i} opened no audit row of its own`);
    assert.equal(row.status, 'pending', `claim #${i} row status was ${row.status}`);
    assert.ok(!seenKeys.has(row.idempotencyKey), `claim #${i} reused the attempt key ${row.idempotencyKey}`);
    seenKeys.add(row.idempotencyKey);

    // /api/rewards/confirm settles the group: this row is now permanent for 90 days.
    const settled = await confirmJournalEntryByGroupId({
      miner_key: MINER,
      groupId,
      txId: `ASSETTRANSFERTXID${String(i).padStart(4, '0')}00000000000000000000000000`,
    });
    assert.equal(settled, true, `the writeback for claim #${i} matched no audit row`);
  }

  // Every settlement survived, each on its own row, each with its own txId.
  assert.equal(claimRows().length, CYCLES, `expected ${CYCLES} audit rows, got ${claimRows().length}`);
  for (let i = 1; i <= CYCLES; i += 1) {
    const row = rowFor(`GROUP-${i}`);
    assert.equal(row.status, 'confirmed', `the settlement for claim #${i} was reopened to "${row.status}"`);
    assert.equal(row.txId, `ASSETTRANSFERTXID${String(i).padStart(4, '0')}00000000000000000000000000`);
  }
});

test('(U2) attempt 1 still lands on the BARE base key, so rows written before the scheme keep their identity', async () => {
  reset();
  await runClaim('GROUP-FIRST');
  const row = rowFor('GROUP-FIRST');
  assert.equal(
    row.idempotencyKey,
    BASE_KEY,
    `the first attempt must own the bare base key (got ${row.idempotencyKey})`,
  );
});

test('(U3) a still-open ESCALATED attempt row is reused by a retry, not multiplied', async () => {
  reset();

  // Settle one claim so the bare base key is permanently taken.
  await runClaim('GROUP-SETTLED');
  await confirmJournalEntryByGroupId({
    miner_key: MINER,
    groupId: 'GROUP-SETTLED',
    txId: 'SETTLEDTXID0000000000000000000000000000000000000000000',
  });

  // Next claim escalates to a fresh key and is abandoned (envelope never signed) - still `pending`.
  await runClaim('GROUP-ABANDONED');
  const abandoned = rowFor('GROUP-ABANDONED');
  assert.notEqual(abandoned.idempotencyKey, BASE_KEY, 'the second attempt reused the settled key');
  const escalatedKey = abandoned.idempotencyKey;
  const stale = new Date(Date.now() - 80 * 24 * 60 * 60 * 1000);
  abandoned.createdAt = stale;

  const before = Date.now();
  await runClaim('GROUP-RETRY');

  assert.equal(claimRows().length, 2, `the retry multiplied the audit rows (${claimRows().length} rows for 3 requests)`);
  assert.equal(abandoned.metadata.groupId, 'GROUP-RETRY', 'the retry did not reuse the open escalated row');
  assert.equal(abandoned.idempotencyKey, escalatedKey, 'the reused row changed key');
  assert.ok(
    abandoned.createdAt.getTime() >= before,
    `the reused row kept its stale createdAt ${String(abandoned.createdAt)}`,
  );
});

test('(U4) every escalated attempt starts its own 90-day retention clock', async () => {
  reset();
  await runClaim('GROUP-OLD');
  await confirmJournalEntryByGroupId({ miner_key: MINER, groupId: 'GROUP-OLD', txId: 'OLDTXID000000000000000000000000000000000000000000000000' });
  const settled = rowFor('GROUP-OLD');
  const stale = new Date(Date.now() - 88 * 24 * 60 * 60 * 1000);
  settled.createdAt = stale;

  const before = Date.now();
  await runClaim('GROUP-NEW');
  const fresh = rowFor('GROUP-NEW');

  assert.ok(
    fresh.createdAt instanceof Date && fresh.createdAt.getTime() >= before,
    `the escalated attempt inherited createdAt ${String(fresh.createdAt)}`,
  );
  assert.equal(settled.createdAt.getTime(), stale.getTime(), 'the settled row had its retention clock rewritten');
});

// ------------------------------------------------------------- MEDIUM 2 cover
// Both properties below are asserted by the docblock on appendJournalEntry and were, until now,
// enforced by nothing: flipping `upsert: false` to `true`, or dropping the `status: { $ne:
// 'confirmed' }` term from the `update` filter, left the whole suite green.

test('(S1) the `update` phase never backfills a row that `open` did not create', async () => {
  reset();

  const returned = await appendJournalEntry({
    miner_key: MINER,
    action: 'claim',
    idempotencyKey: 'a-key-no-open-ever-returned',
    walletAddress: ADDR,
    request: { ...CLAIM_BODY },
    status: 'confirmed',
    txId: 'BACKFILLEDTXID00000000000000000000000000000000000000000',
    // phase defaults to 'update'
  });

  assert.equal(returned, 'a-key-no-open-ever-returned', 'the update phase must answer with the key it was given');
  assert.equal(
    state.journal.length,
    0,
    `the update phase created ${state.journal.length} row(s); a row that no open call created must stay absent`,
  );
  const writes = state.journalWrites.filter((w) => w.filter.idempotencyKey === 'a-key-no-open-ever-returned');
  assert.equal(writes.length, 1, `expected exactly one write, got ${writes.length}`);
  assert.notEqual(writes[0].options?.upsert, true, 'the update phase asked mongo to upsert - that is a backfill');
  assert.equal(writes[0].result.upsertedCount, 0, `upsertedCount was ${writes[0].result.upsertedCount}`);
});

test('(S2) the `update` phase never reopens a row the settlement confirmed mid-flight', async () => {
  reset();

  // The real race. device_request_locks has a 2-minute TTL, so a slow claim can still be inside
  // withDeviceActionLock when a second claim acquires the expired lock. Both requests own the SAME
  // audit row (the second `open` reuses the still-`pending` one), the second finishes and
  // /api/rewards/confirm settles that row - and only THEN does the first request write its
  // trailing `update`. That write must be dropped, not applied, or it undoes a settlement.
  let releaseSlowClaim;
  const slowClaim = runClaim('GROUP-SLOW', async () => {
    await new Promise((resolve) => { releaseSlowClaim = resolve; });
    return {
      response: { success: true, mode: 'user_pays', groupId: 'GROUP-SLOW' },
      journal: { status: 'pending', metadata: { mode: 'user_pays', groupId: 'GROUP-SLOW' } },
    };
  });
  await new Promise((resolve) => setImmediate(resolve)); // let it open its row and reach the handler

  const openedKey = claimRows()[0].idempotencyKey;

  // The device lock's TTL elapses (mongo reaps it) while the first request is still running.
  state.locks.length = 0;

  // Second claim: reuses the still-open row, completes, and stamps metadata.groupId on it.
  const second = await runClaim('GROUP-RACE');
  assert.equal(second.status, 200, `the second claim answered ${second.status}`);
  assert.equal(claimRows().length, 1, 'the second claim should have reused the open row');
  const row = rowFor('GROUP-RACE');
  assert.equal(row.idempotencyKey, openedKey, 'fixture is broken: the two requests must share one row');

  // /api/rewards/confirm settles that row.
  const settled = await confirmJournalEntryByGroupId({
    miner_key: MINER,
    groupId: 'GROUP-RACE',
    txId: 'RACEWINNERTXID00000000000000000000000000000000000000000',
    txIdSource: 'asset-transfer',
  });
  assert.equal(settled, true, 'fixture is broken: the writeback matched no row');

  // Only now does the first request come back and write its trailing `update`.
  releaseSlowClaim();
  await slowClaim;

  assert.equal(row.status, 'confirmed', `the trailing update reopened the settled row to "${row.status}"`);
  assert.equal(
    row.txId,
    'RACEWINNERTXID00000000000000000000000000000000000000000',
    `the trailing update overwrote the settled txId with ${String(row.txId)}`,
  );
  assert.equal(row.txIdSource, 'asset-transfer', 'the trailing update erased the settlement discriminator');
  assert.equal(row.metadata.groupId, 'GROUP-RACE', 'the trailing update re-pointed the settled row at another group');
  assert.equal(claimRows().length, 1, 'the late request opened a second row instead of being dropped');
});

test('(S3) a handler that names its txId source has it persisted on the audit row', async () => {
  reset();
  await runClaim('GROUP-CUSTODIAL', async () => ({
    response: { success: true, txId: 'CUSTODIALGROUPTXID000000000000000000000000000000000000' },
    journal: {
      status: 'confirmed',
      txId: 'CUSTODIALGROUPTXID000000000000000000000000000000000000',
      txIdSource: 'custodial-group',
      metadata: { groupId: 'GROUP-CUSTODIAL' },
    },
  }));

  const row = rowFor('GROUP-CUSTODIAL');
  assert.equal(row.status, 'confirmed');
  assert.equal(row.txId, 'CUSTODIALGROUPTXID000000000000000000000000000000000000');
  assert.equal(
    row.txIdSource,
    'custodial-group',
    `the audit row carries no txId discriminator (txIdSource=${String(row.txIdSource)})`,
  );
});
