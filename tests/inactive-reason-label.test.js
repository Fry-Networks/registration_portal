// RC9-UI: users with a dead legacy client saw a bare "Inactive" dot on the device card and
// had nothing to act on (two reporters, 6 and 5 devices). lib/deviceActivity.ts already
// computes WHY (update_required / no_recent_heartbeat) and /api/devices{,/batch} already
// ship that verdict as device.reward_block_reason + the two PoC version fields, but
// components/DeviceListItem.tsx rendered only the word "Inactive".
// These tests pin a PURE formatter so the copy is testable without React or a database.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

require('ts-node').register({
  transpileOnly: true,
  compilerOptions: { module: 'commonjs', moduleResolution: 'node', target: 'ES2017', jsx: 'react' },
});

const { inactiveReasonLabel } = require('../lib/inactiveReason.ts');

const NOW = Date.parse('2026-09-22T12:00:00.000Z');
const agoMs = (ms) => new Date(NOW - ms).toISOString();
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const NO_PLACEHOLDERS = /undefined|null|NaN|\[object Object\]/;

// ------------------------------------------------------------------ update_required
test('update_required names the installed client version and says an update is required', () => {
  const label = inactiveReasonLabel({
    eligibility: 'update_required',
    clientVersion: '1.2.0',
    requiredVersion: '1.4.1',
    lastSeenAt: agoMs(3 * DAY),
    now: NOW,
  });
  assert.ok(label, 'update_required produced no label');
  assert.match(label, /1\.2\.0/, 'the installed client version is missing');
  assert.match(label, /1\.4\.1/, 'the required client version is missing');
  assert.match(label, /updat/i, 'the label never tells the user to update');
  assert.doesNotMatch(label, NO_PLACEHOLDERS, 'the label leaks a placeholder');
});

test('update_required still reads cleanly when the version numbers are unknown', () => {
  const label = inactiveReasonLabel({ eligibility: 'update_required', now: NOW });
  assert.ok(label, 'update_required produced no label');
  assert.match(label, /updat/i, 'the label never tells the user to update');
  assert.doesNotMatch(label, NO_PLACEHOLDERS, 'the label leaks a placeholder');
});

// ------------------------------------------------------------- no_recent_heartbeat
test('no_recent_heartbeat reports the last-seen age in days', () => {
  const label = inactiveReasonLabel({
    eligibility: 'no_recent_heartbeat',
    lastSeenAt: agoMs(3 * DAY),
    now: NOW,
  });
  assert.ok(label, 'no_recent_heartbeat produced no label');
  assert.match(label, /3 days ago/, 'the last-seen age is not in the label');
  assert.doesNotMatch(label, NO_PLACEHOLDERS, 'the label leaks a placeholder');
});

test('no_recent_heartbeat reports the last-seen age in hours and minutes, singular and plural', () => {
  const hours = inactiveReasonLabel({
    eligibility: 'no_recent_heartbeat',
    lastSeenAt: agoMs(5 * HOUR),
    now: NOW,
  });
  assert.match(hours, /5 hours ago/, 'hour-scale age missing');

  const oneHour = inactiveReasonLabel({
    eligibility: 'no_recent_heartbeat',
    lastSeenAt: agoMs(HOUR),
    now: NOW,
  });
  assert.match(oneHour, /1 hour ago/, 'singular hour not handled');
  assert.doesNotMatch(oneHour, /1 hours ago/, 'singular hour pluralised');

  const minutes = inactiveReasonLabel({
    eligibility: 'no_recent_heartbeat',
    lastSeenAt: agoMs(12 * MIN),
    now: NOW,
  });
  assert.match(minutes, /12 minutes ago/, 'minute-scale age missing');

  const oneDay = inactiveReasonLabel({
    eligibility: 'no_recent_heartbeat',
    lastSeenAt: agoMs(DAY),
    now: NOW,
  });
  assert.match(oneDay, /1 day ago/, 'singular day not handled');
  assert.doesNotMatch(oneDay, /1 days ago/, 'singular day pluralised');
});

test('no_recent_heartbeat degrades safely when the last-seen timestamp is missing or unparseable', () => {
  for (const lastSeenAt of [undefined, null, '', 'not-a-date', NaN]) {
    const label = inactiveReasonLabel({ eligibility: 'no_recent_heartbeat', lastSeenAt, now: NOW });
    assert.ok(label, `no label for lastSeenAt=${String(lastSeenAt)}`);
    assert.doesNotMatch(label, NO_PLACEHOLDERS, `placeholder leaked for lastSeenAt=${String(lastSeenAt)}`);
    assert.doesNotMatch(label, /Invalid Date/, `Invalid Date leaked for lastSeenAt=${String(lastSeenAt)}`);
  }
});

