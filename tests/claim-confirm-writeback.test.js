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
const buildGroup = ({ nonce, withFeeLeg = false }) => {
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
  const feeLeg = realAlgosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender: VAULT.addr,
    receiver: SINK.addr,
    assetIndex: ASSET,
    amount: 1000000,
    suggestedParams: { ...base },
  });
  const serverLegs = withFeeLeg ? [rewardLeg, feeLeg] : [rewardLeg];
  realAlgosdk.assignGroupID([leg0, ...serverLegs]);
  return {
    groupId: Buffer.from(leg0.group).toString('base64'),
    signedUserLegB64: Buffer.from(leg0.signTxn(USER.sk)).toString('base64'),
    signedServerLegsB64: serverLegs.map((t) => Buffer.from(t.signTxn(VAULT.sk)).toString('base64')),
    gasTxId: leg0.txID(),
    assetTxId: rewardLeg.txID(),
    feeLegTxId: feeLeg.txID(),
  };
};

// ------------------------------------------------------------------ fake Mongo
const state = {
  journal: [],        // main.device_transactions
  pending: [],        // main.reward_pending_claims
  rewardUpdates: [],  // main.device-rewards writes
  deleted: [],
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

const journalCollection = {
  createIndex: async () => 'ok',
  findOne: async (filter) => state.journal.find((r) => matches(r, filter)) || null,
  updateOne: async (filter, update) => {
    const row = state.journal.find((r) => matches(r, filter));
    if (!row) return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 };
    Object.assign(row, update.$set || {});
    return { matchedCount: 1, modifiedCount: 1, upsertedCount: 0 };
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
stub('../lib/logger', { __esModule: true, loggers: { apiError: () => {}, txnLog: () => {}, api: () => {}, security: () => {} } });
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
