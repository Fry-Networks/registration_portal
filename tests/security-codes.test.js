// Regression test for the forced sign-out on a retryable fingerprint refresh (final run 1785265900).
// Pre-fix, pages/devices.tsx and pages/history.tsx treated DEVICE_FINGERPRINT_REFRESH — the code the
// server pairs with "Please retry the request." — as a security breach and called signOut(), so a
// routine fingerprint rotation logged the user out and dropped them back on the Connect Wallet gate.
const assert = require('node:assert/strict');
const test = require('node:test');

const {
  isSecurityBlockCode,
  isRetryableSecurityCode
} = require('../lib/api/securityCodes.js');

test('a fingerprint refresh is retryable, never a sign-out', () => {
  assert.equal(isSecurityBlockCode('DEVICE_FINGERPRINT_REFRESH'), false);
  assert.equal(isRetryableSecurityCode('DEVICE_FINGERPRINT_REFRESH'), true);
});

test('a device mismatch still blocks', () => {
  assert.equal(isSecurityBlockCode('DEVICE_MISMATCH'), true);
  assert.equal(isRetryableSecurityCode('DEVICE_MISMATCH'), false);
});

test('unrelated and missing codes never block', () => {
  for (const code of ['MISSING_CLIENT_TOKEN', 'INVALID_SIGNATURE', 'EXPIRED_TIMESTAMP', '', undefined, null]) {
    assert.equal(isSecurityBlockCode(code), false, `expected ${String(code)} not to block`);
  }
});

test('the two classes never overlap', () => {
  const { BLOCKING_SECURITY_CODES, RETRYABLE_SECURITY_CODES } = require('../lib/api/securityCodes.js');
  for (const code of BLOCKING_SECURITY_CODES) {
    assert.equal(RETRYABLE_SECURITY_CODES.has(code), false, `${code} cannot be both`);
  }
});

test('a batch failure that can recover never fans out per device', () => {
  const { shouldFallBackPerDevice } = require('../lib/api/securityCodes.js');
  // The exact shapes observed live: a fingerprint refresh, the limiter, and a reset connection.
  assert.equal(shouldFallBackPerDevice({ status: 409, code: 'DEVICE_FINGERPRINT_REFRESH' }), false);
  assert.equal(shouldFallBackPerDevice({ status: 429 }), false);
  assert.equal(shouldFallBackPerDevice({ status: 503, code: 'NETWORK_ERROR' }), false);
  assert.equal(shouldFallBackPerDevice({ status: 500 }), false);
  assert.equal(shouldFallBackPerDevice({}), false);
  assert.equal(shouldFallBackPerDevice(null), false);
});

test('a batch failure that cannot recover still falls back per device', () => {
  const { shouldFallBackPerDevice } = require('../lib/api/securityCodes.js');
  assert.equal(shouldFallBackPerDevice({ status: 400 }), true);
  assert.equal(shouldFallBackPerDevice({ status: 404 }), true);
  assert.equal(shouldFallBackPerDevice({ status: 403, code: 'DEVICE_MISMATCH' }), true);
});
