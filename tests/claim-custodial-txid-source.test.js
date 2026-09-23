// R12 AUDIT-ROW SELF-DESCRIPTION cover (MEDIUM 3 from the adversarial review of 2d6d50c).
//
// `txIdSource` was introduced to stop a reader of main.device_transactions having to guess which
// transaction of a settled group `txId` is — but it was only ever written by the USER-PAYS path
// (/api/rewards/confirm records 'asset-transfer', or 'group-gas-fallback' when the envelope held
// no decodable axfer leg). The SERVER-PAYS (custodial) path in /api/rewards/claim settles its own
// group inline and stored the id algod answered sendRawTransaction with — group member 0 of a
// custodially signed group — with no discriminator at all. Two shapes of settled claim row, one
// of them unlabelled, is exactly the ambiguity txIdSource exists to remove.
//
// This test drives the REAL pages/api/rewards/claim.ts through the REAL
// lib/api/deviceAction.ts + lib/db/requestLocks.ts over a fake mongo, so the assertion is on the
// row that actually lands in device_transactions, not on the handler's return value.

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

const ADDR = 'SYNTHWALLETWGAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const MINER = 'FEM-CUSTODIALTXIDSOURCE000000000000';
const ASSET = '2485202024';
const AMOUNT = 306.75;
const VAULT = 'HXWYLLZDPTM5OXS3DPARMTG52RSBMMCQNKT4L2LZRRXYPNAWJBT6VIW6WU';
const SINK = 'U5TA6XANQ7G3XTKTBP5VEUXHSHZO2GWMZN75OU3BIHTQ5D7LDXZA7ATXSI';
const GROUP_TXID = 'CUSTODIALGROUPMEMBERZEROTXID000000000000000000000000000';

// ------------------------------------------------------------------ fake Mongo
const state = {
  locks: [],
  journal: [],
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

const equalityFields = (filter) => {
  const doc = {};
  for (const [key, expected] of Object.entries(filter || {})) {
    if (expected instanceof RegExp) continue;
    if (expected && typeof expected === 'object' && !Array.isArray(expected) && !(expected instanceof Date)) continue;
    setAt(doc, key, expected);
  }
  return doc;
};

const duplicateKeyError = (index) => {
  const error = new Error(`E11000 duplicate key error collection: main index: ${index}`);
  error.code = 11000;
  return error;
};

const weeklyRow = () => ({
  reward_number: 18,
  status: 'claimable',
  asset_id: ASSET,
  amount: AMOUNT,
  corrected_by: 'fem_final_f3y',
  week_start: new Date('2026-05-22T00:00:00Z'),
  week_end: new Date('2026-05-28T23:59:59Z'),
  unlock_at: new Date('2026-05-29T00:05:00Z'),
});

const fakeCollection = (name) => {
  if (name === 'device_request_locks') {
    return {
      createIndex: async () => 'ok',
      insertOne: async (doc) => {
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
      deleteMany: async () => ({ deletedCount: 0 }),
    };
  }
  if (name === 'device_transactions') {
    return {
      createIndex: async () => 'ok',
      findOne: async (filter) => state.journal.find((r) => matches(r, filter)) || null,
      updateOne: async (filter, update, options = {}) => {
        const row = state.journal.find((r) => matches(r, filter));
        if (row) {
          for (const [k, v] of Object.entries(update.$set || {})) setAt(row, k, v);
          return { matchedCount: 1, modifiedCount: 1, upsertedCount: 0 };
        }
        if (!options.upsert) return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 };
        const doc = equalityFields(filter);
        if (state.journal.some((r) => r.miner_key === doc.miner_key && r.idempotencyKey === doc.idempotencyKey)) {
          throw duplicateKeyError('miner_key_1_idempotencyKey_1');
        }
        for (const [k, v] of Object.entries(update.$set || {})) setAt(doc, k, v);
        for (const [k, v] of Object.entries(update.$setOnInsert || {})) setAt(doc, k, v);
        state.journal.push(doc);
        return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 };
      },
    };
  }
  return {
    createIndex: async () => 'ok',
    findOne: async () => {
      if (name === 'devices') return { miner_key: MINER, address: ADDR, reward_wallet: ADDR };
      if (name === 'device-rewards') {
        return { miner_key: MINER, weekly_rewards: [weeklyRow()], daily_rewards: [], total_claimable: AMOUNT, total_claimed: 0 };
      }
      if (name === 'fry_fee_genesis') {
        return {
          _id: 'config',
          fee_enabled: true,
          fee_bps: 3000,
          holder_share_num: 1,
          holder_share_den: 3,
          fee_note_prefix: 'ffg-fee:',
          fee_sink_addresses: [SINK],
          fee_source: 'instant_claim',
        };
      }
      return null;
    },
    updateOne: async () => ({ modifiedCount: 1 }),
    insertOne: async () => ({ insertedId: 'x' }),
  };
};

