// RC8: "Start Conversion" reported an error window with no way to act on it.
// components/modals/PostSnapshotConversion.tsx and components/modals/FryConversion.tsx
// rendered ONE generic "Network error ..." toast for every non-ok response, so a missing
// conversion account (404), a wallet/session mismatch (401), an ineligible wallet (403)
// and a transient algod failover failure (503) were indistinguishable to the user and to
// support. conversionErrorMessage(status, code) is the pure mapping behind actionable copy.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

require('ts-node').register({
  transpileOnly: true,
  compilerOptions: { module: 'commonjs', moduleResolution: 'node', target: 'ES2017', jsx: 'react' },
});

const {
  conversionErrorMessage,
  shouldRetryConversionRead,
} = require('../lib/conversionErrors.ts');

// ------------------------------------------------------------------ status mapping
test('404 names the missing conversion account instead of the network', () => {
  const copy = conversionErrorMessage(404, 'DEVICE_NOT_FOUND');
  assert.match(copy.message, /conversion account/i);
  assert.doesNotMatch(copy.message, /network error/i);
  assert.ok(copy.heading && copy.heading.length > 0);
});

test('401 tells the user the connected wallet does not match the session', () => {
  const copy = conversionErrorMessage(401, 'WALLET_MISMATCH');
  assert.match(copy.message, /wallet/i);
  assert.match(copy.message, /session/i);
  assert.doesNotMatch(copy.message, /network error/i);
});

test('401 without a code still yields the wallet-mismatch copy', () => {
  const copy = conversionErrorMessage(401);
  assert.match(copy.message, /wallet/i);
  assert.match(copy.message, /session/i);
});

test('401 SESSION_REQUIRED asks the user to sign in again', () => {
  const copy = conversionErrorMessage(401, 'SESSION_REQUIRED');
  assert.match(copy.message, /sign in/i);
});

test('403 states the wallet is not eligible', () => {
  const copy = conversionErrorMessage(403, 'FORBIDDEN');
  assert.match(copy.heading, /eligible/i);
  assert.match(copy.message, /eligible/i);
  assert.doesNotMatch(copy.message, /network error/i);
});

test('503 is presented as a temporary on-chain lookup failure, not a user mistake', () => {
  const copy = conversionErrorMessage(503, 'NETWORK_ERROR');
  assert.match(copy.message, /on-chain|balance|chain/i);
  assert.match(copy.message, /try again|temporar/i);
});

test('an unmapped status falls back to a generic message', () => {
  const copy = conversionErrorMessage(500, 'INTERNAL_ERROR');
  assert.ok(copy.heading && copy.message);
  const unknown = conversionErrorMessage(418, 'TEAPOT');
  assert.deepEqual(unknown, copy, 'every unmapped status shares one generic fallback');
});

test('a missing status still returns usable copy rather than throwing', () => {
  const copy = conversionErrorMessage(undefined, undefined);
  assert.ok(copy.heading && copy.message);
});

test('each mapped status produces distinct copy', () => {
  const messages = [404, 401, 403, 503, 500].map(
    (s) => conversionErrorMessage(s).message
  );
  assert.equal(new Set(messages).size, messages.length, 'statuses must not share one toast');
});

// ------------------------------------------------------------------ retry policy
test('only 503 is retried, and only once', () => {
  assert.equal(shouldRetryConversionRead(503), true);
  assert.equal(shouldRetryConversionRead(500), false);
  assert.equal(shouldRetryConversionRead(404), false);
  assert.equal(shouldRetryConversionRead(401), false);
  assert.equal(shouldRetryConversionRead(403), false);
  assert.equal(shouldRetryConversionRead(200), false);
  assert.equal(shouldRetryConversionRead(undefined), false);
});

// ------------------------------------------------------------------ call sites
const readSrc = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');

test('both conversion modals use the helper instead of a hardcoded network toast', () => {
  for (const file of [
    ['components', 'modals', 'PostSnapshotConversion.tsx'],
    ['components', 'modals', 'FryConversion.tsx'],
  ]) {
    const src = readSrc(...file);
    assert.match(src, /conversionErrorMessage/, `${file.join('/')} does not use the helper`);
    assert.doesNotMatch(
      src,
      /message: 'Network error fetching post-snapshot status'/,
      `${file.join('/')} still renders the generic post-snapshot toast`
    );
    assert.doesNotMatch(
      src,
      /message: 'Network error to get account status for conversion'/,
      `${file.join('/')} still renders the generic account-status toast`
    );
  }
});

test('the toast log payload carries the status and the code', () => {
  for (const file of [
    ['components', 'modals', 'PostSnapshotConversion.tsx'],
    ['components', 'modals', 'FryConversion.tsx'],
  ]) {
    const src = readSrc(...file);
    assert.match(src, /metadata:\s*\{[^}]*status/s, `${file.join('/')} does not log the status`);
    assert.match(src, /metadata:\s*\{[^}]*code/s, `${file.join('/')} does not log the code`);
  }
});

test('the single 503 retry is on the idempotent read only, never on a submit', () => {
  const post = readSrc('components', 'modals', 'PostSnapshotConversion.tsx');
  assert.match(post, /shouldRetryConversionRead/, 'the post-snapshot read has no retry');
  // the burn-submit and claim-submit calls must stay single-shot
  const submitCalls = ['set_post_snapshot', 'transfer_post_snapshot'];
  for (const endpoint of submitCalls) {
    const idx = post.indexOf(endpoint);
    assert.ok(idx !== -1, `${endpoint} call site missing`);
    const window = post.slice(idx, idx + 1200);
    assert.doesNotMatch(
      window,
      /shouldRetryConversionRead|retryOnce|attempt < /,
      `${endpoint} must never be retried automatically`
    );
  }
  const fry = readSrc('components', 'modals', 'FryConversion.tsx');
  for (const endpoint of ['set_fry_conversion', 'transfer_reward', 'reconcile_burn']) {
    const idx = fry.indexOf(endpoint);
    assert.ok(idx !== -1, `${endpoint} call site missing`);
    const window = fry.slice(idx, idx + 1200);
    assert.doesNotMatch(
      window,
      /shouldRetryConversionRead|retryOnce|attempt < /,
      `${endpoint} must never be retried automatically`
    );
  }
});
