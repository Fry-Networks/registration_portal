const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// D4: the devices-page "Registration Guide" hero link pointed at
// https://docs.frynetworks.com/dashboard/registration, which returns 404 --
// that path does not exist on the docs site. Every published docs page lives
// under /docs/ and ends in .html. This locks the link to a real page so a
// future edit cannot silently reintroduce a dead link for every operator.
const devicesSrc = fs.readFileSync(
  path.join(__dirname, '..', 'pages', 'devices.tsx'),
  'utf8'
);

const registrationGuideHref = () => {
  // Matches the HeroBanner link object: { label: 'Registration Guide', href: '...' }
  const m = devicesSrc.match(
    /label:\s*'Registration Guide',\s*\n?\s*href:\s*'([^']+)'/
  );
  return m ? m[1] : null;
};

test('devices page declares a Registration Guide link', () => {
  assert.ok(
    registrationGuideHref(),
    'no { label: "Registration Guide", href } pair found in pages/devices.tsx'
  );
});

test('Registration Guide link does not use the dead /dashboard/registration path', () => {
  const href = registrationGuideHref();
  assert.ok(
    !/\/dashboard\/registration\b/.test(href),
    `Registration Guide points at the 404 path: ${href}`
  );
});

test('Registration Guide link targets a real published docs page', () => {
  const href = registrationGuideHref();
  assert.match(
    href,
    /^https:\/\/docs\.frynetworks\.com\/docs\/[a-z0-9-]+\.html$/,
    `expected a https://docs.frynetworks.com/docs/<page>.html URL, got: ${href}`
  );
});
