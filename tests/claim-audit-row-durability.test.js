// R12 AUDIT-ROW DURABILITY cover (HIGH from the adversarial review of 1a4c4ed).
//
// main.device_transactions is keyed unique(miner_key, idempotencyKey). The key is a pure hash of
// the request body (lib/api/deviceAction.ts deriveIdempotencyKey), and Claim.tsx sends the
// identical body `{miner_key}` for every claim-all, so EVERY claim a device ever makes lands on
// the SAME journal row. withDeviceActionLock opens that row with status:'pending', txId:undefined,
// which means the settlement /api/rewards/confirm wrote back last week is overwritten by this
// week's claim: the audit row is not an audit row, it is a one-slot scratchpad.
//
// Production corroboration (R12 sweep): 2490 claim rows across 976 devices, 260 rows reused after
// more than 24 h, one row reused for 1529.7 h, txId explicit-null on 2485 of 2490.
//
// Compounding it, the 90-day TTL index on createdAt is only ever written with $setOnInsert, so a
// settlement landing in a months-old reused row expires on the ORIGINAL row's clock.
//
// These tests drive the REAL lib/api/deviceAction.ts and lib/db/requestLocks.ts over a fake mongo
// that models the unique indexes (including the E11000 an upsert hits when its insert collides).
// Forward-only: no test here backfills a row, and none may move a settled row back to pending.

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

const MINER = 'FEM-AUDITDURABILITY00000000000000000';
const ADDR = 'AUDITDURABILITYWALLETADDRESS00000000000000000000000000AB';

