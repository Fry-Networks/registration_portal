// Regression test (2026-09-14 oneshot): a device with is_registered:true and NO address is
// owned by nobody, yet pages/api/registrations/register.ts refused it with ALREADY_REGISTERED,
// so it could never be claimed by anyone. Measured 485 such devices in main.devices (all FEM,
// 482 of them created 2026-05) on 2026-09-14. The owner-mismatch gate above it short-circuits
// on a falsy address, so an unowned device fell straight through to the ALREADY_REGISTERED
// refusal. The is_registered gate must therefore also require an existing owner.
//
// RED/GREEN: run with RR_SOURCE_SUFFIX=.bak.<ts> to read the pre-fix backup (must FAIL).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SUFFIX = process.env.RR_SOURCE_SUFFIX || '';
const ROUTE = 'pages/api/registrations/register.ts';
const read = (rel) => fs.readFileSync(path.join(ROOT, rel + SUFFIX), 'utf8').replace(/\r\n/g, '\n');

const gateCondition = (src) => {
  const m = src.match(/if \(([^)]*exists\.is_registered[^)]*)\) \{/);
  assert.ok(m, 'the is_registered gate still exists in the route');
  return m[1];
};

test('an unowned device is not refused as ALREADY_REGISTERED', () => {
  const cond = gateCondition(read(ROUTE));
  assert.match(
    cond,
    /exists\.address/,
    'is_registered gate must also require an owner, else a device with no address is unclaimable by anyone'
  );
});

test('owner-mismatch is still checked before ALREADY_REGISTERED', () => {
  const src = read(ROUTE);
  const mismatch = src.indexOf('deviceOwnerMismatch');
  const already = src.indexOf('ALREADY_REGISTERED');
  assert.ok(mismatch > 0, 'owner-mismatch gate present');
  assert.ok(already > 0, 'ALREADY_REGISTERED gate present');
  assert.ok(mismatch < already, 'a device owned by someone else must still 409 before any 400');
});

test('a successful registration still binds both is_registered and address', () => {
  const src = read(ROUTE);
  assert.match(src, /is_registered:\s*true/, 'sets is_registered');
  assert.match(src, /address:\s*address/, 'binds the wallet address');
});
