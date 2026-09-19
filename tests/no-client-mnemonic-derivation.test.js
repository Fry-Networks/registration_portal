// Regression test for the 2026-08-06 client-exposure hardening.
//
// Two hazards are locked down here:
//   1. productionBrowserSourceMaps served full original TypeScript (comments included) to any
//      visitor who opened devtools. Verified live before the fix: the .js.map URL returned 200.
//   2. lib/utils.ts is imported by client pages, so an exported helper that called
//      algosdk.mnemonicToSecretKey shipped a key-derivation capability into the browser bundle.
//   3. @txnlab/use-wallet's Mnemonic provider persists a raw mnemonic to localStorage; the
//      wallet allowlist must never include it.
//
// Paths are overridable so the same assertions can be run against the pre-fix backups to prove
// the RED half of the differential.
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');

const ROOT = '/home/helpdesk/subdomains/dashb/';
const NEXT_CONFIG = process.env.T_NEXT_CONFIG || ROOT + 'next.config.js';
const UTILS = process.env.T_UTILS || ROOT + 'lib/utils.ts';
const MANAGER = process.env.T_MANAGER || ROOT + 'lib/wallet/manager.ts';

const read = (p) => fs.readFileSync(p, 'utf8');

test('production browser source maps are disabled', () => {
  const src = read(NEXT_CONFIG);
  assert.match(src, /productionBrowserSourceMaps:\s*false/);
  assert.doesNotMatch(src, /productionBrowserSourceMaps:\s*true/);
});

test('the NEXT_PUBLIC_ mnemonic build guard is still present', () => {
  const src = read(NEXT_CONFIG);
  assert.match(src, /NEXT_PUBLIC_ALGORAND_DEV_MNEMONIC/);
  assert.match(src, /throw new Error/);
});

test('getWalletAddress does not derive a key from a mnemonic', () => {
  const src = read(UTILS);
  const m = src.match(/export const getWalletAddress[\s\S]*?\n};/);
  assert.ok(m, 'getWalletAddress should still be exported (pages/devices.tsx imports it)');
  const body = m[0];
  assert.doesNotMatch(body, /mnemonicToSecretKey/,
    'client-bundled code must not derive a signing key from a mnemonic');
  assert.match(body, /throw new Error/,
    'calling it should be a hard error, not a silent no-op');
});

test('the wallet allowlist excludes the Mnemonic provider', () => {
  const src = read(MANAGER);
  const m = src.match(/const SUPPORTED_WALLETS = \[[\s\S]*?\n\]/);
  assert.ok(m, 'SUPPORTED_WALLETS allowlist should exist');
  const list = m[0];
  assert.match(list, /WalletId\.PERA/);
  assert.match(list, /WalletId\.DEFLY/);
  assert.doesNotMatch(list, /WalletId\.MNEMONIC/,
    'the Mnemonic provider stores secrets in localStorage and must never be selectable');
});
