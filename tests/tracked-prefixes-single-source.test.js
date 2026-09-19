// Regression test (2026-09-14 oneshot): TRACKED_PREFIXES gates computeActiveSet and
// getRewardEligibility, so any miner-key prefix missing from it can never compute as online
// or reward-eligible. The table omitted the indoor/outdoor product prefixes and IOT, and
// pages/devices.tsx carried a second hardcoded (dead) copy that could silently drift from it.
// hardwareapi's deployed MinerCode enum is the authority: BM, IDM, ODM, ISM, OSM, RDN, SDN,
// SVN, IRM, FEM, IOTVPN. Note the table is matched against the KEY prefix (k.split('-')[0]),
// so the IOTVPN miner code appears here as its key prefix IOT.
//
// RED/GREEN: run with TP_SOURCE_SUFFIX=.bak.<ts> to read the pre-fix backups (must FAIL).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SUFFIX = process.env.TP_SOURCE_SUFFIX || '';
const read = (rel) => fs.readFileSync(path.join(ROOT, rel + SUFFIX), 'utf8').replace(/\r\n/g, '\n');

const tableOf = (src) => {
  const m = src.match(/export const TRACKED_PREFIXES = \[([^\]]*)\]/);
  assert.ok(m, 'lib/deviceActivity.ts still exports TRACKED_PREFIXES');
  return m[1].split(',').map((s) => s.trim().replace(/'/g, '')).filter(Boolean);
};

test('every live miner-code prefix is tracked', () => {
  const table = tableOf(read('lib/deviceActivity.ts'));
  for (const p of ['AEM', 'BM', 'CN', 'FEM', 'IDM', 'IOT', 'IRM', 'ISM', 'ODM', 'OSM', 'RDN', 'SDN', 'SVN']) {
    assert.ok(table.includes(p), `${p} must be tracked or its devices can never be online/eligible`);
  }
});

test('IOT is the key prefix, not the IOTVPN miner code', () => {
  const table = tableOf(read('lib/deviceActivity.ts'));
  assert.ok(table.includes('IOT'), 'matched against k.split(a hyphen)[0], so the key prefix is IOT');
  assert.ok(!table.includes('IOTVPN'), 'IOTVPN is the miner code and would never match a key prefix');
});

test('there is exactly one TRACKED_PREFIXES table', () => {
  const page = read('pages/devices.tsx');
  assert.ok(
    !/const TRACKED_PREFIXES\s*=/.test(page),
    'pages/devices.tsx must not redeclare TRACKED_PREFIXES; it drifts from lib/deviceActivity.ts'
  );
});

test('devices.tsx imports the shared table it references', () => {
  const page = read('pages/devices.tsx');
  if (/TRACKED_PREFIXES\./.test(page)) {
    assert.match(
      page,
      /import \{[^}]*TRACKED_PREFIXES[^}]*\} from '\.\.\/lib\/deviceActivity'/,
      'devices.tsx references TRACKED_PREFIXES, so it must import it (deleting the local copy without importing orphans line ~1841)'
    );
  }
});