// ------------------------------------------------------------------ fake Mongo
const state = {
  locks: [],    // main.device_request_locks   unique(miner_key, action)
  journal: [],  // main.device_transactions    unique(miner_key, idempotencyKey)
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

// Supports the operators these modules actually send: $in, $nin, $ne.
const matches = (doc, filter) =>
  Object.entries(filter || {}).every(([key, expected]) => {
    const actual = valueAt(doc, key);
    if (expected && typeof expected === 'object' && !Array.isArray(expected) && !(expected instanceof Date)) {
      if ('$in' in expected) return expected.$in.includes(actual);
      if ('$nin' in expected) return !expected.$nin.includes(actual);
      if ('$ne' in expected) return actual !== expected.$ne;
    }
    return actual === expected;
  });

// Mongo seeds an upserted document from the EQUALITY fields of the filter only; $ne/$in/$nin
// conditions contribute nothing. That is what makes the collision below reachable.
const equalityFields = (filter) => {
  const doc = {};
  for (const [key, expected] of Object.entries(filter || {})) {
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
  updateOne: async (filter, update, options = {}) => {
    const row = state.journal.find((r) => matches(r, filter));
    if (row) {
      applyUpdate(row, update, false);
      return { matchedCount: 1, modifiedCount: 1, upsertedCount: 0 };
    }
    if (!options.upsert) {
      return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 };
    }
    const doc = equalityFields(filter);
    // unique(miner_key, idempotencyKey)
    if (state.journal.some((r) => r.miner_key === doc.miner_key && r.idempotencyKey === doc.idempotencyKey)) {
      throw duplicateKeyError('miner_key_1_idempotencyKey_1');
    }
    applyUpdate(doc, update, true);
    state.journal.push(doc);
    return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 };
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
const { confirmJournalEntryByGroupId } = require('../lib/db/requestLocks.ts');

// ------------------------------------------------------------------ helpers
const reset = () => {
  state.locks.length = 0;
  state.journal.length = 0;
};

const makeRes = () => {
  const captured = { status: null, body: null, headersSent: false };
  captured.status = null;
  return {
    captured,
    status(code) { captured.status = code; return this; },
    json(payload) { captured.body = payload; captured.headersSent = true; this.headersSent = true; return this; },
    headersSent: false,
  };
};

// Exactly what Claim.tsx posts for a claim-all: the body carries nothing but the miner key, so
// every claim this device ever makes hashes to the same idempotency key.
const CLAIM_BODY = { miner_key: MINER };

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
    {
      action: 'claim',
      miner_key: MINER,
      address: ADDR,
      metadata: { preview: false, rewardSelection: 'all' },
    },
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

test('(D2) a settled audit row survives the same device\'s next claim', async () => {
  reset();

  // Week 1: claim, then /api/rewards/confirm settles the group and writes back.
  await runClaim('GROUP-WEEK-1');
  assert.equal(claimRows().length, 1, 'week-1 claim should open exactly one audit row');
  const settledWriteback = await confirmJournalEntryByGroupId({
    miner_key: MINER,
    groupId: 'GROUP-WEEK-1',
    txId: 'ASSETTRANSFERWEEK1TXID000000000000000000000000000000000',
  });
  assert.equal(settledWriteback, true, 'the week-1 writeback did not move the audit row');

  const settled = rowFor('GROUP-WEEK-1');
  assert.equal(settled.status, 'confirmed');
  assert.equal(settled.txId, 'ASSETTRANSFERWEEK1TXID000000000000000000000000000000000');
  const settledKey = settled.idempotencyKey;

  // Week 2: the device claims again. Identical body => identical idempotency key.
  await runClaim('GROUP-WEEK-2');

  // The settled row must still be there, untouched, and still findable by its own key.
  assert.ok(
    state.journal.includes(settled),
    'the week-1 settlement row was DELETED by the week-2 claim',
  );
  assert.equal(
    settled.status,
    'confirmed',
    `the week-1 settlement row was reopened to "${settled.status}" by the week-2 claim`,
  );
  assert.equal(
    settled.txId,
    'ASSETTRANSFERWEEK1TXID000000000000000000000000000000000',
    `the week-1 settlement txId was overwritten with ${String(settled.txId)}`,
  );
  assert.equal(settled.metadata.groupId, 'GROUP-WEEK-1', 'the week-1 row was re-pointed at another group');

  // ...and the week-2 attempt must have a row of its own, under a DIFFERENT key.
  const week2 = rowFor('GROUP-WEEK-2');
  assert.ok(week2, 'the week-2 claim opened no audit row of its own');
  assert.equal(week2.status, 'pending');
  assert.notEqual(
    week2.idempotencyKey,
    settledKey,
    'the week-2 attempt reused the settled row\'s idempotency key',
  );
  assert.equal(claimRows().length, 2, `expected one row per attempt, got ${claimRows().length}`);

  // The week-2 settlement lands on the week-2 row and still cannot touch week 1.
  await confirmJournalEntryByGroupId({
    miner_key: MINER,
    groupId: 'GROUP-WEEK-2',
    txId: 'ASSETTRANSFERWEEK2TXID000000000000000000000000000000000',
  });
  assert.equal(week2.txId, 'ASSETTRANSFERWEEK2TXID000000000000000000000000000000000');
  assert.equal(settled.txId, 'ASSETTRANSFERWEEK1TXID000000000000000000000000000000000');
});

test('(D2b) a settled row is not reopened even when the claim fails', async () => {
  reset();
  await runClaim('GROUP-A');
  await confirmJournalEntryByGroupId({ miner_key: MINER, groupId: 'GROUP-A', txId: 'SETTLEDTXIDAAAA0000000000000000000000000000000000000000' });
  const settled = rowFor('GROUP-A');

  // Next claim throws: the catch path also calls appendJournalEntry.
  await runClaim('GROUP-B', async () => {
    throw { status: 422, response: { success: false, code: 'INVALID_INPUT', message: 'Bad input' } };
  });

  assert.equal(settled.status, 'confirmed', `the failure path moved the settled row to "${settled.status}"`);
  assert.equal(settled.txId, 'SETTLEDTXIDAAAA0000000000000000000000000000000000000000');
  const failedRows = claimRows().filter((r) => r.status === 'failed');
  assert.equal(failedRows.length, 1, 'the failed attempt did not get a row of its own');
  assert.notEqual(failedRows[0].idempotencyKey, settled.idempotencyKey);
});

test('(D3) duplicate-submit protection is unchanged: two rapid identical submits collapse into one attempt', async () => {
  reset();
  let release;
  const first = runClaim('GROUP-CONCURRENT', async () => {
    await new Promise((resolve) => { release = resolve; });
    return { response: { success: true }, journal: { status: 'pending', metadata: { groupId: 'GROUP-CONCURRENT' } } };
  });
  // Let the first request reach its handler (lock held, row opened).
  await new Promise((resolve) => setImmediate(resolve));

  const second = await runClaim('GROUP-CONCURRENT-2');

  assert.equal(second.status, 409, `the second rapid submit was not rejected (got ${second.status})`);
  assert.equal(second.body?.code, 'ACTION_IN_PROGRESS');
  assert.equal(claimRows().length, 1, `two rapid identical submits produced ${claimRows().length} attempt rows`);

  release();
  await first;
  assert.equal(claimRows().length, 1, 'the second submit opened a row after the first released the lock');
  assert.equal(state.locks.length, 0, 'the device lock was not released');
});

test('(D3b) a single request still writes exactly one row, and the header key still pins it', async () => {
  reset();
  await runClaim('GROUP-SINGLE');
  assert.equal(claimRows().length, 1, 'one request must not fan out into several audit rows');

  // An explicit x-idempotency-key still decides the base key.
  const req = {
    method: 'POST',
    url: '/api/rewards/claim',
    headers: { 'x-idempotency-key': 'client-supplied-key-1' },
    socket: { remoteAddress: '127.0.0.1' },
    body: { ...CLAIM_BODY },
  };
  const res = makeRes();
  await withDeviceActionLock(req, res, { action: 'claim', miner_key: MINER, address: ADDR, metadata: {} }, async () => ({
    response: { success: true },
    journal: { status: 'pending', metadata: { groupId: 'GROUP-HEADER' } },
  }));
  const headerRow = rowFor('GROUP-HEADER');
  assert.ok(headerRow, 'the header-keyed request opened no row');
  assert.equal(
    headerRow.idempotencyKey,
    'client-supplied-key-1',
    `x-idempotency-key no longer pins the audit row key (got ${headerRow.idempotencyKey})`,
  );
});

test('(D4) a new attempt starts its own 90-day TTL clock instead of inheriting a stale createdAt', async () => {
  reset();
  await runClaim('GROUP-OLD');
  await confirmJournalEntryByGroupId({ miner_key: MINER, groupId: 'GROUP-OLD', txId: 'OLDSETTLEDTXID00000000000000000000000000000000000000000' });
  const settled = rowFor('GROUP-OLD');

  // Age the settled row: 88 days old, i.e. two days from the TTL cutoff.
  const stale = new Date(Date.now() - 88 * 24 * 60 * 60 * 1000);
  settled.createdAt = stale;

  const before = Date.now();
  await runClaim('GROUP-NEW');
  const fresh = rowFor('GROUP-NEW');

  assert.ok(fresh, 'no row was opened for the new attempt');
  assert.ok(
    fresh.createdAt instanceof Date && fresh.createdAt.getTime() >= before,
    `the new attempt inherited createdAt ${String(fresh.createdAt)}; expected a clock started at this attempt`,
  );
  assert.equal(
    settled.createdAt.getTime(),
    stale.getTime(),
    'the settled row had its retention clock rewritten by a later attempt',
  );
});

test('(D4b) reusing a still-open attempt row restarts its retention clock', async () => {
  reset();
  await runClaim('GROUP-ABANDONED'); // never confirmed - stays `pending`
  const abandoned = rowFor('GROUP-ABANDONED');
  const stale = new Date(Date.now() - 80 * 24 * 60 * 60 * 1000);
  abandoned.createdAt = stale;

  const before = Date.now();
  await runClaim('GROUP-RETRY');

  // An unsettled row is still collapsed into (no audit record is destroyed that was ever settled),
  // but the row must not keep counting down the old clock - a settlement written into it later
  // would otherwise expire early.
  assert.equal(claimRows().length, 1, 'an unsettled attempt row should still be reused, not multiplied');
  assert.ok(
    abandoned.createdAt.getTime() >= before,
    `the reused row kept its stale createdAt ${String(abandoned.createdAt)}`,
  );
  assert.equal(abandoned.metadata.groupId, 'GROUP-RETRY');
});
