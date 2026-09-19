// Regression test (2026-09-14 oneshot): the FloatingTotalsWidget rendered the full-panel
// "Unable to load rewards" error from the RAW batch error, so a routinely-recoverable
// DEVICE_FINGERPRINT_REFRESH (409) or a 429 from the limiter painted a red failure panel
// even though fetchWithFingerprintRetry/SWR recover on their own and the per-device rows
// below degraded gracefully. The device rows already classified the same error via
// shouldFallBackPerDevice(); the totals widget must use that same predicate.
//
// RED/GREEN: run with DV_SOURCE_SUFFIX=.bak.<ts> to read the pre-fix backup (must FAIL).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SUFFIX = process.env.DV_SOURCE_SUFFIX || '';
const PAGE = 'pages/devices.tsx';
const read = (rel) => fs.readFileSync(path.join(ROOT, rel + SUFFIX), 'utf8').replace(/\r\n/g, '\n');

const widgetTag = (src) => {
  const i = src.indexOf('<FloatingTotalsWidget');
  assert.ok(i > 0, 'devices.tsx still renders FloatingTotalsWidget');
  const j = src.indexOf('/>', i);
  return src.slice(i, j + 2);
};

test('the totals widget classifies the batch error instead of using it raw', () => {
  const tag = widgetTag(read(PAGE));
  assert.doesNotMatch(
    tag,
    /isError=\{!!batchError/,
    'a raw !!batchError shows a red failure panel for recoverable 409/429 responses'
  );
  assert.match(tag, /isError=\{shouldFallBackPerDevice\(batchError\)/, 'uses the shared classifier');
});

test('the classifier is imported in devices.tsx', () => {
  assert.match(read(PAGE), /import \{[^}]*shouldFallBackPerDevice[^}]*\} from '\.\.\/lib\/api\/securityCodes'/);
});

test('the per-device rows still use the same classifier', () => {
  assert.match(read(PAGE), /batchRewardError=\{shouldFallBackPerDevice\(batchError\)\}/);
});
