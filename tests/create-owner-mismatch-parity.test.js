// RC1 re-review (r12, 2026-09-22) — pages/api/registrations/create.ts gated its owner-mismatch
// refusal on `exists.is_registered`, while pages/api/registrations/register.ts refuses on the
// bound address alone. A main.devices doc bound to wallet A but carrying is_registered:false was
// therefore takeable by wallet B through /api/registrations/create with NO ownership proof at all:
// the 409 never fired, and the updateOne rewrote address (and the contact details) to the caller.
//
// Census on ARES00 2026-09-22 (main.devices, 20,051 docs): 235 docs are in that shape (trimmed
// non-empty address + is_registered:false). None of the 235 is in the July clobber state
// (address === device_algo_address) and none has a creds.hardware install record, so none of them
// is recoverable through the proof-gated rebind either — they are simply owned.
//
// The refusal must stay OUT of the genuinely unowned shapes, which stay claimable below:
//   - 485 docs with is_registered:true and NO address (the shape
//     tests/registration-unowned-device-claimable.test.js pins for register.ts), and
//   - 4,891 docs with neither an address nor is_registered.
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

const pad = (s) => (s + 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA').slice(0, 58);
const OWNER = pad('SN7VBD4QOWNER');
const ATTACKER = pad('ZZATTACKERWALLET');
const DEVWALLET = pad('KYSZ5UNADEVICEWALLET');

const KEY_OWNED_UNREG = 'FEM-OWNEDBUTUNREGISTEREDAAAAAAAAAAA';
const KEY_NO_ADDRESS = 'FEM-NOADDRESSUNOWNEDBBBBBBBBBBBBBBB';

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

// Bound to OWNER, never finalised: is_registered:false. NOT the clobber state
// (device_algo_address is the device's own wallet, different from the bound address).
const seedOwnedButUnregistered = () => {
  state.writes = [];
  state.creds = [];
  state.devices = [
    {
      miner_key: KEY_OWNED_UNREG,
      is_registered: false,
      address: OWNER,
      reward_wallet: OWNER,
      device_algo_address: DEVWALLET,
    },
  ];
};

const doc = (key) => state.devices.find((d) => d.miner_key === key);

// ------------------------------------------------------ (i) the reported hole
test('create: an unregistered device bound to another wallet is not takeable without a rebind proof', async () => {
  seedOwnedButUnregistered();
  state.session = ATTACKER;
  const { code, body } = await call(createHandler, {
    miner_key: KEY_OWNED_UNREG,
    address: ATTACKER,
    ...CONTACT,
  });
  assert.equal(code, 409, 'expected the owner-mismatch 409, got ' + code + ' ' + JSON.stringify(body));
  const d = doc(KEY_OWNED_UNREG);
  assert.equal(d.address, OWNER, 'the bound wallet must be untouched');
  assert.equal(d.reward_wallet, OWNER, 'reward_wallet must be untouched');
  assert.equal(d.is_registered, false, 'a refused request must not flip is_registered');
  assert.equal(d.email, undefined, 'a refused request must not write the caller contact details');
  assert.deepEqual(state.writes, [], 'a refused bind performs no write at all');
});

test('register: the same device is refused there too (the parity this restores)', async () => {
  seedOwnedButUnregistered();
  state.session = ATTACKER;
  const { code } = await call(registerHandler, { miner_key: KEY_OWNED_UNREG, address: ATTACKER });
  assert.equal(code, 409, 'register.ts already refuses on the bound address alone');
  assert.equal(doc(KEY_OWNED_UNREG).address, OWNER);
  assert.deepEqual(state.writes, []);
});

// -------------------------------------- (ii) the shapes that must STAY claimable
test('create: the wallet the device is already bound to still completes its own registration', async () => {
  seedOwnedButUnregistered();
  state.session = OWNER;
  const { code, body } = await call(createHandler, {
    miner_key: KEY_OWNED_UNREG,
    address: OWNER,
    ...CONTACT,
  });
  assert.equal(code, 200, 'the bound owner must still register: ' + JSON.stringify(body));
  const d = doc(KEY_OWNED_UNREG);
  assert.equal(d.is_registered, true);
  assert.equal(d.address, OWNER);
});

test('create: a device with no address and is_registered false is still claimable', async () => {
  state.writes = [];
  state.creds = [];
  state.devices = [{ miner_key: KEY_NO_ADDRESS, is_registered: false }];
  state.session = OWNER;
  const { code, body } = await call(createHandler, {
    miner_key: KEY_NO_ADDRESS,
    address: OWNER,
    ...CONTACT,
  });
  assert.equal(code, 200, 'an unbound device must stay claimable: ' + JSON.stringify(body));
  assert.equal(doc(KEY_NO_ADDRESS).address, OWNER);
  assert.equal(doc(KEY_NO_ADDRESS).is_registered, true);
});

test('create: the 485 unowned docs (is_registered true, no address) are still claimable', async () => {
  state.writes = [];
  state.creds = [];
  state.devices = [{ miner_key: KEY_NO_ADDRESS, is_registered: true }];
  state.session = OWNER;
  const { code, body } = await call(createHandler, {
    miner_key: KEY_NO_ADDRESS,
    address: OWNER,
    ...CONTACT,
  });
  assert.equal(code, 200, 'a device owned by nobody must stay claimable: ' + JSON.stringify(body));
  assert.equal(doc(KEY_NO_ADDRESS).address, OWNER);
});

test('create: an empty-string address is treated as unowned, not as a mismatch', async () => {
  state.writes = [];
  state.creds = [];
  state.devices = [{ miner_key: KEY_NO_ADDRESS, is_registered: true, address: '   ' }];
  state.session = OWNER;
  const { code, body } = await call(createHandler, {
    miner_key: KEY_NO_ADDRESS,
    address: OWNER,
    ...CONTACT,
  });
  assert.equal(code, 200, 'a blank address binds nobody: ' + JSON.stringify(body));
  assert.equal(doc(KEY_NO_ADDRESS).address, OWNER);
});