// ------------------------------------------------------------------ stubs
stub('next-auth', { __esModule: true, getServerSession: async () => ({ user: { address: ADDR } }) });
stub('../pages/api/auth/[...nextauth].ts', { __esModule: true, authOptions: {} });
stub('../lib/mongoclient', { __esModule: true, default: Promise.resolve({ db: () => ({ collection: fakeCollection }) }) });
stub('../lib/adminCheck', { __esModule: true, isAdminRequest: async () => true, isAdminWallet: async () => true, extractWalletFromRequest: () => ADDR });
stub('../lib/clientTokenMiddleware', { __esModule: true, verifyClientToken: async () => true });
stub('../lib/requestSignature.server', { __esModule: true, verifyRequestSignatureAsync: async () => true });
stub('../lib/deviceFingerprint', { __esModule: true, verifyDeviceFingerprintMiddleware: async () => 'ok' });
stub('../lib/logger', { __esModule: true, loggers: { apiError: () => {}, txnLog: () => {}, api: () => {}, security: () => {} } });
stub('../lib/discord-webhook', { __esModule: true, notifyDiscordError: async () => {} });
stub('../lib/api/operationRateLimit', { __esModule: true, enforceOperationRateLimit: async () => ({ allowed: true }) });
stub('../lib/rewardsVault.server', { __esModule: true, getRewardsVaultAddress: () => VAULT });
stub('../lib/utils', {
  __esModule: true,
  getAssetDecimals: async () => 6,
  fNODE: { id: ASSET, decimals: 6 },
  tFRY: { id: '2681521901', decimals: 6 },
});
stub('../lib/rewards/pocEvidence', { __esModule: true, loadEvidence: async () => ({ dates: new Set(), leases: [] }), hasEvidenceInWindow: () => true });
stub('../lib/rewards/reservation', { __esModule: true, reserveRows: async () => 1, releaseRows: async () => {}, releaseStaleReservations: async () => {} });
stub('../lib/monitoring/walletHealth', { __esModule: true, monitorWalletHealth: async () => {} });
stub('../lib/monitoring/transactionMonitor', { __esModule: true, monitorTransaction: async () => {} });
stub('../lib/algorand/optIn', { __esModule: true, ensureWalletAssetOptIn: async () => {} });
stub('../lib/algorand/withRetry', { __esModule: true, withRetry: async (fn) => fn() });
stub('../lib/wallet/clients', {
  __esModule: true,
  getAlgodClient: () => ({ accountAssetInformation: () => ({ do: async () => ({ 'asset-holding': { amount: 10000000000 } }) }) }),
  getIndexerClient: () => ({}),
});
stub('../lib/algorand/failover', {
  __esModule: true,
  AlgodUnavailableError: class AlgodUnavailableError extends Error {},
  getFailoverAccountInfo: async () => ({}),
  getFailoverAssetBalance: async () => 0,
  getFailoverAlgodClient: async () => ({ accountAssetInformation: () => ({ do: async () => ({ 'asset-holding': { amount: 10000000000 } }) }) }),
});
stub('../lib/wallet/transactions', { __esModule: true, buildAssetTransferTxn: async (args) => `txn:${args.receiver}:${args.amount}` });
stub('../lib/algorand/admin', {
  __esModule: true,
  decodeUnsignedTransaction: (t) => t,
  loadMnemonicAccountPair: () => ({ account: { addr: { toString: () => VAULT } } }),
  // The custodial pipeline signs and broadcasts the whole group itself and returns the id algod
  // answered sendRawTransaction with, i.e. group member 0.
  signAndSubmitCustodialTransactions: async () => ({ txId: GROUP_TXID }),
  buildUserPaysClaimGroup: async () => { throw new Error('user-pays path must not run in this test'); },
});

// The REAL device-action wrapper: this test is about the row it writes.
const handler = require('../pages/api/rewards/claim.ts').default;

const runClaim = async () => {
  state.locks.length = 0;
  state.journal.length = 0;
  process.env.REWARD_USER_PAYS_GAS = 'false';
  const captured = { status: null, body: null };
  const res = {
    status(code) { captured.status = code; return this; },
    json(payload) { captured.body = payload; this.headersSent = true; return this; },
    headersSent: false,
  };
  const req = { method: 'POST', url: '/api/rewards/claim', headers: {}, socket: { remoteAddress: '127.0.0.1' }, body: { miner_key: MINER, no: 18 } };
  await handler(req, res);
  return captured;
};

// ------------------------------------------------------------------ tests

test('a server-pays (custodial) claim labels the transaction id it stores on the audit row', async () => {
  const captured = await runClaim();

  assert.equal(captured.status, 200, `claim answered ${captured.status}: ${JSON.stringify(captured.body)}`);
  assert.equal(captured.body?.txId, GROUP_TXID);

  const rows = state.journal.filter((r) => r.action === 'claim');
  assert.equal(rows.length, 1, `expected one audit row, got ${rows.length}`);
  const row = rows[0];
  assert.equal(row.status, 'confirmed', `the settled custodial claim left the audit row "${row.status}"`);
  assert.equal(row.txId, GROUP_TXID, `the audit row stored ${String(row.txId)}`);
  assert.equal(
    row.txIdSource,
    'custodial-group',
    `the custodial path stored an UNLABELLED transaction id (txIdSource=${String(row.txIdSource)}); every settled claim row must say which transaction its txId is`,
  );
  assert.equal(state.locks.length, 0, 'the device lock was not released');
});
