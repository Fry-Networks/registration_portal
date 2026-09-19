// Regression guard (2026-09-15 oneshot, Round 5).
//
// lib/utils.ts carried a hardcoded 32-hex API key for months. It was never consumed by anything --
// exactly one reference in the whole repo, its own declaration -- so the bundler dead-code-eliminated
// it and it never reached a browser. That made it invisible to every check we had: no test failed,
// no bundle grep hit, nothing broke. A credential can sit in source indefinitely precisely BECAUSE
// it is unused.
//
// This test closes that gap: it fails on any credential-shaped literal assigned to a
// credential-named identifier in application source, used or not.
//
// Deliberately scoped to shape, not to one known value: pinning the specific leaked key would pass
// the moment someone pasted a different one.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DIRS = ['lib', 'pages', 'components'];

// An identifier that names a secret...
const SECRET_NAME = '[A-Za-z0-9_]*(?:TOKEN|KEY|SECRET|PASSWORD|PASSWD|APIKEY)[A-Za-z0-9_]*';
// ...assigned a long opaque literal. 24+ hex, or 32+ base64url-ish, is credential-shaped.
// Algorand addresses are 58 chars of A-Z2-7 and legitimately appear in source, so the character
// classes below deliberately require lowercase-or-digit mixing that base32 addresses cannot produce.
const SECRET_VALUE = "(?:[0-9a-fA-F]{24,}|[A-Za-z0-9_\\-+/]{40,}={0,2})";
const PATTERN = new RegExp(
  '(?:const|let|var|readonly)\\s+(' + SECRET_NAME + ")\\s*(?::[^=]+)?=\\s*['\"`](" + SECRET_VALUE + ")['\"`]",
  'g',
);

const walk = (dir) => {
  const out = [];
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch (e) {
      continue;
    }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name === '.next') continue;
        stack.push(p);
        continue;
      }
      // Only live source. Backups are rollback artifacts and are excluded on purpose.
      if (!/\.(ts|tsx|js|jsx)$/.test(e.name)) continue;
      if (/\.bak|\.fixed\./.test(e.name)) continue;
      out.push(p);
    }
  }
  return out;
};

const scan = () => {
  const hits = [];
  for (const dir of DIRS) {
    for (const file of walk(path.join(ROOT, dir))) {
      const src = fs.readFileSync(file, 'utf8');
      PATTERN.lastIndex = 0;
      let m;
      while ((m = PATTERN.exec(src)) !== null) {
        const line = src.slice(0, m.index).split('\n').length;
        hits.push({
          file: path.relative(ROOT, file).replace(/\\/g, '/'),
          line,
          name: m[1],
          // Never reproduce the value: record only its shape.
          shape: m[2].length + ' chars',
        });
      }
    }
  }
  return hits;
};

test('no credential-shaped literal is assigned to a credential-named identifier', () => {
  const hits = scan();
  assert.deepEqual(
    hits,
    [],
    'hardcoded credential(s) found in application source: ' +
      JSON.stringify(hits) +
      ' -- move it to a server-side environment variable. An unused one still counts: it ships in the repo and in git history.'
  );
});

test('the scanner can actually detect a planted credential', () => {
  // Positive control. Without this, an always-empty result would look like a pass forever --
  // a broken regex and a clean repo are indistinguishable from the assertion above alone.
  const planted = "const STRIPE_API_KEY = '" + 'a1b2c3d4'.repeat(4) + "';";
  PATTERN.lastIndex = 0;
  assert.ok(
    PATTERN.test(planted),
    'the detection pattern failed to match an obviously credential-shaped declaration, so a real one would also slip through'
  );
});

test('the scanner does not flag ordinary Algorand values', () => {
  // Negative control: these are legitimate and must not trip the guard.
  const benign = [
    "const STAKE_ADDRESS = 'UKVAN7ORIUX7Y6QJFYQ4YGQAZD3RAC7QTDB73S2E5MSILUWAA7FJ6N7WLU';",
    "const DEFAULT_NODE_TOKEN = '';",
    "const genesisHash = 'wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8=';",
  ].join('\n');
  PATTERN.lastIndex = 0;
  assert.ok(!PATTERN.test(benign), 'guard must not fire on addresses, empty tokens or genesis hashes');
});
