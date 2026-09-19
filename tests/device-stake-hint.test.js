// Regression test for the unstaked-exempt-FEM stake hint (Run 5 / B8).
//
// A registered FEM device with a reward wallet is verification-exempt, so it shows an
// "Unverified" badge until it stakes — but the in-card "Verification Stake" CTA is
// suppressed for exactly that state (renderVerificationActionButton). The card must
// therefore offer a discoverable path to the staking page instead of dead-ending.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..', 'components', 'DeviceListItem.tsx');
const src = () => fs.readFileSync(SRC, 'utf8');

test('device card renders a stake hint for unstaked exempt FEM devices', () => {
  assert.match(src(), /femVerificationExempt && !femBadgeVerified && \(/);
});

test('the stake hint links to the registrations page that offers "Verify (stake)"', () => {
  const m = src().match(/femVerificationExempt && !femBadgeVerified && \(([\s\S]{0,400})/);
  assert.ok(m, 'stake hint block not found');
  assert.match(m[1], /href="\/my_registrations"/);
  assert.match(m[1], /Stake to verify/);
});

test('the verification badge itself is unchanged', () => {
  assert.match(
    src(),
    /\{\(device\.verified \|\| femBadgeVerified\) \? 'Verified' : 'Unverified'\}/
  );
});
