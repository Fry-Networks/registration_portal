// Regression test for the forced sign-out during wallet rehydration (completion run 1785362343).
// Pre-fix, components/SignIn.tsx signed the user out whenever the connected wallet address was
// falsy while NextAuth reported 'authenticated'. @txnlab/use-wallet-react resumes a Pera/
// WalletConnect session asynchronously, so activeAddress is null until isReady flips true —
// every authenticated user landing on the sign-in page was force-signed-out mid-rehydration.
const assert = require('node:assert/strict');
const test = require('node:test');

const { shouldForceSignOut } = require('../lib/wallet/sessionGuard.js');

const SESSION = 'SYNTHWALLETL6AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const OTHER = 'E2F2LT2INE75DBOYHQXTCTOP2PAP5MHAXQRXTTCCXFKHQTVG36DJONBQZE';

test('a wallet provider still rehydrating never forces a sign-out', () => {
  assert.equal(
    shouldForceSignOut({ status: 'authenticated', sessionAddress: SESSION, connectedAddress: null, walletReady: false }),
    false
  );
});

test('a ready provider with no connected wallet still forces a sign-out', () => {
  assert.equal(
    shouldForceSignOut({ status: 'authenticated', sessionAddress: SESSION, connectedAddress: null, walletReady: true }),
    true
  );
});

test('a genuine wallet mismatch always forces a sign-out', () => {
  assert.equal(
    shouldForceSignOut({ status: 'authenticated', sessionAddress: SESSION, connectedAddress: OTHER, walletReady: true }),
    true
  );
  assert.equal(
    shouldForceSignOut({ status: 'authenticated', sessionAddress: SESSION, connectedAddress: OTHER, walletReady: false }),
    true
  );
});

test('a matching wallet never forces a sign-out', () => {
  assert.equal(
    shouldForceSignOut({ status: 'authenticated', sessionAddress: SESSION, connectedAddress: SESSION, walletReady: true }),
    false
  );
});

test('an unauthenticated or session-less state never forces a sign-out', () => {
  for (const status of ['loading', 'unauthenticated']) {
    assert.equal(
      shouldForceSignOut({ status, sessionAddress: SESSION, connectedAddress: null, walletReady: true }),
      false,
      `expected status ${status} not to sign out`
    );
  }
  assert.equal(
    shouldForceSignOut({ status: 'authenticated', sessionAddress: null, connectedAddress: null, walletReady: true }),
    false
  );
});

test('an address object compares by value, not by identity', () => {
  const asObject = { toString: () => SESSION };
  assert.equal(
    shouldForceSignOut({ status: 'authenticated', sessionAddress: SESSION, connectedAddress: asObject, walletReady: true }),
    false
  );
  const otherObject = { toString: () => OTHER };
  assert.equal(
    shouldForceSignOut({ status: 'authenticated', sessionAddress: SESSION, connectedAddress: otherObject, walletReady: true }),
    true
  );
});
