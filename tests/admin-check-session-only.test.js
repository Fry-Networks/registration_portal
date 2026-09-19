// Regression test for OOS #1 of the 2026-09-10 dashboard oneshot: lib/adminCheck.ts
// derived "admin" from client-controlled input (x-wallet / x-address headers, body.address /
// body.wallet). Any caller holding any valid session could name an admin wallet and skip the
// L1 client-token, L2 request-signature and L4 device-fingerprint layers on every rewards
// route. The admin decision must come from the authenticated session only, re-checked in
// registration-users, and fail closed.
const test = require('node:test');
const assert = require('node:assert/strict');

require('ts-node').register({
  transpileOnly: true,
  compilerOptions: { module: 'commonjs', moduleResolution: 'node', target: 'ES2017', jsx: 'react' },
});

const stub = (relPath, exports) => {
  const resolved = require.resolve(relPath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
};

const ADMIN = 'ADMINWALLETAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const USER = 'USERWALLETBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';

const state = { throwOnLookup: false, lookups: [] };
stub('../lib/mongoclient', {
  __esModule: true,
  default: Promise.resolve({
    db: () => ({
      collection: (name) => ({
        findOne: async (q) => {
          if (state.throwOnLookup) throw new Error('db down');
          state.lookups.push(q.address);
          return name === 'registration-users' && q.address === ADMIN ? { address: ADMIN, admin: true } : null;
        },
      }),
    }),
  }),
});

const { isAdminRequest, isAdminWallet } = require('../lib/adminCheck.ts');
const mkReq = (headers = {}, body = {}) => ({ method: 'POST', url: '/api/x', headers, body });

test('x-wallet naming an admin with no session is NOT admin', async () => {
  assert.equal(await isAdminRequest(mkReq({ 'x-wallet': ADMIN })), false);
});

test('x-address naming an admin with no session is NOT admin', async () => {
  assert.equal(await isAdminRequest(mkReq({ 'x-address': ADMIN })), false);
});

test('body.address forgery under a non-admin session is NOT admin', async () => {
  assert.equal(await isAdminRequest(mkReq({}, { address: ADMIN }), { user: { address: USER } }), false);
});

test('body.wallet forgery under a non-admin session is NOT admin', async () => {
  assert.equal(await isAdminRequest(mkReq({}, { wallet: ADMIN }), { user: { address: USER } }), false);
});

test('x-wallet forgery under a non-admin session is NOT admin', async () => {
  assert.equal(await isAdminRequest(mkReq({ 'x-wallet': ADMIN }), { user: { address: USER } }), false);
});

test('an authenticated admin session IS admin', async () => {
  assert.equal(await isAdminRequest(mkReq(), { user: { address: ADMIN } }), true);
});

test('the stashed session wallet is honoured when no session object is passed', async () => {
  const req = mkReq();
  req._sessionWalletAddress = ADMIN;
  assert.equal(await isAdminRequest(req), true);
});

test('no session and no stash: false, and no database lookup happens', async () => {
  const before = state.lookups.length;
  assert.equal(await isAdminRequest(mkReq({ 'x-wallet': ADMIN }, { address: ADMIN })), false);
  assert.equal(state.lookups.length, before);
});

test('isAdminWallet still answers from registration-users.admin', async () => {
  assert.equal(await isAdminWallet(ADMIN), true);
  assert.equal(await isAdminWallet(USER), false);
  assert.equal(await isAdminWallet(undefined), false);
});

test('a database failure fails closed', async () => {
  state.throwOnLookup = true;
  try {
    assert.equal(await isAdminRequest(mkReq(), { user: { address: ADMIN } }), false);
  } finally {
    state.throwOnLookup = false;
  }
});
