const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// Firmware 0.3.2 finishes web provisioning by handing the browser a device URL:
//   https://dashboard.frynetworks.com/new_registration#key=FEM-<32 hex>
// (verified on a bench ESP32-C3 on 2026-09-22 — the board returns exactly this over
// Improv Serial after it joins Wi-Fi). A user with no Android phone follows "Visit
// Device" and lands here, so the page has to read that fragment and fill the field in.
// A fragment is deliberate: it never reaches nginx, the access log, or a Referer header,
// so a miner key cannot leak into server-side logs the way ?key= would.
//
// The same file also decides whether "Start onboarding" is clickable, and it did that
// with a /g regex — .test() on a global regex advances lastIndex, so the identical key
// alternates between valid and invalid on successive keystrokes.
const src = fs.readFileSync(
  path.join(__dirname, '..', 'pages', 'new_registration.tsx'),
  'utf8'
);

test('the page reads a #key= fragment so the firmware device URL prefills the field', () => {
  assert.match(
    src,
    /window\.location\.hash|location\.hash/,
    'pages/new_registration.tsx never looks at the URL fragment, so #key= from the ' +
      'firmware device URL is ignored'
  );
  assert.match(
    src,
    /setMinerKey\(/,
    'nothing sets the miner key from the URL'
  );
});

test('prefill runs once the router is ready, not on every render', () => {
  assert.match(
    src,
    /useEffect\(/,
    'the prefill must live in an effect, not in the render body'
  );
});

test('a ?key= query is honoured too, for links that cannot carry a fragment', () => {
  assert.match(
    src,
    /router\.query\.key|query\.key/,
    'no ?key= fallback: some clients strip fragments when opening a link'
  );
});

test('the validity check does not use a stateful global regex', () => {
  const m = src.match(/const\s+isValid\s*=\s*(.+);/);
  assert.ok(m, 'could not find the isValid expression');
  assert.ok(
    !/\/[a-z]*g[a-z]*\.test\(/.test(m[1]),
    'isValid calls .test() on a /g regex: lastIndex persists between calls, so the ' +
      'same key alternates valid/invalid as the user types. Found: ' + m[1]
  );
});
