// Regression test for the IOT- -> FEM- findability mapping (oneshot4-20260923T182503Z).
//
// Old IOT- boards were reissued as FEM- devices; the physical label on the board still reads
// IOT-<hex>. An owner typing that legacy key into the Devices page's "register/find" box (see
// pages/devices.tsx handleRegister -> GET /api/devices/${key}) got "Miner key not found" even
// though their FEM- twin already exists. This is lookup/input normalisation ONLY: it grants no
// ownership, flips no reward/eligibility/claim flag, and does not touch any auth path -- an
// IOT--announcing board must still fail to authenticate (a guard test elsewhere enforces that;
// this change is nowhere near it).

const test = require('node:test');
const assert = require('node:assert/strict');

require('ts-node').register({
  transpileOnly: true,
  compilerOptions: { module: 'commonjs', moduleResolution: 'node', target: 'ES2017', jsx: 'react' },
});

// ---------------------------------------------------------------- pure function

const { remapLegacyMinerKey } = require('../lib/minerKey.ts');

test('an uppercase-hex IOT- key resolves to its FEM- twin', () => {
  const hex = '0123456789ABCDEF0123456789ABCDEF';
  assert.equal(remapLegacyMinerKey(`IOT-${hex}`), `FEM-${hex}`);
});

test('a base36-shaped IOT- body (letters past F) is left untouched', () => {
  const base36 = 'GHIJKLMNOPQRSTUVWXYZ0123456789AB'; // contains G-Z, not hex
  assert.equal(remapLegacyMinerKey(`IOT-${base36}`), `IOT-${base36}`);
});

test('a lowercase-hex IOT- body is left untouched (uppercase hex only, per ruling)', () => {
  const lower = '0123456789abcdef0123456789abcdef';
  assert.equal(remapLegacyMinerKey(`IOT-${lower}`), `IOT-${lower}`);
});

test('a non-IOT prefix is left untouched', () => {
  const hex = '0123456789ABCDEF0123456789ABCDEF';
  assert.equal(remapLegacyMinerKey(`FEM-${hex}`), `FEM-${hex}`);
  assert.equal(remapLegacyMinerKey(`AEM-${hex}`), `AEM-${hex}`);
});

test('a wrong-length body is left untouched', () => {
  assert.equal(remapLegacyMinerKey('IOT-0123456789ABCDEF'), 'IOT-0123456789ABCDEF');
});

test('malformed input never throws and passes through unchanged', () => {
  assert.equal(remapLegacyMinerKey(''), '');
  assert.equal(remapLegacyMinerKey('not-a-key'), 'not-a-key');
});

// ---------------------------------------------------------------- handler wiring (outcome-based)

const ADDR = 'SYNTHWALLETIOT7AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const HEX = 'FEDCBA9876543210FEDCBA9876543210';
const FEM_KEY = `FEM-${HEX}`;
const IOT_KEY = `IOT-${HEX}`;

const stub = (relPath, exports) => {
  const resolved = require.resolve(relPath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
};

function fakeDeviceClient(devicesByKey) {
  return {
    db: () => ({
      collection: () => ({
        findOne: async (query) => devicesByKey[query.miner_key] || null,
        updateOne: async () => ({ matchedCount: 0, modifiedCount: 0 }),
      }),
    }),
  };
}

stub('next-auth', { __esModule: true, getServerSession: async () => ({ user: { address: ADDR } }) });
stub('../pages/api/auth/[...nextauth].ts', { __esModule: true, authOptions: {} });
stub('../lib/deviceActivity', {
  __esModule: true,
  TRACKED_PREFIXES: ['FEM'],
  computeActiveSet: async () => new Set(),
  getRewardEligibility: async () => new Map(),
});
stub('../lib/devicePosition', {
  __esModule: true,
  hydrateDeviceWithPosition: async (_client, device) => device,
});

const devices = {
  [FEM_KEY]: { miner_key: FEM_KEY, address: ADDR, is_registered: true, verified: true },
};

stub('../lib/mongoclient', { __esModule: true, default: Promise.resolve(fakeDeviceClient(devices)) });

const minerKeyHandler = require('../pages/api/devices/[miner_key].ts').default;

const callHandler = async (minerKeyParam) => {
  const captured = { code: 0, body: null };
  const res = {
    status(c) { captured.code = c; return res; },
    json(b) { captured.body = b; return res; },
  };
  await minerKeyHandler({ method: 'GET', headers: {}, query: { miner_key: minerKeyParam }, body: {} }, res);
  return captured;
};

test('typing the legacy IOT- key finds the existing FEM- device instead of 404ing', async () => {
  const { code, body } = await callHandler(IOT_KEY);
  assert.equal(code, 200, `expected the IOT- key to resolve to its FEM- twin, got ${code} ${JSON.stringify(body)}`);
  assert.equal(body?.device?.is_registered, true);
});

test('the unresolved IOT- key is not itself a real device in the fixture (sanity control)', () => {
  // Proves the 200 above comes from the remap, not from IOT_KEY happening to already be a key
  // present in the fixture.
  assert.equal(devices[IOT_KEY], undefined);
});

test('a real FEM- key is unaffected by the remap (still looked up directly)', async () => {
  const { code, body } = await callHandler(FEM_KEY);
  assert.equal(code, 200);
  assert.equal(body?.device?.is_registered, true);
});

test('an IOT- key with a base36 body is NOT remapped and still 404s (no matching device)', async () => {
  const base36 = 'GHIJKLMNOPQRSTUVWXYZ0123456789AB';
  const { code } = await callHandler(`IOT-${base36}`);
  assert.equal(code, 404, 'a base36-shaped IOT- key must not be remapped');
});
