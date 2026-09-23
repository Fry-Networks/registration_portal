// Both hero price chips read "$0.000003" even though the two assets are not worth the
// same. Live upstream on 2026-09-23: FRY 2.0 = 2.7189e-05 ALGO, fNODE = 2.8958e-05 ALGO
// — about 6.5% apart. formatPrice rounds anything under a cent with toFixed(6), and at
// six decimal places both land on 0.000003, so a real difference disappears and the page
// looks like it is showing one asset's price twice.
//
// Significant digits, not decimal places: a sub-cent token needs its first meaningful
// digits shown, whatever the exponent.
const test = require('node:test');
const assert = require('node:assert/strict');

require('ts-node').register({
  transpileOnly: true,
  compilerOptions: { module: 'commonjs', moduleResolution: 'node', target: 'ES2017', jsx: 'react' },
});

const { formatPrice } = require('../components/HeroBanner');

test('two sub-cent prices that differ do not render identically', () => {
  const fry2 = 2.7189e-05 * 0.12;   // ~0.00000326 USD
  const fnode = 2.8958e-05 * 0.12;  // ~0.00000347 USD
  assert.notEqual(formatPrice(fry2), formatPrice(fnode),
    `both chips rendered ${formatPrice(fry2)} for prices 6.5% apart`);
});

test('a sub-cent price keeps three significant digits', () => {
  assert.equal(formatPrice(0.00000326), '$0.00000326');
  assert.equal(formatPrice(0.0000123), '$0.0000123');
});

test('ordinary prices are unchanged', () => {
  assert.equal(formatPrice(1.5), '$1.50');
  assert.equal(formatPrice(0.5), '$0.5000');
});

test('the no-market-price case still shows a dash, not a zero', () => {
  assert.equal(formatPrice(0), '—');
  assert.equal(formatPrice(undefined), '—');
});
