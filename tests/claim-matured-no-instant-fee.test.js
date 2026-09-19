// Regression test for the Discord "claim is one third short" reports (dashfix-20260807).
//
// /api/rewards/claim is the MATURED claim path (rows already 'claimable' after the
// 30-day unlock window). Per the whitepaper a matured claim is fee-free; the 30%
// Fry Fee Genesis fee belongs to Instant Claim (/api/rewards/boost), which charges
// its own fee. The FFG block in claim.ts applied the instant-claim fee to every
// matured claim, so users received 70% (on-chain proof: group at round 63640471 —
// vault -> user 214.725 fNODE + vault -> U5TA 30.675 fNODE "ffg-fee:v1" for a
// 306.75 fNODE matured claim).
//
// The fee stays config-driven: fry_fee_genesis.fee_source decides which claim path
// it applies to ('instant_claim' = boost only, the shipped config).

const test = require('node:test');
const assert = require('node:assert/strict');

require('ts-node').register({
  transpileOnly: true,
  compilerOptions: { module: 'commonjs', moduleResolution: 'node', target: 'ES2017', jsx: 'react' },
});

const ADDR = 'SYNTHWALLETWGAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const MINER = 'FEM-TESTKEY0000000000000000000000000';
const ASSET = '2485202024';
const AMOUNT = 306.75;
const MICRO = 306750000;
const SINK = 'U5TA6XANQ7G3XTKTBP5VEUXHSHZO2GWMZN75OU3BIHTQ5D7LDXZA7ATXSI';
const VAULT = 'HXWYLLZDPTM5OXS3DPARMTG52RSBMMCQNKT4L2LZRRXYPNAWJBT6VIW6WU';

