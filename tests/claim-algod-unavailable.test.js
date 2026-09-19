// Companion to the failover stub added to claim-matured-no-instant-fee.test.js (dashfix-round3).
//
// Stubbing lib/algorand/failover in that test stops it touching the network — but it would also
// hide a genuine failure of the algod-unavailable path. This file keeps that path covered:
// when every algod endpoint is down, the claim must answer 503 (network unavailable), never a
// 500 or an unhandled throw.

const test = require('node:test');
const assert = require('node:assert/strict');

require('ts-node').register({
  transpileOnly: true,
  compilerOptions: { module: 'commonjs', moduleResolution: 'node', target: 'ES2017', jsx: 'react' },
});

const ADDR = 'SYNTHWALLETWGAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const MINER = 'FEM-TESTKEY0000000000000000000000000';
const ASSET = '2485202024';
const VAULT = 'HXWYLLZDPTM5OXS3DPARMTG52RSBMMCQNKT4L2LZRRXYPNAWJBT6VIW6WU';

const stub = (relPath, exports) => {
  const resolved = require.resolve(relPath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
};

class AlgodUnavailableError extends Error {
  constructor(causes) {
    super(`All algod endpoints failed: ${(causes || []).join(' | ')}`);
    this.name = 'AlgodUnavailableError';
    this.causes = causes || [];
  }
}

const weeklyRow = () => ({
  reward_number: 18,
  status: 'claimable',
  asset_id: ASSET,
  amount: 306.75,
  corrected_by: 'fem_final_f3y',
  week_start: new Date('2026-05-22T00:00:00Z'),
  week_end: new Date('2026-05-28T23:59:59Z'),
  unlock_at: new Date('2026-05-29T00:05:00Z'),
});

const fakeCollection = (name) => ({
  findOne: async () => {
    if (name === 'devices') return { miner_key: MINER, address: ADDR, reward_wallet: ADDR };
    if (name === 'device-rewards') return { miner_key: MINER, weekly_rewards: [weeklyRow()], daily_rewards: [] };
    if (name === 'fry_fee_genesis') return { _id: 'config', fee_enabled: false };
    return null;
  },
  updateOne: async () => ({ modifiedCount: 1 }),
  insertOne: async () => ({ insertedId: 'x' }),
});

stub('next-auth', { __esModule: true, getServerSession: async () => ({ user: { address: ADDR } }) });
stub('../pages/api/auth/[...nextauth].ts', { __esModule: true, authOptions: {} });
stub('../lib/mongoclient', { __esModule: true, default: Promise.resolve({ db: () => ({ collection: fakeCollection }) }) });
stub('../lib/adminCheck', { __esModule: true, isAdminRequest: async () => true, isAdminWallet: async () => true, extractWalletFromRequest: () => ADDR });
stub('../lib/clientTokenMiddleware', { __esModule: true, verifyClientToken: async () => true });
stub('../lib/requestSignature.server', { __esModule: true, verifyRequestSignatureAsync: async () => true });
stub('../lib/deviceFingerprint', { __esModule: true, verifyDeviceFingerprintMiddleware: async () => 'ok' });
stub('../lib/logger', { __esModule: true, loggers: { apiError: () => {} } });
stub('../lib/rewardsVault.server', { __esModule: true, getRewardsVaultAddress: () => VAULT });
stub('../lib/utils', { __esModule: true, getAssetDecimals: async () => 6, fNODE: { id: ASSET, decimals: 6 }, tFRY: { id: '2681521901', decimals: 6 } });
stub('../lib/rewards/pocEvidence', { __esModule: true, loadEvidence: async () => ({ dates: new Set(), leases: [] }), hasEvidenceInWindow: () => true });
stub('../lib/rewards/reservation', { __esModule: true, reserveRows: async () => 1, releaseRows: async () => {}, releaseStaleReservations: async () => {} });
stub('../lib/monitoring/walletHealth', { __esModule: true, monitorWalletHealth: async () => {} });
stub('../lib/monitoring/transactionMonitor', { __esModule: true, monitorTransaction: async () => {} });
stub('../lib/algorand/optIn', { __esModule: true, ensureWalletAssetOptIn: async () => {} });
stub('../lib/algorand/withRetry', { __esModule: true, withRetry: async (fn) => fn() });
stub('../lib/wallet/clients', { __esModule: true, getAlgodClient: () => ({}), getIndexerClient: () => ({}) });
stub('../lib/wallet/transactions', { __esModule: true, buildAssetTransferTxn: async () => 'txn' });
stub('../lib/algorand/admin', {
  __esModule: true,
  decodeUnsignedTransaction: (t) => t,
  loadMnemonicAccountPair: () => ({ account: { addr: { toString: () => VAULT } } }),
  signAndSubmitCustodialTransactions: async () => ({ txId: 'TESTTXID' }),
  buildUserPaysClaimGroup: async () => ({ groupId: 'g', signedServerLegsB64: [], unsignedUserLegB64: 'u', unsignedServerLegsB64: [], expected: {} }),
});
stub('../lib/api/deviceAction', { __esModule: true, withDeviceActionLock: async (_req, _res, _meta, run) => run() });

// Every endpoint down.
stub('../lib/algorand/failover', {
  __esModule: true,
  AlgodUnavailableError,
  getFailoverAccountInfo: async () => { throw new AlgodUnavailableError(['primary', 'fallback']); },
  getFailoverAssetBalance: async () => { throw new AlgodUnavailableError(['primary', 'fallback']); },
  getFailoverAlgodClient: async () => { throw new AlgodUnavailableError(['primary down', 'fallbacks down']); },
});

const handler = require('../pages/api/rewards/claim.ts').default;

test('a claim answers 503 when no algod endpoint is reachable', async () => {
  const req = { method: 'POST', headers: {}, body: { miner_key: MINER, no: 18 } };
  const res = { status: () => res, json: () => res };
  let thrown = null;
  try {
    await handler(req, res);
  } catch (err) {
    thrown = err;
  }
  assert.ok(thrown, 'the handler neither threw nor surfaced an error for an unreachable network');
  assert.equal(thrown.status, 503, `expected 503, got ${thrown.status}: ${JSON.stringify(thrown.response)}`);
  assert.equal(thrown.response?.code, 'NETWORK_ERROR');
});
