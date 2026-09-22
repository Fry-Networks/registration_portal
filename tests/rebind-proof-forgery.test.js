// RC1-FIX (r12, 2026-09-22) — the rebind carve-out's ownership proof must not be mintable.
//
// 22001c0 let a wallet rebind a device-wallet-clobbered registration when it equalled
// creds.hardware.address (the wallet that registered the miner key at install time). The
// adversarial review found that field is SELF-MINTABLE: pages/api/devices/save-credentials.ts
// upserts { miner_key, address: <session wallet> } into creds.hardware for any key, with no
// device-ownership check. So an attacker holding only a miner key could:
//     1. POST /api/devices/save-credentials { miner_key }   -> creates creds.hardware.address = attacker
//     2. POST /api/registrations/register   { miner_key }   -> the carve-out now "proves" ownership
// and take the device. These tests pin that sequence shut from both ends:
//   * the install record must pre-date REBIND_PROOF_CUTOFF (an ObjectId timestamp is
//     server-generated and cannot be backdated by any dashboard route), and
//   * save-credentials must refuse to write creds.hardware.address for a miner key whose
//     main.devices doc is bound to a different wallet.
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

/** An ObjectId whose embedded timestamp is exactly `iso` (the only clock these docs carry). */
const oidAt = (iso) => {
  const secs = Math.floor(Date.parse(iso) / 1000);
  return new ObjectId(secs.toString(16).padStart(8, '0') + '0123456789abcdef');
};

const pad = (s) => (s + 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA').slice(0, 58);
const OWNER = pad('SN7VBD4QOWNER');
const ATTACKER = pad('ZZATTACKERWALLET');
const DEVWALLET = pad('KYSZ5UNADEVICEWALLET');
const THIRDPARTY = pad('J2QENDSOTHIRDPARTY');

const KEY_CLOBBERED = 'FEM-CLOBBEREDKEYAAAAAAAAAAAAAAAAAAAA';

// Measured on ARES00 2026-09-22: every creds.hardware install record belonging to one of the
// 22 clobbered devices was created between 2026-06-23 and 2026-07-11.
const PRE_CUTOFF = '2026-07-05T22:51:15.000Z';
// Anything an attacker can create today.
const POST_CUTOFF = '2026-09-22T18:40:00.000Z';

// ---------------------------------------------------------------- fake Mongo
const state = { session: OWNER, devices: [], creds: [], audits: [], writes: [], beforeUpdate: null };

const matchKey = (docKey, q) => {
  if (typeof q === 'string') return docKey === q;
  if (q && typeof q.$regex === 'string') return new RegExp(q.$regex, q.$options || '').test(docKey);
  return false;
};

const devMatch = (d, f) =>
  matchKey(d.miner_key, f.miner_key) && (f.address === undefined || d.address === f.address);

const devicesCollection = {
  findOne: async (filter) => state.devices.find((d) => devMatch(d, filter)) || null,
  updateOne: async (filter, update) => {
    if (state.beforeUpdate) {
      const hook = state.beforeUpdate;
      state.beforeUpdate = null;
      hook();
    }
    state.writes.push({ filter, update });
    const doc = state.devices.find((d) => devMatch(d, filter));
    if (!doc) return { matchedCount: 0, modifiedCount: 0 };
    const before = JSON.stringify(doc);
    Object.assign(doc, update.$set || {});
    return { matchedCount: 1, modifiedCount: JSON.stringify(doc) === before ? 0 : 1 };
  },
};

const credsMatch = (c, f) => {
  if (f._id !== undefined) return String(c._id) === String(f._id);
  if (f.miner_key !== undefined && !matchKey(c.miner_key, f.miner_key)) return false;
  if (f.address !== undefined && c.address !== f.address) return false;
  return true;
};

const credsHardwareCollection = {
  find: (filter) => ({ toArray: async () => state.creds.filter((c) => credsMatch(c, filter)) }),
  findOne: async (filter) => state.creds.find((c) => credsMatch(c, filter)) || null,
  updateOne: async (filter, update, options) => {
    let doc = state.creds.find((c) => credsMatch(c, filter));
    if (!doc) {
      if (!options || !options.upsert) return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 };
      // Mongo generates the _id server-side on an upsert: the caller cannot choose it.
      doc = { _id: new ObjectId() };
      state.creds.push(doc);
    }
    Object.assign(doc, update.$set || {});
    return { matchedCount: 1, modifiedCount: 1, upsertedCount: 0 };
  },
  createIndex: async () => 'ok',
};

