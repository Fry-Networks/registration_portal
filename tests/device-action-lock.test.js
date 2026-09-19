const test = require('node:test');
const assert = require('node:assert/strict');

require('ts-node/register/transpile-only');
const { createApiError, ErrorCodes } = require('../lib/api-errors');

// In-memory collections to emulate Mongo behaviour for locks + journal entries.
const lockDocs = new Map();
const journalDocs = new Map();

const makeDocKey = (minerKey, action) => `${minerKey}:${action}`;
const makeJournalKey = (minerKey, idempotencyKey) => `${minerKey}:${idempotencyKey}`;

// Simple collection factory mimicking the small subset of Mongo APIs we use.
const createCollection = (name) => {
  if (name === 'device_request_locks') {
    return {
      createIndex: async () => {},
      insertOne: async (doc) => {
        const key = makeDocKey(doc.miner_key, doc.action);
        if (lockDocs.has(key)) {
          const error = new Error('duplicate key');
          error.code = 11000;
          throw error;
        }
        lockDocs.set(key, doc);
        return { acknowledged: true };
      },
      deleteOne: async ({ action, miner_key }) => {
        const key = makeDocKey(miner_key, action);
        lockDocs.delete(key);
        return { acknowledged: true };
      },
      deleteMany: async () => ({ acknowledged: true, deletedCount: 0 })
    };
  }

  if (name === 'device_transactions') {
    return {
      createIndex: async () => {},
      updateOne: async (filter, update, options) => {
        const key = makeJournalKey(filter.miner_key, filter.idempotencyKey);
        let doc = journalDocs.get(key);
        if (!doc) {
          if (!options?.upsert) {
            return { matchedCount: 0, upsertedCount: 0 };
          }
          doc = {
            miner_key: filter.miner_key,
            idempotencyKey: filter.idempotencyKey,
            walletAddress: filter.walletAddress,
            request: filter.request,
            createdAt: new Date()
          };
          journalDocs.set(key, doc);
        }

        if (update.$set) {
          Object.assign(doc, update.$set);
        }
        if (update.$setOnInsert && !doc._initialized) {
          Object.assign(doc, update.$setOnInsert);
        }
        doc.updatedAt = new Date();
        doc._initialized = true;
        return { matchedCount: 1, upsertedCount: 0 };
      }
    };
  }

  throw new Error(`Unexpected collection: ${name}`);
};

const mockClient = {
  db: () => ({
    collection: (name) => createCollection(name)
  })
};

// Stub discord webhook to avoid network calls and capture usage.
const discordCalls = [];
const discordStub = {
  notifyDiscordError: async (details) => {
    discordCalls.push(details);
  }
};

// Install stubs into Node's module cache before requiring the helper.
require.cache[require.resolve('../lib/mongoclient')] = { exports: Promise.resolve(mockClient) };
require.cache[require.resolve('../lib/discord-webhook')] = { exports: discordStub };

const { withDeviceActionLock } = require('../lib/api/deviceAction.ts');

const createMockRes = () => {
  const res = {
    statusCode: 200,
    body: null,
    headersSent: false,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      this.headersSent = true;
      return this;
    }
  };
  return res;
};

const createMockReq = (body = {}, headers = {}) => ({
  method: 'POST',
  body,
  headers,
  socket: { remoteAddress: '127.0.0.1' },
  url: '/api/mock'
});

test('withDeviceActionLock handles success path and releases lock', async () => {
  lockDocs.clear();
  journalDocs.clear();

  const req = createMockReq({ foo: 'bar' });
  const res = createMockRes();

  let handlerExecuted = false;

  await withDeviceActionLock(req, res, {
    action: 'claim',
    miner_key: 'TEST-1',
    address: 'ADDR',
    metadata: { test: true }
  }, async () => {
    handlerExecuted = true;
    return { response: { ok: true } };
  });

  assert.equal(handlerExecuted, true);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true });
  assert.equal(lockDocs.size, 0);
  assert.equal(journalDocs.size, 1);
});

test('withDeviceActionLock prevents concurrent actions', async () => {
  lockDocs.clear();
  journalDocs.clear();

  let release;
  const firstReq = createMockReq({ foo: 'bar' });
  const firstRes = createMockRes();

  const firstPromise = withDeviceActionLock(firstReq, firstRes, {
    action: 'claim',
    miner_key: 'TEST-2',
    address: 'ADDR',
    metadata: { test: true }
  }, async () => {
    await new Promise((resolve) => {
      release = resolve;
    });
  });

  // Fire a second request while the first lock is still held.
  const secondReq = createMockReq({ foo: 'bar' });
  const secondRes = createMockRes();
  await withDeviceActionLock(secondReq, secondRes, {
    action: 'claim',
    miner_key: 'TEST-2',
    address: 'ADDR',
    metadata: { test: true }
  }, async () => ({ response: { ok: true } }));

  assert.equal(secondRes.statusCode, 409);
  assert.equal(secondRes.body.success, false);
  assert.equal(secondRes.body.code, ErrorCodes.ACTION_IN_PROGRESS);

  // Release the first lock and await completion.
  release();
  await firstPromise;
  assert.equal(lockDocs.size, 0);
});

test('withDeviceActionLock records failures and notifies discord', async () => {
  lockDocs.clear();
  journalDocs.clear();
  discordCalls.length = 0;

  const req = createMockReq({ foo: 'bad' });
  const res = createMockRes();

  await withDeviceActionLock(req, res, {
    action: 'claim',
    miner_key: 'TEST-3',
    address: 'ADDR',
    metadata: { scenario: 'failure' }
  }, async () => {
    throw {
      status: 422,
      response: createApiError(ErrorCodes.INVALID_INPUT, 'Bad input')
    };
  });

  assert.equal(res.statusCode, 422);
  assert.equal(res.body.code, ErrorCodes.INVALID_INPUT);
  assert.equal(journalDocs.size, 1);
  const failedEntry = Array.from(journalDocs.values())[0];
  assert.equal(failedEntry.status, 'failed');
  assert.equal(discordCalls.length, 1);
  assert.equal(discordCalls[0].minerKey, 'TEST-3');
});
