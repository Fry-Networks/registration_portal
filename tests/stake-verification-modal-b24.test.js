// B24 — verification-stake modal: stuck on "Processing...", wallet never prompted.
//
// Reported: dashboard.frynetworks.com -> Devices -> My Registrations -> "Stake for verification".
// After ONE click BOTH tier buttons read "Processing...", a toast said "Signature required —
// Approve the verification stake in your wallet to continue", and the wallet never received a
// request. The device row already showed "Verified".
//
// Three separate defects produced that one report, and this file pins all three plus the two
// wasted-signature guards the hardened sibling modal already had:
//
//   (1) ONE shared `isLoading` boolean drove BOTH tier button captions, so a single click
//       captioned both "Processing...".
//   (2) The "Signature required" toast was the FIRST statement of sendTransaction, ahead of the
//       balance lookup, the opt-in and the transaction build. Any failure in that window told the
//       user to approve a request that had never been sent — exactly the reported contradiction.
//   (3) Nothing on the path was time bounded, so a non-settling await (a half-open WalletConnect
//       session) left the spinner up forever; see tests/stake-signing-bounded-b24.test.js.
//
// Assertions are made against the source text because that is how this repo's component
// regressions are pinned (see tests/withdraw-stake-fem-fallback.test.js, which likewise asserts
// branch ORDER inside a named handler).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const MODAL = path.join(__dirname, '..', 'components', 'modals', 'StakeVerification.tsx');
const PAGE = path.join(__dirname, '..', 'pages', 'my_registrations.tsx');

const modal = () => fs.readFileSync(MODAL, 'utf8');
const page = () => fs.readFileSync(PAGE, 'utf8');

const body = (src, signature, label) => {
  const m = src.match(signature);
  assert.ok(m, `${label} not found`);
  return m[1];
};

const sendTransaction = () =>
  body(
    modal(),
    /const sendTransaction = async \(from: string, to: string, amount: number\) => \{([\s\S]*?)\n    \};/,
    'sendTransaction'
  );

const handleStake = () =>
  body(modal(), /const handleStake = async \(type: StakeTier\) => \{([\s\S]*?)\n    \};/, 'handleStake');

// ----------------------------------------------------------------- defect 1: shared spinner
test('only the clicked tier is captioned Processing', () => {
  const src = modal();
  assert.match(src, /pendingTier === 'one' \? 'Processing\.\.\.'/);
  assert.match(src, /pendingTier === 'two' \? 'Processing\.\.\.'/);
  // The shared boolean that captioned both buttons must be gone.
  assert.doesNotMatch(src, /isLoading \? 'Processing\.\.\.'/);
  assert.doesNotMatch(src, /\bsetIsLoading\b/);
});

test('an in-flight stake still disables BOTH buttons, so a second tier cannot be started', () => {
  const src = modal();
  const disabled = src.match(/disabled=\{pendingTier !== null \|\| paid \|\| FRYamount\.stake_(one|two) === 0\}/g);
  assert.ok(disabled && disabled.length === 2, 'both tier buttons must be disabled while one is in flight');
});

test('the spinner is always cleared, including on an early return', () => {
  assert.match(handleStake(), /finally \{\s*setPendingTier\(null\);\s*\}/);
});

// ------------------------------------------------- defect 2: toast fired before the wallet call
test('the Signature required toast comes AFTER the transaction is built', () => {
  const b = sendTransaction();
  const toastIdx = b.indexOf("heading: 'Signature required'");
  const buildIdx = b.indexOf('buildAssetTransferTxn');
  assert.ok(toastIdx !== -1, 'the Signature required toast is missing');
  assert.ok(buildIdx !== -1, 'the transaction build is missing');
  assert.ok(
    buildIdx < toastIdx,
    'the toast must not claim a signature is required before the transaction exists'
  );
});

