// B24 — the verification-stake modal hung forever and the wallet was never asked.
//
// Reported behaviour: dashboard.frynetworks.com -> Devices -> My Registrations -> "Stake for
// verification"; after ONE click BOTH tier buttons read "Processing...", a toast claimed
// "Signature required — Approve the verification stake in your wallet to continue", and the wallet
// never received a request.
//
// Root cause for the hang: components/modals/StakeVerification.tsx awaited the asset-balance
// lookup, the transaction build and signAndSubmit with no time bound. algosdk's fetch has no
// timeout, and lib/algorand/withRetry.ts retries thrown errors -- it cannot rescue a promise that
// never settles, which is what a half-open WalletConnect session produces. The spinner was cleared
// only in a `finally` block, so a non-settling await left both buttons disabled and captioned
// "Processing..." indefinitely, with no error and no way back.
//
// This file pins the contract of the bound itself. lib/wallet/stakeSigning.ts is the staking
// counterpart of the cap components/SignIn.tsx already applied to sign-in (SIGN_IN_TIMEOUT_MS,
// "never leave the user on an infinite Authenticating... spinner").

const test = require('node:test');
const assert = require('node:assert/strict');

require('ts-node').register({
  transpileOnly: true,
  compilerOptions: { module: 'commonjs', moduleResolution: 'node', target: 'ES2017', jsx: 'react' },
});

const {
  MIN_FEE_HEADROOM_MICROALGO,
  STAKE_PREFLIGHT_TIMEOUT_MS,
  STAKE_SIGN_TIMEOUT_MS,
  STAKE_TIMEOUT_MESSAGES,
  StakeTimeoutError,
  describeStakeError,
  formatAlgo,
  isValidStakeAmount,
  withStakeTimeout,
} = require('../lib/wallet/stakeSigning.ts');

const never = () => new Promise(() => {});

test('a promise that never settles is rejected, not awaited forever', async () => {
  const started = Date.now();
  await assert.rejects(
    withStakeTimeout(never(), 25, 'signing'),
    (error) => {
      assert.ok(error instanceof StakeTimeoutError, 'must be a StakeTimeoutError');
      assert.equal(error.step, 'signing');
      return true;
    }
  );
  // The bound fired rather than the await hanging; the exact figure is timer slop, not a contract.
  assert.ok(Date.now() - started < 5000, 'the timeout must fire promptly');
});

test('a resolved value passes straight through', async () => {
  assert.equal(await withStakeTimeout(Promise.resolve('txid'), 5000, 'signing'), 'txid');
});

test('a real wallet rejection is propagated unchanged, not turned into a timeout', async () => {
  const walletError = new Error(
    'Confirmation Failed(4100)\nTransaction request rejected: the user has rejected the transaction request.'
  );
  await assert.rejects(
    withStakeTimeout(Promise.reject(walletError), 5000, 'signing'),
    (error) => {
      assert.equal(error, walletError);
      assert.ok(!(error instanceof StakeTimeoutError));
      return true;
    }
  );
});

test('a late rejection after the bound has fired does not surface as an unhandled rejection', async () => {
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);
  try {
    const slow = new Promise((_resolve, reject) => {
      setTimeout(() => reject(new Error('arrived too late')), 30);
    });
    await assert.rejects(withStakeTimeout(slow, 5, 'balance'), StakeTimeoutError);
    // Let the late rejection land and any unhandledRejection be dispatched.
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.deepEqual(unhandled, [], 'the abandoned promise must stay handled');
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
});

test('a timeout is explained per step, and the signing message tells the user what to do', () => {
  assert.equal(
    describeStakeError(new StakeTimeoutError('signing')),
    STAKE_TIMEOUT_MESSAGES.signing
  );
  assert.match(describeStakeError(new StakeTimeoutError('signing')), /wallet app/i);
  assert.equal(
    describeStakeError(new StakeTimeoutError('balance')),
    STAKE_TIMEOUT_MESSAGES.balance
  );
  // An unrecognised step still produces guidance rather than a raw sentinel.
  assert.equal(
    describeStakeError(new StakeTimeoutError('something-new')),
    STAKE_TIMEOUT_MESSAGES.default
  );
  assert.doesNotMatch(describeStakeError(new StakeTimeoutError('signing')), /STAKE_TIMEOUT/);
});

