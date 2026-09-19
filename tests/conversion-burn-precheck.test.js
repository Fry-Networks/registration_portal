const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// D3: the Dec-2024 conversion burns `account.amount` -- a value read from the stored
// `fry-conversions` snapshot, not from the chain. A wallet that has moved its FRY 1.0
// since the snapshot underflows the ASA transfer, which reaches the user as an opaque
// wallet rejection (reported: burn of 132106.63 against an on-chain balance of 0).
// The burn-build site must verify the live balance first and refuse with a readable error.
const src = fs.readFileSync(
  path.join(__dirname, '..', 'components', 'modals', 'FryConversion.tsx'),
  'utf8'
);

test('a live FRY 1.0 balance check precedes the snapshot burn', () => {
  const check = src.indexOf('/api/algorand/get-token-balance');
  const burn = src.indexOf('transferToBurn(address, account.amount)');
  assert.ok(check !== -1, 'no live balance lookup found in the conversion modal');
  assert.ok(burn !== -1, 'the snapshot burn call site is missing');
  assert.ok(
    check < burn,
    'the balance check must run BEFORE transferToBurn, otherwise the underflow still reaches the chain'
  );
});

test('an insufficient balance is refused with a readable message', () => {
  assert.match(
    src,
    /Insufficient FRY 1\.0 balance/,
    'the user must be told the balance is short, not handed a chain error'
  );
});

test('the pre-check queries FRY 1.0 specifically', () => {
  assert.match(
    src,
    /asset_id:\s*FRY_1\.id/,
    'the balance check must target the FRY 1.0 ASA constant, not a hardcoded id'
  );
});

test('a failed balance check blocks the burn rather than guessing', () => {
  assert.match(
    src,
    /Could not verify balance/,
    'an unverifiable balance must stop the burn, matching the server-side guards'
  );
});
