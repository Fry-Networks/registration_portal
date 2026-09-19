const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// D2: when a persisted Pera/Defly session cannot be restored, the corrupt blob survives
// every reload and strands the user on "Connect Wallet". The only existing recovery is the
// "Clear wallet data & retry" button, which renders solely when wallet INIT throws -- a
// different failure than a bad resume.
//
// The live resume path is the monkey-patched manager.resumeSessions in _app.tsx, NOT the
// exported resumeWalletSessions helper in lib/wallet/manager.ts, which has zero callers.
// A fix placed in that helper would never execute.
const appSrc = fs.readFileSync(
  path.join(__dirname, '..', 'pages', '_app.tsx'),
  'utf8'
);
const managerSrc = fs.readFileSync(
  path.join(__dirname, '..', 'lib', 'wallet', 'manager.ts'),
  'utf8'
);

const resumeCatch = () => {
  const start = appSrc.indexOf('resumeSessions timed out or failed');
  assert.ok(start !== -1, 'the live resume failure handler was not found in _app.tsx');
  return appSrc.slice(start, start + 1400);
};

test('the live resume-failure handler clears the stale provider keys', () => {
  const body = resumeCatch();
  assert.match(body, /removeItem\('pera-wallet-session'\)/);
  assert.match(body, /removeItem\('defly-wallet-session'\)/);
});

test('a resume TIMEOUT does not wipe a possibly-healthy session', () => {
  const body = resumeCatch();
  assert.match(
    body,
    /timeout/i,
    'the handler must distinguish the 8s timeout from a genuine resume failure, ' +
      'otherwise a slow network silently disconnects working wallets'
  );
});

test('cleanup never blanket-wipes localStorage', () => {
  assert.ok(!/localStorage\.clear\(\)/.test(resumeCatch()));
});

test('cleanup keys match the wallet-init recovery button', () => {
  for (const key of ['pera-wallet-session', 'defly-wallet-session']) {
    assert.ok(appSrc.includes(key));
  }
});

test('the dead resumeWalletSessions helper is not used as the fix site', () => {
  const callers = (appSrc.match(/resumeWalletSessions/g) || []).length;
  assert.equal(
    callers,
    0,
    'resumeWalletSessions has no callers; a fix there would never run'
  );
  assert.ok(
    !/removeItem\('pera-wallet-session'\)/.test(managerSrc),
    'cleanup must live in the live path, not the unreachable helper'
  );
});
