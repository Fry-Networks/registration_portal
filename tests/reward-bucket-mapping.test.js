// Money-affecting invariant (2026-09-15 oneshot, Item 7).
//
// Five files carried byte-identical private copies of the reward-bucket prefix tables. They were
// consolidated into lib/devicePrefixes.ts. Consolidation is only safe if the resulting bucket for
// every prefix is IDENTICAL to what the copies produced, because the bucket decides which asset a
// device's rewards are denominated in (tFRY vs fNODE).
//
// The expected map below is frozen from the PRE-consolidation constants
// (NODE_PREFIXES = RDN/SVN/SDN/CN, AEM_PREFIX = AEM, FEM_PREFIX = FEM). It is a snapshot over
// every tracked prefix, not a spot check. BM -> tFRY and FEM -> fNODE are intentional product
// behaviour; if a future edit "tidies" them, this test fails rather than silently repricing
// real users' rewards.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

const CONSUMERS = [
  'pages/history.tsx',
  'pages/api/rewards/get-asset-totals.ts',
  'pages/api/rewards/claim.ts',
  'pages/api/rewards/get-reward-summary.ts',
  'pages/api/rewards/get-reward-summary-batch.ts',
];

// Parse the shared table rather than importing it: these are .ts sources and the harness is
// plain node --test with no TypeScript loader.
const sharedConstants = () => {
  const src = read('lib/devicePrefixes.ts');
  const nodeMatch = src.match(/export const NODE_PREFIXES[^=]*= new Set\(\[([^\]]*)\]\)/);
  assert.ok(nodeMatch, 'lib/devicePrefixes.ts must export NODE_PREFIXES as a Set literal');
  const nodePrefixes = nodeMatch[1]
    .split(',')
    .map((s) => s.trim().replace(/'/g, ''))
    .filter(Boolean);

  const aem = src.match(/export const AEM_PREFIX = '([^']+)'/);
  const fem = src.match(/export const FEM_PREFIX = '([^']+)'/);
  assert.ok(aem && fem, 'lib/devicePrefixes.ts must export AEM_PREFIX and FEM_PREFIX');
  return { nodePrefixes: new Set(nodePrefixes), aem: aem[1], fem: fem[1] };
};

// The exact classification every consumer performs, in the consumers' own order.
const bucketFor = (prefix, c) => {
  const isNode = c.nodePrefixes.has(prefix);
  const isAem = prefix === c.aem || prefix === c.fem;
  if (isNode) return 'node';
  if (isAem) return 'fNODE';
  return 'tFRY';
};

// Frozen snapshot of the pre-consolidation behaviour, over every tracked prefix.
const EXPECTED = {
  AEM: 'fNODE',
  FEM: 'fNODE',
  RDN: 'node',
  SVN: 'node',
  SDN: 'node',
  CN: 'node',
  BM: 'tFRY',
  IDM: 'tFRY',
  IOT: 'tFRY',
  IRM: 'tFRY',
  ISM: 'tFRY',
  ODM: 'tFRY',
  OSM: 'tFRY',
};

test('bucket assignment is unchanged for every tracked prefix', () => {
  const c = sharedConstants();
  for (const [prefix, expected] of Object.entries(EXPECTED)) {
    assert.equal(
      bucketFor(prefix, c),
      expected,
      `${prefix} must settle in the ${expected} bucket; changing this reprices real rewards`
    );
  }
});

test('BM settles in tFRY and FEM in fNODE, by design', () => {
  const c = sharedConstants();
  assert.equal(bucketFor('BM', c), 'tFRY', 'BM is a miner device: tFRY bucket');
  assert.equal(bucketFor('FEM', c), 'fNODE', 'FEM is grouped with AEM: fNODE bucket');
});

test('every tracked prefix has a pinned bucket', () => {
  const activity = read('lib/deviceActivity.ts');
  const m = activity.match(/export const TRACKED_PREFIXES = \[([^\]]*)\]/);
  assert.ok(m, 'lib/deviceActivity.ts still exports TRACKED_PREFIXES');
  const tracked = m[1].split(',').map((s) => s.trim().replace(/'/g, '')).filter(Boolean);
  for (const prefix of tracked) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(EXPECTED, prefix),
      `${prefix} is tracked but has no pinned reward bucket; add it to EXPECTED deliberately`
    );
  }
});

test('there is exactly one copy of the prefix tables', () => {
  for (const rel of CONSUMERS) {
    const src = read(rel);
    assert.ok(
      !/const NODE_PREFIXES\s*=/.test(src),
      `${rel} must not redeclare NODE_PREFIXES; duplicate copies drift and reprice rewards`
    );
    assert.ok(
      !/const AEM_PREFIX\s*=/.test(src) && !/const FEM_PREFIX\s*=/.test(src),
      `${rel} must not redeclare AEM_PREFIX/FEM_PREFIX`
    );
  }
});

test('every consumer imports the shared tables it references', () => {
  for (const rel of CONSUMERS) {
    const src = read(rel);
    if (!/NODE_PREFIXES|AEM_PREFIX|FEM_PREFIX/.test(src)) continue;
    assert.match(
      src,
      /import \{[^}]*NODE_PREFIXES[^}]*\} from '[^']*lib\/devicePrefixes'/,
      `${rel} references the prefix tables, so it must import them (removing the local copy without importing leaves the file referencing an undefined name)`
    );
  }
});
