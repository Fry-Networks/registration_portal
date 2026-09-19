// Regression tests (2026-09-14 round 2 oneshot), two independent defects in pages/devices.tsx:
//
// 1) PRODUCT-MISS STUB. devices.tsx early-returns a card replacement when a device's key prefix
//    has no main.products row. Eight legacy prefixes still have none (AEM/BM/ISM/RDN/SVN/IDM/
//    OSM/SDN) and 94 live devices sit behind it. The old copy told users to "Contact admin to
//    configure", which is not actionable — those product lines are superseded by Fry Edge Miner.
//
// 2) totalsError. The render site at ~1427 classifies batchError via shouldFallBackPerDevice, but
//    totalsError is a BOOLEAN (useState(false)), so it CANNOT be classified there — passing a
//    boolean to shouldFallBackPerDevice returns false unconditionally (its `typeof error.status
//    !== 'number'` guard), which would suppress genuine 401/DEVICE_MISMATCH errors too. The
//    classification therefore has to happen at the set-site, where isExpectedSecurityRejection
//    is already computed and was previously used only to suppress telemetry.
//
// RED/GREEN: run with DV2_SOURCE_SUFFIX=.bak.<ts> to read the pre-fix backup (must FAIL).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SUFFIX = process.env.DV2_SOURCE_SUFFIX || '';
const read = () => fs.readFileSync(path.join(ROOT, 'pages/devices.tsx' + SUFFIX), 'utf8').replace(/\r\n/g, '\n');

// NB: findProductByMinerKey has SIX call sites; anchor on the stub's own warning classes,
// not on the call, or this slices the wrong block (it matched line 521 on the first attempt).
const stubBlock = (src) => {
  const i = src.indexOf('border border-warning-500/30 bg-warning-500/5');
  assert.ok(i > 0, 'the product-miss early return still exists');
  return src.slice(i, i + 900);
};

// Requirement revised mid-run, and the assertion tightened rather than relaxed. The first version
// asserted the old copy was GONE. That was wrong: the old wording is the correct DEFAULT for a
// prefix that merely lacks a product row (e.g. a new product before its row is created). What the
// deprecated branch must do is name the replacement and link the installer. Both branches are now
// asserted to coexist, which is a stronger condition than the original single-branch check.
test('the deprecated branch names Fry Edge Miner and links the installer', () => {
  const b = stubBlock(read());
  assert.match(b, /Fry Edge Miner/, 'names the replacement product');
  assert.match(b, /FEM_INSTALL_LINK/, 'links to the install guide via the shared constant');
  assert.match(b, /Install FEM on this machine to continue earning rewards/, 'tells the user what to do');
});

test('the FEM install link is a named constant, not an inline literal in the stub', () => {
  const src = read();
  assert.match(src, /const FEM_INSTALL_LINK = 'https:\/\/docs\.frynetworks\.com\/docs\/install-fem\.html';/);
});

test('totalsError is classified at the set-site', () => {
  const src = read();
  assert.match(
    src,
    /if \(active\) setTotalsError\(!isExpectedSecurityRejection\);/,
    'a recoverable 403/409 from the auth layers must not set the fatal totals error'
  );
});

test('genuine failures still set totalsError — the change is not over-broad', () => {
  const src = read();
  const hard = src.split('\n').filter((l) => /setTotalsError\(true\)/.test(l));
  assert.ok(hard.length >= 3, `expected the 401 / security-block / catch paths to still set true, found ${hard.length}`);
});

test('the render site still classifies batchError (round 1 fix intact)', () => {
  assert.match(read(), /isError=\{shouldFallBackPerDevice\(batchError\) \|\| totalsError\}/);
});

// The stub is the fallback for ANY prefix with no main.products row, including a NEW product whose
// row has not been created yet (IOT was in that state on 2026-09-14). Ungated deprecation copy would
// tell an owner of working new hardware that it is obsolete, which is worse than the vague original.
test('deprecation wording is gated on a known-deprecated prefix set', () => {
  const src = read();
  assert.match(src, /const DEPRECATED_PREFIXES = new Set\(/, 'an explicit deprecated set exists');
  const b = stubBlock(src);
  assert.match(b, /DEPRECATED_PREFIXES\.has\(/, 'the stub branches on it');
  assert.match(b, /Contact admin to configure/, 'the neutral wording survives as the default branch');
  assert.match(b, /Fry Edge Miner/, 'the deprecation branch still exists');
});

test('every prefix in the deprecated set genuinely lacks a product row', () => {
  const m = read().match(/const DEPRECATED_PREFIXES = new Set\(\[([^\]]*)\]\)/);
  assert.ok(m, 'set is parseable');
  const got = m[1].split(',').map((x) => x.trim().replace(/'/g, '')).filter(Boolean).sort();
  // main.products keys measured 2026-09-14: FEM, STO, DVN, IOT. None of these appear here.
  for (const live of ['FEM', 'STO', 'DVN', 'IOT']) {
    assert.ok(!got.includes(live), `${live} has a product row and must NOT be marked deprecated`);
  }
});