test('the Signature required toast comes BEFORE the wallet is asked to sign', () => {
  const b = sendTransaction();
  const toastIdx = b.indexOf("heading: 'Signature required'");
  const signIdx = b.indexOf('signAndSubmit(');
  assert.ok(signIdx !== -1, 'signAndSubmit is missing');
  assert.ok(toastIdx < signIdx, 'the user must be told to approve before the prompt is raised');
});

test('the balance lookup and the opt-in both precede the toast', () => {
  const b = sendTransaction();
  const toastIdx = b.indexOf("heading: 'Signature required'");
  assert.ok(b.indexOf('getStakeAssetBalance') < toastIdx, 'balance lookup must precede the toast');
  assert.ok(b.indexOf('requestAssetOptIn()') < toastIdx, 'the opt-in must precede the toast');
});

// ------------------------------------------------------------- defect 3: nothing was bounded
test('every awaited step before the signature is time bounded', () => {
  const b = sendTransaction();
  for (const step of ['fees', 'balance', 'precheck', 'build']) {
    assert.ok(
      new RegExp(`STAKE_PREFLIGHT_TIMEOUT_MS,\\s*\\n\\s*'${step}'`).test(b),
      `the ${step} step must be wrapped in withStakeTimeout`
    );
  }
});

test('the signature itself is time bounded', () => {
  assert.match(sendTransaction(), /STAKE_SIGN_TIMEOUT_MS,\s*\n\s*'signing'/);
});