const auditCollection = { insertOne: async (d) => { state.audits.push(d); return { acknowledged: true }; } };

const fakeClient = {
  db: (name) => ({
    collection: (col) => {
      if (name === 'main' && (col === 'devices' || col === 'test-devices')) return devicesCollection;
      if (name === 'creds' && col === 'hardware') return credsHardwareCollection;
      if (col === 'mac_audit_logs') return auditCollection;
      return {
        find: () => ({ toArray: async () => [] }),
        findOne: async () => null,
        updateOne: async () => ({ matchedCount: 0, modifiedCount: 0 }),
        insertOne: async () => ({ acknowledged: true }),
        createIndex: async () => 'ok',
      };
    },
  }),
};

stub('next-auth', {
  __esModule: true,
  getServerSession: async () => (state.session ? { user: { address: state.session } } : null),
});
stub('../pages/api/auth/[...nextauth].ts', { __esModule: true, authOptions: {} });
stub('../lib/mongoclient', { __esModule: true, default: Promise.resolve(fakeClient) });
stub('../lib/hardwareCredentialIndexes', {
  __esModule: true,
  ensureHardwareCredentialIndexes: async () => {},
});
stub('../lib/logger', {
  __esModule: true,
  loggers: new Proxy({}, { get: () => () => {} }),
  default: new Proxy({}, { get: () => () => {} }),
});

const registerHandler = require('../pages/api/registrations/register.ts').default;
const createHandler = require('../pages/api/registrations/create.ts').default;
const saveCredentialsHandler = require('../pages/api/devices/save-credentials.ts').default;

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

const seedClobbered = ({ creds }) => {
  state.writes = [];
  state.audits = [];
  state.beforeUpdate = null;
  state.devices = [
    {
      miner_key: KEY_CLOBBERED,
      is_registered: true,
      address: DEVWALLET,
      reward_wallet: DEVWALLET,
      device_algo_address: DEVWALLET,
    },
  ];
  state.creds = creds ? [creds] : [];
};

const doc = () => state.devices.find((d) => d.miner_key === KEY_CLOBBERED);
const credsDoc = () => state.creds.find((c) => matchKey(c.miner_key, KEY_CLOBBERED));

// ---------------------------------------------------- (1) the reported bypass, end to end
test('BYPASS: minting creds.hardware.address via save-credentials must not yield the device', async () => {
  seedClobbered({ creds: null }); // the 14-of-22 shape: no install record at all
  state.session = ATTACKER;

  const mint = await call(saveCredentialsHandler, {
    miner_key: KEY_CLOBBERED,
    credentials: { note: 'attacker supplied' },
  });

  const rebind = await call(registerHandler, { miner_key: KEY_CLOBBERED, address: ATTACKER });
  assert.notEqual(
    rebind.code,
    200,
    'miner-key possession + a self-minted creds.hardware record must not rebind: ' +
      'mint=' + mint.code + ' rebind=' + JSON.stringify(rebind.body)
  );
  assert.equal(doc().address, DEVWALLET, 'the device doc must be untouched');
  assert.equal(doc().reward_wallet, DEVWALLET, 'the device doc must be untouched');
  assert.equal(doc().rebound_from, undefined, 'no rebind metadata is written on a refusal');
});

