// Regression guard (2026-09-15, Round 6).
//
// nodeProxy's failover guard used to read:
//   if (shouldFailOver(status) && upstream !== last) { ...continue }
// so when the LAST upstream also failed over, control fell through and the caller received that
// upstream's body verbatim. In practice that meant a browser got algonode's raw
// `403 Daily free API quota exceeded` — which looks like an Algorand API answer and hides that
// every upstream was exhausted. Exhaustion must be reported as exhaustion.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.resolve(__dirname, '..', 'lib/algorand/nodeProxy.ts'), 'utf8').replace(/\r\n/g, '\n');

test('exhausted upstreams report exhaustion rather than passing the last status through', () => {
  assert.match(
    SRC,
    /all algorand upstreams exhausted/,
    'the exhausted-upstream branch must return an explicit message'
  );
  assert.match(SRC, /res\.status\(502\)/, 'exhaustion should surface as 502, not the upstream status');
});

test('the failover guard no longer lets the last upstream fall through', () => {
  assert.ok(
    !/shouldFailOver\(upstreamRes\.status\)\s*&&\s*upstream !==/.test(SRC),
    'the old combined guard fell through on the last upstream; failover and exhaustion must be handled separately'
  );
  assert.match(
    SRC,
    /if \(shouldFailOver\(upstreamRes\.status\)\) \{/,
    'failover should be decided first, then last-upstream exhaustion handled inside it'
  );
});

test('403 is still treated as a failover condition', () => {
  assert.match(
    SRC,
    /status === 403/,
    'a quota 403 from a public node must still advance to the next upstream'
  );
});

test('the absent INDEXER_TOKEN is documented, not merely missing', () => {
  // Measured 2026-09-15: ATLAS00 runs algod on :8190 but no indexer, and INDEXER_URL is unset, so
  // there is no upstream an indexer token could authenticate to. Record why, so it is not "fixed".
  assert.match(SRC, /no INDEXER_TOKEN/i, 'explain why no indexer token is configured');
});