test('the opt-in signature is bounded too, not just the stake signature', () => {
  const optIn = body(
    modal(),
    /const requestAssetOptIn = useCallback\(([\s\S]*?)\n        \[activeAddress/,
    'requestAssetOptIn'
  );
  assert.match(optIn, /withStakeTimeout\(/);
  assert.match(optIn, /STAKE_SIGN_TIMEOUT_MS/);
});

// ------------------------------------------- specific errors instead of one "contact us" callout
test('the unactionable catch-all callout is gone', () => {
  const src = modal();
  assert.doesNotMatch(src, /Error sending transaction\. Please contact us before trying again!/);
  assert.doesNotMatch(src, /updateSuccess === "error"/);
});

test('the real reason is rendered in the modal', () => {
  const src = modal();
  assert.match(src, /\{errorMessage\}/);
  assert.match(src, /setErrorMessage\(describeStakeError\(error\)\)/);
});

test('a stake that was sent but not recorded tells the user its transaction id', () => {
  const h = handleStake();
  const idx = h.indexOf('Your transaction id is');
  assert.ok(idx !== -1, 'the txId must be surfaced when the server write fails after signing');
  assert.match(h.slice(idx - 400, idx + 200), /\$\{txId\}/);
});

// ------------------------------------------------- do not spend a signature the server will refuse
test('the rate-limit precheck runs before the signature, as in the hardened sibling modal', () => {
  const b = sendTransaction();
  const precheckIdx = b.indexOf("'/api/stake/precheck'");
  const signIdx = b.indexOf('signAndSubmit(');
  assert.ok(precheckIdx !== -1, 'the /api/stake/precheck guard is missing');
  assert.ok(precheckIdx < signIdx, 'the precheck must run before the wallet is asked to sign');
  assert.match(b, /context: 'verification'/);
});

test('a wallet with no spendable ALGO is refused before signing, not after', () => {
  const b = sendTransaction();
  const feeGuard = b.indexOf('MIN_FEE_HEADROOM_MICROALGO');
  const signIdx = b.indexOf('signAndSubmit(');
  assert.ok(feeGuard !== -1, 'the fee-headroom guard is missing');
  assert.ok(feeGuard < signIdx, 'fee headroom must be checked before the wallet is asked to sign');
  // Spendable, not total: a min-balance-funded account reports a healthy total.
  assert.match(b, /funding\.spendableMicros < MIN_FEE_HEADROOM_MICROALGO/);
  assert.match(b, /no spendable ALGO for network fees/);
  // Asserted against a CALL, not the bare identifier, so the comment naming the helper this
  // deliberately does not use does not trip the test.
  assert.doesNotMatch(b, /await getAlgoBalance\(|getAlgoBalance\(from\)/);
});

test('an insufficient balance is refused before signing, not after', () => {
  const b = sendTransaction();
  const balanceGuard = b.indexOf('stakeBalance < amount');
  const signIdx = b.indexOf('signAndSubmit(');
  assert.ok(balanceGuard !== -1, 'the balance sufficiency guard is missing');
  assert.ok(balanceGuard < signIdx, 'the balance must be checked before the wallet is asked to sign');
  assert.match(b, /You need at least \$\{amount\} FRY 2\.0 to stake/);
});

// ------------------------------------------------------------------ the amount, and the price gate
test('the amount is validated before a transaction is built', () => {
  const h = handleStake();
  const guard = h.indexOf('isValidStakeAmount(amountToStake)');
  const send = h.indexOf('sendTransaction(');
  assert.ok(guard !== -1, 'the amount guard is missing');
  assert.ok(guard < send, 'the amount must be validated before the transfer is attempted');
});

test('staking no longer depends on a price feed it never used', () => {
  // /api/stake-amount returns product.reward.stake verbatim -- its USD/price division is commented
  // out -- so getFRYPrice() was a gate on a value this flow never applied, and a Vestige or
  // CoinGecko outage (lib/price.ts returns 0.0 on failure) blocked staking with no explanation.
  // Asserted against the import and the call rather than the bare identifier, so the comment in
  // the source that explains WHY the gate was dropped does not trip this test.
  const src = modal();
  assert.doesNotMatch(src, /^import .*from '\.\.\/\.\.\/lib\/price';$/m);
  assert.doesNotMatch(src, /await getFRYPrice\(/);
  assert.doesNotMatch(src, /!FRYPrice/);
});

test('the staking asset is still FRY 2.0 and the stake address is unchanged', () => {
  const src = modal();
  assert.match(src, /const FRY_VERIFICATION_ASSET_ID = FRY_2\.id;/);
  assert.match(
    src,
    /const STAKE_ADDRESS = 'UKVAN7ORIUX7Y6QJFYQ4YGQAZD3RAC7QTDB73S2E5MSILUWAA7FJ6N7WLU';/
  );
  // The amount is handed over in whole units; lib/wallet/transactions.ts converts with the asset's
  // 6 decimals. Passing useRawAmount here would under-send by a factor of 1e6.
  assert.doesNotMatch(sendTransaction(), /useRawAmount/);
});

// --------------------------------------------------------- already-"Verified" devices are explained
test('an already-verified device is told what the stake adds rather than being blocked', () => {
  const src = modal();
  assert.match(src, /alreadyVerified\?: boolean/);
  assert.match(src, /\{alreadyVerified && \(/);
  const idx = src.indexOf('{alreadyVerified && (');
  const block = src.slice(idx, idx + 600);
  assert.match(block, /already marked verified/i);
  assert.match(block, /Withdraw stake/);
  // The tier buttons must NOT be gated on it: the device card routes verification-exempt FEM
  // devices to this page precisely so they can stake (tests/device-stake-hint.test.js).
  assert.doesNotMatch(src, /disabled=\{[^}]*alreadyVerified/);
});

test('the page passes the device verification state into the modal', () => {
  assert.match(
    page(),
    /<StakeVerification\s+modalName="stakeVerification"[^>]*alreadyVerified=\{!!currentDevice\?\.verified\}/
  );
});

test('the page still decides Withdraw-vs-Verify on verified AND staked', () => {
  // Unchanged behaviour, pinned so the explainer above is never mistaken for a gating change.
  const matches = page().match(/device\.verified && device\.staked \? \(/g);
  assert.ok(matches && matches.length === 2, 'both the table and card menus must keep this gate');
});