test('BYPASS (create): the same mint must not yield the device through registrations/create', async () => {
  seedClobbered({ creds: null });
  state.session = ATTACKER;
  await call(saveCredentialsHandler, { miner_key: KEY_CLOBBERED, credentials: { note: 'x' } });
  const rebind = await call(createHandler, { miner_key: KEY_CLOBBERED, address: ATTACKER, ...CONTACT });
  assert.notEqual(rebind.code, 200, 'self-minted proof must not rebind: ' + JSON.stringify(rebind.body));
  assert.equal(doc().address, DEVWALLET);
  assert.equal(doc().rebound_from, undefined);
});

// ------------------------------------------------- (2) the write side of the same hole
test('save-credentials refuses to write creds.hardware.address for a device owned by another wallet', async () => {
  seedClobbered({ creds: null });
  state.session = ATTACKER;
  const mint = await call(saveCredentialsHandler, {
    miner_key: KEY_CLOBBERED,
    credentials: { note: 'attacker supplied' },
  });
  assert.equal(mint.code, 409, 'expected the owner-mismatch refusal, got ' + JSON.stringify(mint.body));
  assert.equal(credsDoc(), undefined, 'no creds.hardware record may be created for a key this wallet does not own');
});

test('save-credentials refuses to repoint an existing addressless install record', async () => {
  // 48 of 7,556 creds.hardware docs carry no address (ARES00, 2026-09-22). Such a doc has an
  // old _id, so the cutoff alone would accept it once its address were filled in.
  seedClobbered({ creds: { _id: oidAt(PRE_CUTOFF), miner_key: KEY_CLOBBERED } });
  state.session = ATTACKER;
  const mint = await call(saveCredentialsHandler, { miner_key: KEY_CLOBBERED, credentials: { note: 'x' } });
  assert.equal(mint.code, 409, 'expected 409, got ' + JSON.stringify(mint.body));
  assert.equal(credsDoc().address, undefined, 'the install record must keep its (absent) address');
  const rebind = await call(registerHandler, { miner_key: KEY_CLOBBERED, address: ATTACKER });
  assert.notEqual(rebind.code, 200, 'and the device must stay put: ' + JSON.stringify(rebind.body));
  assert.equal(doc().address, DEVWALLET);
});

test('save-credentials still saves for the wallet that owns the device', async () => {
  seedClobbered({ creds: null });
  state.devices[0].address = OWNER;
  state.devices[0].reward_wallet = OWNER;
  state.session = OWNER;
  const save = await call(saveCredentialsHandler, { miner_key: KEY_CLOBBERED, credentials: { note: 'ok' } });
  assert.equal(save.code, 200, 'the rightful owner must still be able to save credentials: ' + JSON.stringify(save.body));
  assert.equal(credsDoc().address, OWNER);
});

test('save-credentials still saves for an unbound device (first-time registration flow)', async () => {
  // pages/register.tsx persists credentials BEFORE /api/registrations/register binds the doc,
  // so an unclaimed device must keep working.
  seedClobbered({ creds: null });
  state.devices[0].address = '';
  state.devices[0].is_registered = false;
  state.session = OWNER;
  const save = await call(saveCredentialsHandler, { miner_key: KEY_CLOBBERED, credentials: { note: 'ok' } });
  assert.equal(save.code, 200, 'an unbound device must still accept credentials: ' + JSON.stringify(save.body));
  assert.equal(credsDoc().address, OWNER);
});

// --------------------------------------------- (3) the ObjectId clock behind the gate
test('an install record created after the carve-out shipped is not an ownership proof', async () => {
  seedClobbered({ creds: { _id: oidAt(POST_CUTOFF), miner_key: KEY_CLOBBERED, address: OWNER } });
  state.session = OWNER;
  const { code, body } = await call(registerHandler, { miner_key: KEY_CLOBBERED, address: OWNER });
  assert.notEqual(code, 200, 'a record minted after the cutoff proves nothing: ' + JSON.stringify(body));
  assert.equal(doc().address, DEVWALLET);
  assert.deepEqual(state.writes, [], 'a refused rebind performs no write at all');
});

