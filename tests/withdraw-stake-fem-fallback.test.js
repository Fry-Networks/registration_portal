// Regression test for Discord Bug 5 (dashfix-20260806-batch2): a FEM device with an
// active verification stake but verified:false shows "Verification Withdraw" (label
// uses DeviceListItem isStaked()'s FEM staked fallback) yet handleWithdrawStake
// opened the STAKE modal because it only branched on device.verified.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..', 'pages', 'devices.tsx');
const src = () => fs.readFileSync(SRC, 'utf8');
const handler = () => {
  const m = src().match(/const handleWithdrawStake = \(device: Device\): void => \{([\s\S]*?)\n  \};/);
  assert.ok(m, 'handleWithdrawStake not found');
  return m[1];
};

test('FEM staked-exempt fallback opens withdraw before the unverified stake branch', () => {
  const h = handler();
  const femIdx = h.indexOf('femVerificationExempt && device?.staked?.time');
  const unverIdx = h.indexOf('if (!device.verified)');
  assert.ok(femIdx !== -1, 'FEM staked fallback missing from handleWithdrawStake');
  assert.ok(unverIdx !== -1, 'unverified branch missing');
  assert.ok(femIdx < unverIdx, 'FEM fallback must run before the unverified stake branch');
  assert.match(h.slice(femIdx, femIdx + 200), /openModal\('withdraw'\)/);
});

test('legacy FRY1 stake check remains the first branch', () => {
  const h = handler();
  const legacyIdx = h.indexOf('isLegacyVerificationStake(device)');
  const femIdx = h.indexOf('femVerificationExempt');
  assert.ok(legacyIdx !== -1, 'legacy check missing');
  assert.ok(femIdx !== -1, 'FEM fallback missing');
  assert.ok(legacyIdx < femIdx, 'legacy check must precede FEM fallback');
});

test('unverified non-exempt devices still get the stake modal', () => {
  const h = handler();
  const unver = h.slice(h.indexOf('if (!device.verified)'));
  assert.match(unver, /setStakeContext\('verification'\)/);
  assert.match(unver, /openModal\('stake'\)/);
});