test("the wallet's own reason survives instead of being replaced by a generic message", () => {
  // Each of these appears verbatim in the deployed logs/error-*.json for this flow.
  for (const raw of [
    'Confirmation Failed(4100)\nTransaction request rejected: the user has rejected the transaction request.',
    'PeraWalletConnect was not initialized correctly.',
    'Session currently disconnected',
  ]) {
    const described = describeStakeError(new Error(raw));
    assert.ok(described.length > 0);
    assert.ok(raw.startsWith(described.replace(/…$/, '')) || described === raw);
  }
  assert.doesNotMatch(describeStakeError(new Error('Session currently disconnected')), /contact us/i);
});

test('an over-long or empty error is still rendered safely', () => {
  const long = describeStakeError(new Error('x'.repeat(5000)));
  assert.ok(long.length <= 161, `expected a capped message, got ${long.length} chars`);
  assert.match(long, /…$/);
  assert.equal(describeStakeError(new Error('')), 'Unknown wallet error.');
  assert.equal(describeStakeError(undefined), 'Unknown wallet error.');
  assert.equal(describeStakeError('  plain string  '), 'plain string');
});

test('only an amount that can become a real transfer is accepted', () => {
  // /api/stake-amount falls back to { stake_one: 0, stake_two: 0 }, and the BYOD branch halves
  // whatever it received, so undefined/NaN can reach the transaction builder.
  assert.equal(isValidStakeAmount(undefined), false);
  assert.equal(isValidStakeAmount(null), false);
  assert.equal(isValidStakeAmount(NaN), false);
  assert.equal(isValidStakeAmount(0), false);
  assert.equal(isValidStakeAmount(-5), false);
  assert.equal(isValidStakeAmount(Infinity), false);
  assert.equal(isValidStakeAmount('143.44'), false);
  assert.equal(isValidStakeAmount(143.44), true);
  // A halved BYOD figure stays valid.
  assert.equal(isValidStakeAmount(143.44 / 2), true);
});

test('the whole flow stays inside the 120s bound the fix requires', () => {
  // fees + balance + precheck + build preflight steps, then the signature.
  const worstCase = STAKE_PREFLIGHT_TIMEOUT_MS * 4 + STAKE_SIGN_TIMEOUT_MS;
  assert.ok(
    worstCase <= 120_000,
    `worst-case ${worstCase}ms must not exceed the 120000ms bound`
  );
  assert.ok(STAKE_SIGN_TIMEOUT_MS > 0 && STAKE_PREFLIGHT_TIMEOUT_MS > 0);
});

// -------------------------------------------------- zero spendable ALGO (the systemic funding class)
test('an account funded to exactly its min-balance has no fee headroom', () => {
  // A REAL production account: ESRI3JCC…2ZOWA, amount 1400000 == min-balance 1400000, holding
  // 1111.31 FRY 2.0 it cannot send because not one microALGO is spendable. Its stake was rejected
  // by algod AFTER the user signed it.
  const amount = 1_400_000;
  const minBalance = 1_400_000;
  const spendable = amount - minBalance;
  assert.equal(spendable, 0);
  assert.ok(spendable < MIN_FEE_HEADROOM_MICROALGO, 'must be refused before signing');

  // The guard the sibling modal uses would NOT catch this: getAlgoBalance returns the TOTAL
  // balance, so this account reports 1.4 ALGO and sails past a 0.01 ALGO buffer check.
  const totalAsGetAlgoBalanceReportsIt = amount / 1_000_000;
  assert.equal(totalAsGetAlgoBalanceReportsIt, 1.4);
  assert.ok(totalAsGetAlgoBalanceReportsIt >= 0.01, 'this is exactly the blind spot being closed');
});

test('a funded account is allowed through', () => {
  // The wallet that actually reported B24: 10588770 amount, 850000 min-balance.
  assert.ok(10_588_770 - 850_000 >= MIN_FEE_HEADROOM_MICROALGO);
});

test('the headroom threshold covers at least one minimum network fee', () => {
  assert.ok(MIN_FEE_HEADROOM_MICROALGO >= 1_000);
});

test('balances are rendered as readable ALGO, not raw microALGO', () => {
  assert.equal(formatAlgo(1_400_000), '1.4');
  assert.equal(formatAlgo(0), '0');
  assert.equal(formatAlgo(10_588_770), '10.58877');
});
