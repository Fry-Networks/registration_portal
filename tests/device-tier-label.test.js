// Regression test for the device-detail tier label (Run 4 / bug B1).
//
// The "Rewards & multipliers" section lists three daily-earning tiers. The base
// (no-multiplier) tier was labelled "Unverified", which collides with the
// verification-status vocabulary used by the STATUS section of the same card —
// users read a device as both "Verified" (status) and "UNVERIFIED" (tier).
// The base tier label must use the stake vocabulary published by hardwareapi in
// PoC.versions.stake_tiers ("No stake"), not the verification vocabulary.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..', 'components', 'DeviceListItem.tsx');

function baseTierBlock() {
  const src = fs.readFileSync(SRC, 'utf8');
  const idx = src.indexOf("tier: 'bronze' as const,");
  assert.notStrictEqual(idx, -1, 'base (bronze) daily-reward tier entry not found');
  return src.slice(idx, idx + 220);
}

test('base daily-earnings tier is not labelled with verification vocabulary', () => {
  assert.ok(
    !/label: 'Unverified'/.test(baseTierBlock()),
    'base tier must not be labelled "Unverified" — it collides with the device verification status'
  );
});

test('base daily-earnings tier uses the stake_tiers "No stake" label', () => {
  assert.match(baseTierBlock(), /label: 'No stake'/);
});

test('base tier still describes the un-multiplied daily rate', () => {
  assert.match(baseTierBlock(), /description: 'Base daily rate without multiplier'/);
});