test('an install record that pre-dates the carve-out still rebinds for its wallet', async () => {
  seedClobbered({ creds: { _id: oidAt(PRE_CUTOFF), miner_key: KEY_CLOBBERED, address: OWNER } });
  state.session = OWNER;
  const { code, body } = await call(registerHandler, { miner_key: KEY_CLOBBERED, address: OWNER });
  assert.equal(code, 200, 'expected 200, got ' + code + ' ' + JSON.stringify(body));
  assert.equal(doc().address, OWNER);
  assert.equal(doc().reward_wallet, OWNER);
  assert.equal(doc().rebound_from, DEVWALLET);
});

test('an install record with no _id (and so no clock) is not an ownership proof', async () => {
  seedClobbered({ creds: { miner_key: KEY_CLOBBERED, address: OWNER } });
  state.session = OWNER;
  const { code } = await call(registerHandler, { miner_key: KEY_CLOBBERED, address: OWNER });
  assert.notEqual(code, 200, 'without a creation time there is no proof of pre-dating the clobber');
  assert.equal(doc().address, DEVWALLET);
});

// ------------------------------------- (4) the rebind write is conditional on its pre-image
test('register: a concurrent write to the device is not silently clobbered by the rebind', async () => {
  seedClobbered({ creds: { _id: oidAt(PRE_CUTOFF), miner_key: KEY_CLOBBERED, address: OWNER } });
  state.session = OWNER;
  // Between the read and the update another writer takes the doc.
  state.beforeUpdate = () => {
    const d = doc();
    d.address = THIRDPARTY;
    d.reward_wallet = THIRDPARTY;
  };
  const { code, body } = await call(registerHandler, { miner_key: KEY_CLOBBERED, address: OWNER });
  assert.notEqual(code, 200, 'the lost update must be reported, not swallowed: ' + JSON.stringify(body));
  assert.equal(doc().address, THIRDPARTY, 'the concurrent write must survive');
  assert.equal(doc().reward_wallet, THIRDPARTY, 'the concurrent write must survive');
  assert.equal(doc().rebound_from, undefined, 'no rebind metadata is written over it');
});

test('create: a concurrent write to the device is not silently clobbered by the rebind', async () => {
  seedClobbered({ creds: { _id: oidAt(PRE_CUTOFF), miner_key: KEY_CLOBBERED, address: OWNER } });
  state.session = OWNER;
  state.beforeUpdate = () => {
    const d = doc();
    d.address = THIRDPARTY;
    d.reward_wallet = THIRDPARTY;
  };
  const { code, body } = await call(createHandler, { miner_key: KEY_CLOBBERED, address: OWNER, ...CONTACT });
  assert.notEqual(code, 200, 'the lost update must be reported, not swallowed: ' + JSON.stringify(body));
  assert.equal(doc().address, THIRDPARTY, 'the concurrent write must survive');
  assert.equal(doc().rebound_from, undefined);
});

test('register: a rebind whose first attempt already landed reports success, not failure', async () => {
  // The retry the dashboard sends after a dropped response: the doc is already ours.
  seedClobbered({ creds: { _id: oidAt(PRE_CUTOFF), miner_key: KEY_CLOBBERED, address: OWNER } });
  state.session = OWNER;
  state.beforeUpdate = () => {
    const d = doc();
    d.address = OWNER;
    d.reward_wallet = OWNER;
  };
  const { code, body } = await call(registerHandler, { miner_key: KEY_CLOBBERED, address: OWNER });
  assert.equal(code, 200, 'an already-applied rebind is a success: ' + JSON.stringify(body));
  assert.equal(doc().address, OWNER);
});