const stub = (relPath, exports) => {
  const resolved = require.resolve(relPath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
};

// Mutable per-test state.
const state = {
  feeSource: 'instant_claim',
  userPays: false,
  transfers: [],      // buildAssetTransferTxn calls (custodial path)
  userPaysGroup: null // buildUserPaysClaimGroup args (user-pays path)
};

const weeklyRow = () => ({
  reward_number: 18,
  status: 'claimable',
  asset_id: ASSET,
  amount: AMOUNT,
  corrected_by: 'fem_final_f3y', // audit-verdicted → A-gate trusts the row
  week_start: new Date('2026-05-22T00:00:00Z'),
  week_end: new Date('2026-05-28T23:59:59Z'),
  unlock_at: new Date('2026-05-29T00:05:00Z')
});

const fakeCollection = (name) => ({
  findOne: async (q) => {
    if (name === 'devices') {
      return { miner_key: MINER, address: ADDR, reward_wallet: ADDR };
    }
    if (name === 'device-rewards') {
      return { miner_key: MINER, weekly_rewards: [weeklyRow()], daily_rewards: [], total_claimable: AMOUNT, total_claimed: 0 };
    }
    if (name === 'fry_fee_genesis') {
      return {
        _id: 'config',
        fee_enabled: true,
        fee_bps: 3000,
        holder_share_num: 1,
        holder_share_den: 3,
        fee_note_prefix: 'ffg-fee:',
        fee_sink_addresses: [SINK],
        fee_source: state.feeSource
      };
    }
    return null;
  },
  updateOne: async () => ({ modifiedCount: 1 }),
  insertOne: async () => ({ insertedId: 'x' })
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
stub('../lib/utils', {
  __esModule: true,
  getAssetDecimals: async () => 6,
  fNODE: { id: ASSET, decimals: 6 },
  tFRY: { id: '2681521901', decimals: 6 }
});
stub('../lib/rewards/pocEvidence', {
  __esModule: true,
  loadEvidence: async () => ({ dates: new Set(), leases: [] }),
  hasEvidenceInWindow: () => true
});
stub('../lib/rewards/reservation', {
  __esModule: true,
  reserveRows: async () => 1,
  releaseRows: async () => {},
  releaseStaleReservations: async () => {}
});
stub('../lib/monitoring/walletHealth', { __esModule: true, monitorWalletHealth: async () => {} });
stub('../lib/monitoring/transactionMonitor', { __esModule: true, monitorTransaction: async () => {} });
stub('../lib/algorand/optIn', { __esModule: true, ensureWalletAssetOptIn: async () => {} });
stub('../lib/algorand/withRetry', { __esModule: true, withRetry: async (fn) => fn() });
stub('../lib/wallet/clients', {
  __esModule: true,
  getAlgodClient: () => ({
    // Vault liquidity + fee-sink opt-in checks both land here.
    accountAssetInformation: () => ({ do: async () => ({ 'asset-holding': { amount: 10_000_000_000 } }) })
  }),
  getIndexerClient: () => ({})
});
// dashfix-round3: claim.ts obtains its algod client from lib/algorand/failover (round 2),
// not lib/wallet/clients — without this stub the test made real network calls and was flaky.
// claim.ts only calls accountAssetInformation(...).do() on the client, so the same fake serves.
stub('../lib/algorand/failover', {
  __esModule: true,
  AlgodUnavailableError: class AlgodUnavailableError extends Error {},
  getFailoverAccountInfo: async () => ({}),
  getFailoverAssetBalance: async () => 0,
  getFailoverAlgodClient: async () => ({
    accountAssetInformation: () => ({ do: async () => ({ 'asset-holding': { amount: 10_000_000_000 } }) })
  })
});

stub('../lib/wallet/transactions', {
  __esModule: true,
  buildAssetTransferTxn: async (args) => {
    state.transfers.push(args);
    return `txn:${args.receiver}:${args.amount}`;
  }
});
stub('../lib/algorand/admin', {
  __esModule: true,
  decodeUnsignedTransaction: (t) => t,
  loadMnemonicAccountPair: () => ({ account: { addr: { toString: () => VAULT } } }),
  signAndSubmitCustodialTransactions: async () => ({ txId: 'TESTTXID' }),
  buildUserPaysClaimGroup: async (args) => {
    state.userPaysGroup = args;
    return {
      groupId: 'gid',
      signedServerLegsB64: [],
      unsignedUserLegB64: 'u',
      unsignedServerLegsB64: [],
      expected: {}
    };
  }
});
stub('../lib/api/deviceAction', {
  __esModule: true,
  withDeviceActionLock: async (_req, _res, _meta, run) => run()
});

const handler = require('../pages/api/rewards/claim.ts').default;

const runClaim = async () => {
  state.transfers = [];
  state.userPaysGroup = null;
  process.env.REWARD_USER_PAYS_GAS = state.userPays ? 'true' : 'false';
  const req = { method: 'POST', headers: {}, body: { miner_key: MINER, no: 18 } };
  const res = { status: () => res, json: () => res };
  return handler(req, res);
};

test('matured claim (custodial path) transfers the FULL amount and builds no FFG fee leg', async () => {
  state.feeSource = 'instant_claim';
  state.userPays = false;
  await runClaim();
  assert.equal(state.transfers.length, 1, `expected 1 transfer leg, got ${state.transfers.length}: ${JSON.stringify(state.transfers.map((t) => [t.receiver, t.amount]))}`);
  assert.equal(state.transfers[0].receiver, ADDR);
  assert.equal(state.transfers[0].amount, MICRO, 'matured claim must pay 100% of the claim');
  assert.ok(!state.transfers.some((t) => t.receiver === SINK), 'no FFG fee leg on a matured claim');
});

test('matured claim (user-pays path) sends the full reward and an empty feeLegs list', async () => {
  state.feeSource = 'instant_claim';
  state.userPays = true;
  await runClaim();
  assert.ok(state.userPaysGroup, 'user-pays group was not built');
  assert.deepEqual(state.userPaysGroup.feeLegs, [], 'matured claim must carry no FFG fee leg');
  assert.equal(state.userPaysGroup.assetLegs[0].rewardAmount, MICRO, 'matured claim must pay 100% of the claim');
});

test('fee stays config-driven: fee_source=matured_claim re-enables the 30% split', async () => {
  state.feeSource = 'matured_claim';
  state.userPays = false;
  await runClaim();
  const toUser = state.transfers.find((t) => t.receiver === ADDR);
  const toSink = state.transfers.find((t) => t.receiver === SINK);
  assert.ok(toUser, 'user leg missing');
  assert.ok(toSink, 'fee leg missing when the config opts matured claims in');
  assert.equal(toUser.amount, MICRO - Math.floor((MICRO * 3000) / 10000));
  assert.equal(toSink.amount, Math.floor(Math.floor((MICRO * 3000) / 10000) / 3));
});
