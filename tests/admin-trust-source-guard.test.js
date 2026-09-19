// Text guard for OOS #1: the admin decision must be derived from the authenticated session only.
// Set AC_SOURCE_SUFFIX to a backup suffix (e.g. '.bak.1789143233') to run these assertions
// against the pre-fix snapshots, which fail.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SUFFIX = process.env.AC_SOURCE_SUFFIX || '';
const read = (rel) => fs.readFileSync(path.join(ROOT, rel + SUFFIX), 'utf8');
const codeOnly = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\/\/.*$/gm, '');

test('adminCheck derives the wallet only from the session and re-checks the database', () => {
  const code = codeOnly(read('lib/adminCheck.ts'));
  assert.doesNotMatch(code, /x-wallet|x-address/);
  assert.doesNotMatch(code, /req\.body/);
  assert.doesNotMatch(code, /extractWalletFromRequest/);
  assert.match(code, /export async function isAdminRequest\s*\(\s*req[^)]*,\s*session/);
  assert.match(code, /session\?\.user\?\.address/);
  assert.match(code, /_sessionWalletAddress/);
  assert.match(code, /export async function isAdminWallet/);
  assert.match(code, /registration-users/);
});

test('clientTokenMiddleware has no admin bypass and reads no wallet header', () => {
  const code = codeOnly(read('lib/clientTokenMiddleware.ts'));
  assert.doesNotMatch(code, /isAdminRequest|isAdminWallet|extractWalletFromRequest|adminCheck/);
  assert.doesNotMatch(code, /x-wallet|x-address/);
});

test('requestSignature.server has no admin bypass and reads no wallet header', () => {
  const code = codeOnly(read('lib/requestSignature.server.ts'));
  assert.doesNotMatch(code, /isAdminWallet|isAdminRequest|adminCheck/);
  assert.doesNotMatch(code, /x-wallet|x-address/);
  assert.match(code, /export async function verifyRequestSignatureAsync/);
});

test('deviceFingerprint has no header-only bypass but keeps the env kill switch and the admin bypass', () => {
  const code = codeOnly(read('lib/deviceFingerprint.ts'));
  assert.doesNotMatch(code, /x-internal-request|next-ssr/i);
  assert.match(code, /DISABLE_DEVICE_FINGERPRINT/);
  assert.match(code, /if \(isAdmin\)/);
});

const CALLERS = [
  'pages/api/rewards/boost.ts',
  'pages/api/rewards/claim.ts',
  'pages/api/rewards/confirm.ts',
  'pages/api/rewards/get-asset-totals.ts',
  'pages/api/rewards/get-reward-summary.ts',
  'pages/api/rewards/get-reward-summary-batch.ts',
  'pages/api/rewards/get-rewards-page.ts',
  'lib/api/enforceWalletSecurity.ts',
];

for (const rel of CALLERS) {
  test(`${rel} passes the session to isAdminRequest`, () => {
    const code = codeOnly(read(rel));
    assert.match(code, /isAdminRequest\(\s*req\s*,\s*session\s*\)/);
    assert.doesNotMatch(code, /isAdminRequest\(\s*req\s*\)/);
  });
}
