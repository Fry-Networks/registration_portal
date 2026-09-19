// Regression test (follow-up to the 2026-09-11 oneshot): the device-registration modal on
// /new_registration submitted with `method: 'PUT'` while pages/api/registrations/create.ts has been
// POST-only since 2025-10-26 (commit 59ab9bd), so every submit answered 405 INVALID_INPUT
// ("That request is not available.") and the page's primary call to action was dead.
// The modal must POST, and its payload must carry exactly the fields the route requires.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SUFFIX = process.env.RM_SOURCE_SUFFIX || '';
const read = (rel) => fs.readFileSync(path.join(ROOT, rel + SUFFIX), 'utf8').replace(/\r\n/g, '\n');
const MODAL = 'components/modals/registrations/RegistrationModal.tsx';
const ROUTE = 'pages/api/registrations/create.ts';

const createFetchBlock = (src) => {
  const i = src.indexOf("fetch('/api/registrations/create'");
  assert.ok(i > 0, 'the modal still calls /api/registrations/create');
  return src.slice(i, i + 400);
};

test('the registration modal submits to /api/registrations/create with POST', () => {
  const block = createFetchBlock(read(MODAL));
  assert.match(block, /method:\s*'POST'/);
  assert.doesNotMatch(block, /method:\s*'PUT'/);
});

test('no component sends PUT to the create route', () => {
  const src = read(MODAL);
  const puts = src.split('\n').filter((l) => /method:\s*'PUT'/.test(l));
  assert.deepEqual(puts, [], 'RegistrationModal must not contain a PUT submit');
});

test('the modal payload carries exactly the fields the route requires', () => {
  const block = createFetchBlock(read(MODAL));
  for (const field of ['names', 'email', 'miner_key', 'address']) {
    assert.match(block, new RegExp(`\\b${field}\\b`), `payload includes ${field}`);
  }
});

test('the create route is still POST-only (the contract the modal was aligned to)', () => {
  const src = read(ROUTE);
  assert.match(src, /if \(req\.method !== 'POST'\)/);
  assert.match(src, /res\.setHeader\('Allow', 'POST'\)/);
  // and it still requires the four fields the modal sends
  assert.match(src, /const \{ miner_key, names, email, address, \.\.\.rest \}/);
});
