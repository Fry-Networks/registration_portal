// RC1 (r12, 2026-09-22) — ownership-gated rebind of a device-wallet-clobbered registration.
//
// The July premature-binding clobber left 22 of 20,049 main.devices docs with
// address === reward_wallet === device_algo_address (the device's OWN wallet). Those docs
// resolve to no owner: pages/devices.tsx lists by {address: session.user.address}, and both
// registration routes refused the rightful owner.
//
// The carve-out that lets the owner recover them must NOT be satisfied by miner-key
// possession alone: install keys circulate in Discord support threads. The ownership proof
// is creds.hardware.address — the wallet that registered the key at install time, which the
// clobber never touched. pages/api/registrations/create.ts carried a device-wallet carve-out
// with NO such proof (any session holding the key could rebind); that is closed here.
const test = require('node:test');
const assert = require('node:assert/strict');
const { ObjectId } = require('mongodb');

require('ts-node').register({
  transpileOnly: true,
  compilerOptions: { module: 'commonjs', moduleResolution: 'node', target: 'ES2017', jsx: 'react' },
});

const stub = (relPath, exports) => {
  const resolved = require.resolve(relPath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
};

// RC1-FIX: an install record now also has to PRE-DATE the carve-out (lib/rebindOwnership.ts
// REBIND_PROOF_CUTOFF), because creds.hardware.address by itself is mintable. The fixtures
// below therefore carry the _id every real Mongo doc has; 2026-07-05 is the newest creation
// time measured on the 8 real install records (ARES00, 2026-09-22).
const oidAt = (iso) =>
  new ObjectId(Math.floor(Date.parse(iso) / 1000).toString(16).padStart(8, '0') + '0123456789abcdef');
const INSTALL_OID = () => oidAt('2026-07-05T22:51:15.000Z');

const pad = (s) => (s + 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA').slice(0, 58);
const OWNER = pad('SN7VBD4QOWNER');
const ATTACKER = pad('ZZATTACKERWALLET');
const DEVWALLET = pad('KYSZ5UNADEVICEWALLET');
const DEVWALLET2 = pad('TTYL7U6PDEVICEWALLET');
const THIRDPARTY = pad('J2QENDSOTHIRDPARTY');

const KEY_CLOBBERED = 'FEM-CLOBBEREDKEYAAAAAAAAAAAAAAAAAAAA';
const KEY_OTHER = 'FEM-OTHEROWNEDKEYBBBBBBBBBBBBBBBBBBB';

// ---------------------------------------------------------------- fake Mongo
const state = { session: OWNER, devices: [], creds: [], writes: [] };

const matchKey = (docKey, q) => {
  if (typeof q === 'string') return docKey === q;
  if (q && typeof q.$regex === 'string') return new RegExp(q.$regex, q.$options || '').test(docKey);
  return false;
};

const devicesCollection = {
  findOne: async (filter) => state.devices.find((d) => matchKey(d.miner_key, filter.miner_key)) || null,
  updateOne: async (filter, update) => {
    state.writes.push({ filter, update });
    const doc = state.devices.find((d) => matchKey(d.miner_key, filter.miner_key));
    if (!doc) return { matchedCount: 0, modifiedCount: 0 };
    Object.assign(doc, update.$set || {});
    return { matchedCount: 1, modifiedCount: 1 };
  },
};

const credsHardwareCollection = {
  findOne: async (filter) => state.creds.find((c) => matchKey(c.miner_key, filter.miner_key)) || null,
};

const fakeClient = {
  db: (name) => ({
    collection: (col) => {
      if (name === 'main' && (col === 'devices' || col === 'test-devices')) return devicesCollection;
      if (name === 'creds' && col === 'hardware') return credsHardwareCollection;
      return { findOne: async () => null, updateOne: async () => ({ matchedCount: 0, modifiedCount: 0 }) };
    },
  }),
};

stub('next-auth', {
  __esModule: true,
  getServerSession: async () => (state.session ? { user: { address: state.session } } : null),
});
stub('../pages/api/auth/[...nextauth].ts', { __esModule: true, authOptions: {} });
stub('../lib/mongoclient', { __esModule: true, default: Promise.resolve(fakeClient) });
stub('../lib/logger', {
  __esModule: true,
  loggers: new Proxy({}, { get: () => () => {} }),
  default: new Proxy({}, { get: () => () => {} }),
});

const registerHandler = require('../pages/api/registrations/register.ts').default;
const createHandler = require('../pages/api/registrations/create.ts').default;

const call = async (handler, body) => {
  const captured = { code: 0, body: null };
  const res = {
    status(c) { captured.code = c; return res; },
    json(b) { captured.body = b; return res; },
    setHeader() { return res; },
  };
  await handler({ method: 'POST', headers: {}, query: {}, body }, res);
  return captured;
};

const CONTACT = { names: { first_name: 'Test', last_name: 'Owner' }, email: 'owner@example.com' };

const seedClobbered = ({ credsAddress }) => {
  state.writes = [];
  state.devices = [
    {
      miner_key: KEY_CLOBBERED,
      is_registered: true,
      address: DEVWALLET,
      reward_wallet: DEVWALLET,
      device_algo_address: DEVWALLET,
    },
  ];
  state.creds = credsAddress
    ? [{ _id: INSTALL_OID(), miner_key: KEY_CLOBBERED, address: credsAddress }]
    : [];
};

const seedOwnedByThirdParty = () => {
  state.writes = [];
  state.devices = [
    {
      miner_key: KEY_OTHER,
      is_registered: true,
      address: THIRDPARTY,
      reward_wallet: THIRDPARTY,
      device_algo_address: DEVWALLET2,
    },
  ];
  // creds.hardware deliberately names the ATTACKER: a non-clobbered doc owned by a real
  // wallet must still be refused even if the key's install record says otherwise.
  state.creds = [{ _id: INSTALL_OID(), miner_key: KEY_OTHER, address: ATTACKER }];
};

const doc = (key) => state.devices.find((d) => d.miner_key === key);

// ------------------------------------------------------- (i) POSITIVE: the owner
test('register: the wallet named by creds.hardware rebinds its clobbered device', async () => {
  seedClobbered({ credsAddress: OWNER });
  state.session = OWNER;
  const { code, body } = await call(registerHandler, { miner_key: KEY_CLOBBERED, address: OWNER });
  assert.equal(code, 200, 'expected 200, got ' + code + ' ' + JSON.stringify(body));
  const d = doc(KEY_CLOBBERED);
  assert.equal(d.address, OWNER, 'address must become the session wallet');
  assert.equal(d.reward_wallet, OWNER, 'reward_wallet must become the session wallet (claim.ts pays it)');
  assert.equal(d.rebound_from, DEVWALLET, 'rebound_from records the clobbered device wallet');
  assert.equal(typeof d.rebind_note, 'string');
  assert.ok(d.rebind_note.length > 0, 'rebind_note explains the rebind');
  assert.ok(d.rebind_at instanceof Date, 'rebind_at is a Date');
});

test('create: the wallet named by creds.hardware rebinds its clobbered device', async () => {
  seedClobbered({ credsAddress: OWNER });
  state.session = OWNER;
  const { code, body } = await call(createHandler, {
    miner_key: KEY_CLOBBERED,
    address: OWNER,
    ...CONTACT,
  });
  assert.equal(code, 200, 'expected 200, got ' + code + ' ' + JSON.stringify(body));
  const d = doc(KEY_CLOBBERED);
  assert.equal(d.address, OWNER);
  assert.equal(d.reward_wallet, OWNER, 'reward_wallet must become the session wallet');
  assert.equal(d.rebound_from, DEVWALLET, 'rebound_from records the clobbered device wallet');
  assert.equal(typeof d.rebind_note, 'string');
  assert.ok(d.rebind_at instanceof Date, 'rebind_at is a Date');
});

// ------------------------------- (ii) NEGATIVE: a different wallet holding the key
test('register: a different wallet cannot rebind the same clobbered device', async () => {
  seedClobbered({ credsAddress: OWNER });
  state.session = ATTACKER;
  const { code, body } = await call(registerHandler, { miner_key: KEY_CLOBBERED, address: ATTACKER });
  assert.notEqual(code, 200, 'key possession alone must never rebind: ' + JSON.stringify(body));
  const d = doc(KEY_CLOBBERED);
  assert.equal(d.address, DEVWALLET, 'the doc must be untouched');
  assert.equal(d.reward_wallet, DEVWALLET, 'the doc must be untouched');
  assert.equal(d.rebound_from, undefined, 'no rebind metadata is written on a refusal');
  assert.deepEqual(state.writes, [], 'a refused rebind performs no write at all');
});

test('create: a different wallet cannot rebind the same clobbered device', async () => {
  seedClobbered({ credsAddress: OWNER });
  state.session = ATTACKER;
  const { code, body } = await call(createHandler, {
    miner_key: KEY_CLOBBERED,
    address: ATTACKER,
    ...CONTACT,
  });
  assert.notEqual(code, 200, 'key possession alone must never rebind: ' + JSON.stringify(body));
  const d = doc(KEY_CLOBBERED);
  assert.equal(d.address, DEVWALLET, 'the doc must be untouched');
  assert.equal(d.reward_wallet, DEVWALLET, 'the doc must be untouched');
  assert.equal(d.rebound_from, undefined, 'no rebind metadata is written on a refusal');
  assert.deepEqual(state.writes, [], 'a refused rebind performs no write at all');
});

test('register: a clobbered device with no creds.hardware record is not rebindable by key alone', async () => {
  seedClobbered({ credsAddress: null });
  state.session = ATTACKER;
  const { code } = await call(registerHandler, { miner_key: KEY_CLOBBERED, address: ATTACKER });
  assert.notEqual(code, 200, 'with no install record there is no ownership proof');
  assert.equal(doc(KEY_CLOBBERED).address, DEVWALLET);
  assert.deepEqual(state.writes, []);
});

test('create: a clobbered device with no creds.hardware record is not rebindable by key alone', async () => {
  seedClobbered({ credsAddress: null });
  state.session = ATTACKER;
  const { code } = await call(createHandler, { miner_key: KEY_CLOBBERED, address: ATTACKER, ...CONTACT });
  assert.notEqual(code, 200, 'with no install record there is no ownership proof');
  assert.equal(doc(KEY_CLOBBERED).address, DEVWALLET);
  assert.deepEqual(state.writes, []);
});

// --------------------------- (iii) a non-clobbered doc owned by someone else
test('register: a non-clobbered device owned by another wallet is still rejected', async () => {
  seedOwnedByThirdParty();
  state.session = ATTACKER;
  const { code } = await call(registerHandler, { miner_key: KEY_OTHER, address: ATTACKER });
  assert.equal(code, 409, 'a real owner mismatch is still a 409');
  assert.equal(doc(KEY_OTHER).address, THIRDPARTY);
  assert.deepEqual(state.writes, []);
});

test('create: a non-clobbered device owned by another wallet is still rejected', async () => {
  seedOwnedByThirdParty();
  state.session = ATTACKER;
  const { code } = await call(createHandler, { miner_key: KEY_OTHER, address: ATTACKER, ...CONTACT });
  assert.equal(code, 409, 'a real owner mismatch is still a 409');
  assert.equal(doc(KEY_OTHER).address, THIRDPARTY);
  assert.deepEqual(state.writes, []);
});
