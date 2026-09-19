// Regression test for the 2026-08-06 server/client split of the rewards-vault derivation.
//
// lib/utils.ts is imported by 12+ client files, so getRewardsVaultAddress' call to
// algosdk.mnemonicToSecretKey(process.env.REWARD_MNEMONIC) was compiled into browser bundles.
// A rename to NEXT_PUBLIC_REWARD_MNEMONIC would then have inlined a custodial signing key into
// every visitor's JavaScript. The derivation now lives in lib/rewardsVault.server.ts.
//
// Comments are stripped before matching, because the explanatory comments left behind
// deliberately mention the very identifiers being asserted absent.
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');

const ROOT = '/home/helpdesk/subdomains/dashb/';
const UTILS = process.env.T_UTILS || ROOT + 'lib/utils.ts';
const SERVER = process.env.T_SERVER || ROOT + 'lib/rewardsVault.server.ts';
const CLAIM = process.env.T_CLAIM || ROOT + 'pages/api/rewards/claim.ts';
const DEVICES = process.env.T_DEVICES || ROOT + 'pages/devices.tsx';

const readOrEmpty = (p) => {
  try { return fs.readFileSync(p, 'utf8'); } catch { return ''; }
};
// Drop // line comments and /* */ block comments so only live code is matched.
const codeOnly = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\/\/.*$/gm, '');

test('client-bundled lib/utils.ts performs no mnemonic derivation', () => {
  const code = codeOnly(readOrEmpty(UTILS));
  assert.doesNotMatch(code, /mnemonicToSecretKey\s*\(/,
    'lib/utils.ts reaches client bundles; it must never derive a key from a mnemonic');
  assert.doesNotMatch(code, /export\s+const\s+getRewardsVaultAddress/,
    'getRewardsVaultAddress must live in the .server module, not here');
});

test('the server-only module owns the derivation', () => {
  const src = readOrEmpty(SERVER);
  assert.ok(src.length > 0, 'lib/rewardsVault.server.ts must exist');
  assert.match(src, /export\s+const\s+getRewardsVaultAddress/);
  assert.match(codeOnly(src), /mnemonicToSecretKey\s*\(/,
    'the server module keeps the derivation so vault-key rotation still works');
  assert.match(src, /SERVER-ONLY/, 'it must carry the server-only warning header');
});

test('claim.ts imports the vault address from the server module', () => {
  const code = codeOnly(readOrEmpty(CLAIM));
  assert.match(code, /import\s*\{[^}]*getRewardsVaultAddress[^}]*\}\s*from\s*'[^']*rewardsVault\.server'/,
    'claim.ts must source getRewardsVaultAddress from the .server module');
  assert.doesNotMatch(code, /import\s*\{[^}]*getRewardsVaultAddress[^}]*\}\s*from\s*'[^']*lib\/utils'/,
    'claim.ts must not pull it from lib/utils any more');
});

test('devices.tsx no longer imports the defanged getWalletAddress', () => {
  const code = codeOnly(readOrEmpty(DEVICES));
  assert.doesNotMatch(code, /import\s*\{[^}]*getWalletAddress[^}]*\}/,
    'the dead import should be gone');
});