test('a last-seen timestamp in the future (clock skew) does not produce a negative age', () => {
  const label = inactiveReasonLabel({
    eligibility: 'no_recent_heartbeat',
    lastSeenAt: new Date(NOW + 2 * HOUR).toISOString(),
    now: NOW,
  });
  assert.ok(label, 'no label for a future timestamp');
  assert.doesNotMatch(label, /-\d/, 'a negative age reached the label');
  assert.doesNotMatch(label, NO_PLACEHOLDERS, 'the label leaks a placeholder');
});

// -------------------------------------------------------------------- safe default
test('an unknown or absent reason falls back to one safe, actionable default', () => {
  const fallback = inactiveReasonLabel({ eligibility: 'unknown', now: NOW });
  assert.ok(fallback, 'no fallback label');
  assert.doesNotMatch(fallback, NO_PLACEHOLDERS, 'the fallback leaks a placeholder');
  for (const eligibility of [undefined, null, '', 'ineligible', 'no_poc_data', 'something_new']) {
    const label = inactiveReasonLabel({ eligibility, now: NOW });
    assert.ok(label, `no label for eligibility=${String(eligibility)}`);
    assert.doesNotMatch(label, NO_PLACEHOLDERS, `placeholder leaked for eligibility=${String(eligibility)}`);
  }
  assert.equal(inactiveReasonLabel({ eligibility: 'ineligible', now: NOW }), fallback);
});

test('the formatter never throws, whatever it is handed', () => {
  assert.doesNotThrow(() => inactiveReasonLabel(undefined));
  assert.doesNotThrow(() => inactiveReasonLabel({}));
  assert.doesNotThrow(() => inactiveReasonLabel({ eligibility: 42, lastSeenAt: {}, clientVersion: [] }));
});

// --------------------------------------------------------------------- live device
test('a live device gets no label', () => {
  assert.ok(!inactiveReasonLabel({ isActive: true, eligibility: 'no_recent_heartbeat', now: NOW }));
  assert.ok(!inactiveReasonLabel({ isActive: true, eligibility: 'update_required', now: NOW }));
  assert.ok(!inactiveReasonLabel({ eligibility: 'ok', now: NOW }));
});

// ------------------------------------------------------------------------- purity
test('the formatter module is pure: no database, react or network imports', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'inactiveReason.ts'), 'utf8');
  assert.doesNotMatch(src, /from ['"]mongodb['"]/, 'the formatter pulls in mongodb');
  assert.doesNotMatch(src, /from ['"]react['"]/, 'the formatter pulls in react');
  assert.doesNotMatch(src, /\bfetch\(/, 'the formatter makes a network call');
  assert.doesNotMatch(src, /require\(/, 'the formatter has a runtime require');
});

// ------------------------------------------------------------------ wired into the card
test('the device card renders the reason next to the Inactive badge', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'components', 'DeviceListItem.tsx'),
    'utf8'
  );
  assert.match(src, /inactiveReasonLabel/, 'DeviceListItem does not use the formatter');
  assert.match(src, /from ['"]\.\.\/lib\/inactiveReason['"]/, 'DeviceListItem does not import the formatter');
  assert.match(
    src,
    /device\.reward_block_reason/,
    'the card does not feed the eligibility reason into the label'
  );
  // the reason must sit in the same block as the Inactive badge, not somewhere else
  const badge = src.indexOf("'Active' : 'Inactive'");
  assert.ok(badge > 0, 'the Inactive badge moved; re-point this assertion');
  const window = src.slice(badge, badge + 1200);
  assert.match(window, /inactiveReason/i, 'the reason is not rendered beside the Inactive badge');
});

test('the reason costs no new request: it is derived from fields the card already holds', () => {
  const lib = fs.readFileSync(path.join(__dirname, '..', 'lib', 'inactiveReason.ts'), 'utf8');
  assert.doesNotMatch(lib, /fetch\(|axios|XMLHttpRequest/, 'the formatter can reach the network');

  const card = fs.readFileSync(
    path.join(__dirname, '..', 'components', 'DeviceListItem.tsx'),
    'utf8'
  );
  const call = card.slice(card.indexOf('inactiveReasonLabel({'));
  const args = call.slice(0, call.indexOf('})') + 2);
  assert.ok(args.length > 0 && args.length < 600, 'could not isolate the inactiveReasonLabel call');
  // every argument must come off the device object the card already has
  for (const ident of args.match(/[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*/g) || []) {
    if (['inactiveReasonLabel', 'isActive', 'eligibility', 'clientVersion', 'requiredVersion'].includes(ident)) continue;
    assert.match(ident, /^device\./, `inactiveReasonLabel is fed ${ident}, which is not already on the device`);
  }
});
