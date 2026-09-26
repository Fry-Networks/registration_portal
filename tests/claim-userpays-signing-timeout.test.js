// The claim modal's user-pays confirm-leg signature could hang forever, the same way
// requestGasFee's "Paying network fee..." used to (see tests/claim-modal-timeout.test.js and
// lib/withTimeout.ts).
//
// mode:"user_pays" is a separate, feature-flagged branch: by the time it runs, the server has
// already POSTed a successful /api/rewards/claim, which means it has already reserved the reward
// rows and minted a pending-claim envelope (pages/api/rewards/claim.ts reserveRows). The
// predecessor's fix bounded requestGasFee's signAndSubmit and the opt-in's signAndSubmit, but
// never touched this branch's signTransactions call -- confirmed by re-reading the predecessor's
// own test, whose "the claim modal bounds its wallet awaits" assertion only slices the
// requestGasFee function body. If the wallet never answers here, the dialog sits on
// stage:'submitting' (Close disabled) forever, and -- unlike the fee-payment path -- nothing
// detects or prevents a second charge, so telling the user it's safe to retry would be false: a
// retry just reserves a fresh batch of rows while this one stays stuck (oneshot4-20260923T182503Z,
// B3).
//
// Fix: bound the confirm-leg signTransactions call the same way, and give a genuine timeout its
// own honest copy -- not the fee-payment message's "we will detect it and not charge you twice"
// claim, which is untrue on this path.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

require('ts-node').register({
  transpileOnly: true,
  compilerOptions: { module: 'commonjs', moduleResolution: 'node', target: 'ES2017', jsx: 'react' },
});

const claimSrc = fs.readFileSync(path.join(__dirname, '..', 'components', 'modals', 'Claim.tsx'), 'utf8');

const userPaysAnchor = "result.mode === 'user_pays'";
const userPaysStart = claimSrc.indexOf(userPaysAnchor);

test('the user_pays branch is present (anchor sanity check)', () => {
  assert.notEqual(userPaysStart, -1, 'components/modals/Claim.tsx no longer has a user_pays branch');
});

const userPaysSection = claimSrc.slice(userPaysStart, userPaysStart + 4500);

test('the claim modal bounds the user-pays confirm-leg wallet signature', () => {
  assert.match(userPaysSection, /withTimeout\(/,
    'the user-pays confirm-leg signTransactions call is still unbounded');
  assert.match(userPaysSection, /WALLET_SIGN_TIMEOUT_MS/,
    'the confirm-leg wrap does not use the shared wallet-sign timeout constant');
});

test('a hung confirm-leg signature is distinguished from an ordinary signing failure', () => {
  assert.match(userPaysSection, /WalletTimeoutError/,
    'the catch block never checks for WalletTimeoutError, so a hang and a rejection get the same message');
});

test('the timeout message tells the user not to retry and gives a support reference', () => {
  assert.match(userPaysSection, /do not click claim all again/i,
    'the timeout message does not warn against retrying (a retry just strands a fresh batch)');
  assert.match(userPaysSection, /groupId/,
    'the timeout message does not surface a support reference (groupId) for this specific stuck claim');
});

test('the user-pays timeout message does NOT reuse the fee-payment "will not charge you twice" claim', () => {
  // Nothing on this path detects or prevents a second charge -- unlike requestGasFee, whose retry
  // really is safe. Reusing that copy here would be false at the exact moment the user decides
  // whether to retry.
  assert.doesNotMatch(userPaysSection, /will not charge you twice/i,
    'the user-pays timeout message must not claim a retry is safe -- it is not, on this path');
});
