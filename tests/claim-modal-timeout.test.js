// The claim modal could hang forever on "Paying network fee...".
//
// requestGasFee awaits signAndSubmit -> the wallet's signTransactions -> algod
// sendRawTransaction, and none of those awaits is bounded. If the wallet app never
// answers — phone asleep, WalletConnect relay dropped, user dismissed the prompt —
// the promise simply never settles. Meanwhile the Close button is disabled for the
// whole of stage 'paying-fee', so the user cannot even dismiss the dialog: it sits on
// "Paying network fee... Please wait until you see the TxID notification. Do not close
// this window" indefinitely. That is the 2026-09 screenshot report.
//
// Fix: bound every wallet await, and let the user out once it has failed.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

require('ts-node').register({
  transpileOnly: true,
  compilerOptions: { module: 'commonjs', moduleResolution: 'node', target: 'ES2017', jsx: 'react' },
});

const { withTimeout, WalletTimeoutError } = require('../lib/withTimeout');
const claimSrc = fs.readFileSync(path.join(__dirname, '..', 'components', 'modals', 'Claim.tsx'), 'utf8');

test('withTimeout rejects a promise that never settles', async () => {
  const never = new Promise(() => {});
  await assert.rejects(() => withTimeout(never, 30, 'wallet signature'), WalletTimeoutError);
});

test('withTimeout passes a value through untouched when it resolves in time', async () => {
  assert.equal(await withTimeout(Promise.resolve('txid-1'), 1000, 'x'), 'txid-1');
});

test('withTimeout preserves the original rejection rather than masking it', async () => {
  const boom = Promise.reject(new Error('user rejected'));
  await assert.rejects(() => withTimeout(boom, 1000, 'x'), /user rejected/);
});

test('withTimeout clears its timer so a resolved call cannot hold the process open', async () => {
  const before = process._getActiveHandles().length;
  await withTimeout(Promise.resolve(1), 60_000, 'x');
  assert.ok(process._getActiveHandles().length <= before,
    'the timeout timer is still active after the promise resolved');
});

test('the claim modal bounds its wallet awaits', () => {
  assert.match(claimSrc, /withTimeout\(/,
    'components/modals/Claim.tsx never calls withTimeout: the wallet awaits are unbounded');
  const feeSection = claimSrc.slice(claimSrc.indexOf('const requestGasFee'), claimSrc.indexOf('const requestGasFee') + 3000);
  assert.match(feeSection, /withTimeout\(/,
    'requestGasFee — the "Paying network fee..." path — is still unbounded');
});

test('the user can close the dialog once it has failed', () => {
  const disabledOnError = /disabled=\{[^}]*stage === 'error'[^}]*\}/.test(claimSrc);
  assert.ok(!disabledOnError, 'the close/cancel control is disabled in the error stage');
  assert.match(claimSrc, /stage === 'paying-fee'/,
    'expected the paying-fee stage to still gate the action buttons');
});
