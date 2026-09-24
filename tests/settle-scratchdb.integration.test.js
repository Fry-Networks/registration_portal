// Integration: the confirm settle against a REAL mongod (scratch database, synthetic fixtures only).
//
// Runs only when SETTLE_IT_MONGO_URI points at a loopback mongod (e.g. an ephemeral mongo:8.0.18
// container). Without it the tests are reported as skipped with the reason; with SETTLE_IT_REQUIRED=1
// a missing URI is a FAILURE, so an evidence run can never pass by not running.
//
// Guards: loopback host only; server version must equal SETTLE_IT_EXPECT_VERSION (default 8.0.18);
// refuses to run if the server holds a database named 'main'; writes only to a fresh
// r14_scratch_settle_<ts>_<pid> database that is dropped afterwards.

const test = require('node:test');
const assert = require('node:assert/strict');

const URI = process.env.SETTLE_IT_MONGO_URI || '';
const REQUIRED = process.env.SETTLE_IT_REQUIRED === '1';
const EXPECT = process.env.SETTLE_IT_EXPECT_VERSION || '8.0.18';
const skip = !URI && !REQUIRED ? 'SETTLE_IT_MONGO_URI not set (scratch mongod integration test)' : false;

if (!URI && REQUIRED) {
  test('scratch mongod is required for this run', () => assert.fail('SETTLE_IT_REQUIRED=1 but SETTLE_IT_MONGO_URI is not set'));
} else {
  require('ts-node').register({ transpileOnly: true, compilerOptions: { module: 'commonjs', moduleResolution: 'node', target: 'ES2017', jsx: 'react' } });
  const { MongoClient, ObjectId } = require('mongodb');
  const realAlgosdk = require('algosdk');
  const stub = (relPath, exports) => { const r = require.resolve(relPath); require.cache[r] = { id: r, filename: r, loaded: true, exports }; };
  const VAULT = realAlgosdk.generateAccount(); const USER = realAlgosdk.generateAccount(); const USER_ADDR = String(USER.addr);
  const MINER = 'FEM-SCRATCHSETTLE0000000000000000000'; const CTRL = 'FEM-SCRATCHCONTROL000000000000000000'; const TFRY = '2681521901';
  let client = null; let db = null; const DBNAME = `r14_scratch_settle_${Date.now()}_${process.pid}`;
  let resolveDb; const dbReady = new Promise((r) => { resolveDb = r; });
  const logged = [];
  let currentGasTxId = '';

  if (URI) {
    const algosdkStub = Object.create(realAlgosdk);
    Object.defineProperty(algosdkStub, '__esModule', { value: true, enumerable: true });
    Object.defineProperty(algosdkStub, 'waitForConfirmation', { value: async () => ({ confirmedRound: 1 }), enumerable: true, configurable: true });
    Object.defineProperty(algosdkStub, 'default', { get: () => algosdkStub, enumerable: true });
    stub('algosdk', algosdkStub);
    stub('next-auth', { __esModule: true, getServerSession: async () => ({ user: { address: USER_ADDR } }) });
    stub('../pages/api/auth/[...nextauth].ts', { __esModule: true, authOptions: {} });
    stub('../lib/mongoclient', { __esModule: true, default: dbReady.then((d) => ({ db: () => d })) });
    stub('../lib/adminCheck', { __esModule: true, isAdminRequest: async () => true, isAdminWallet: async () => true, extractWalletFromRequest: () => USER_ADDR });
    stub('../lib/clientTokenMiddleware', { __esModule: true, verifyClientToken: async () => true });
    stub('../lib/requestSignature.server', { __esModule: true, verifyRequestSignatureAsync: async () => true });
    stub('../lib/deviceFingerprint', { __esModule: true, verifyDeviceFingerprintMiddleware: async () => 'ok' });
    stub('../lib/logger', { __esModule: true, loggers: { apiError: (e, err, m) => logged.push(m), txnLog: () => {}, api: () => {}, security: () => {} } });
    stub('../lib/discord-webhook', { __esModule: true, notifyDiscordError: async () => {} });
    stub('../lib/utils', { __esModule: true, getTransactionTime: async () => new Date() });
    stub('../lib/algorand/admin', { __esModule: true, loadMnemonicAccountPair: () => ({ address: String(VAULT.addr), account: { addr: VAULT.addr } }) });
    stub('../lib/wallet/clients', { __esModule: true, getAlgodClient: () => ({}), getIndexerClient: () => ({}) });
    stub('../pages/api/algorand/verify-txn.ts', { __esModule: true, verifyTransaction: async () => 'ok' });
    stub('../lib/algorand/verification', { __esModule: true, VERIFY_RESULT: { OK: 'ok', NOT_FOUND: 'not_found' } });
    stub('../lib/db/requestLocks', { __esModule: true, confirmJournalEntryByGroupId: async () => true });
    stub('../lib/algorand/failover', { __esModule: true, getFailoverAlgodClient: async () => ({ sendRawTransaction: () => ({ do: async () => ({ txid: currentGasTxId }) }) }) });
  }

  const typed = async (minerKey) => (await db.collection('device-rewards').aggregate([
    { $match: { miner_key: minerKey } },
    { $project: { _id: 0, arrays: { $map: { input: [{ $ifNull: ['$weekly_rewards', []] }, { $ifNull: ['$daily_rewards', []] }], as: 'arr', in: {
      $map: { input: '$$arr', as: 'e', in: { $map: { input: { $objectToArray: '$$e' }, as: 'kv', in: { k: '$$kv.k', t: { $type: '$$kv.v' }, v: '$$kv.v' } } } } } } } } },
  ]).toArray())[0].arrays;

  const seed = async (minerKey, G, G2) => {
    const W = (o) => ({ asset_id: TFRY, ...o });
    await db.collection('device-rewards').insertOne({
      miner_key: minerKey,
      weekly_rewards: [
        W({ _id: new ObjectId(), reward_number: 17, status: 'claiming', claiming_group: G, amount: 90, corrected_amount: 11.25, week_start: new Date('2025-12-25T00:00:00Z') }),
        W({ reward_number: 18, status: 'claiming', claiming_group: G, amount: 100, corrected_amount: 12.5, week_start: new Date('2026-01-08T00:00:00Z') }),
        W({ reward_number: 18, status: 'claiming', claiming_group: G, amount: 200, corrected_amount: 25.75, week_start: new Date('2026-03-19T00:00:00Z') }),
        W({ _id: new ObjectId(), reward_number: 31, status: 'claimable', amount: 50, week_start: '2025-07-31' }),
        W({ _id: new ObjectId(), reward_number: 31, status: 'claiming', claiming_group: G, amount: 6.4, week_start: new Date('2026-07-30T00:00:00Z') }),
        W({ _id: new ObjectId(), reward_number: 18, status: 'paid_onchain_partial', claiming_group: G, tx_id: 'R12BGASFIXTURE', r12b_run: 'r12b-fixture', r12b_paid_amount: 9.5, amount: 12.5, week_start: new Date('2026-05-15T00:00:00Z') }),
        W({ reward_number: 17, status: 'claimed', tx_id: 'OLDTX', claimed_amount: 7.7, claiming_group: 'OLDG', amount: 7.7, week_start: new Date('2025-06-05T00:00:00Z') }),
        W({ reward_number: 31, status: 'claiming', claiming_group: G2, amount: 70, week_start: new Date('2026-08-27T00:00:00Z') }),
        W({ reward_number: 40, status: 'claiming', claiming_group: G, amount: 10, week_start: '2026-02-05' }),
        W({ reward_number: 40, status: 'claiming', claiming_group: G, amount: 20, week_start: new Date('2026-02-05T00:00:00Z') }),
      ],
      daily_rewards: [
        W({ reward_number: 5, status: 'claiming', claiming_group: G, amount: 3.21, date: '2026-08-01' }),
        W({ reward_number: 5, status: 'claimable', amount: 2.5, date: '2026-07-02' }),
        W({ reward_number: 5, status: 'claimed', tx_id: 'OLDTX2', claimed_amount: 1.1, amount: 1.1, date: '2026-06-01' }),
      ],
    });
  };
  const RECORDS = [
    { source: 'weekly', reward_number: 17, asset_id: TFRY, amount: 11.25 }, { source: 'weekly', reward_number: 18, asset_id: TFRY, amount: 12.5 },
    { source: 'weekly', reward_number: 31, asset_id: TFRY, amount: 6.4 }, { source: 'weekly', reward_number: 40, asset_id: TFRY, amount: 10 },
    { source: 'daily', reward_number: 5, asset_id: TFRY, amount: 3.21 },
  ];
  let nonce = 900;
  const buildGroup = () => {
    nonce += 1;
    const base = { fee: 0, flatFee: true, firstValid: nonce, lastValid: nonce + 100, genesisID: 'mainnet-v1.0', genesisHash: new Uint8Array(32), minFee: 1000 };
    const leg0 = realAlgosdk.makePaymentTxnWithSuggestedParamsFromObject({ sender: USER.addr, receiver: VAULT.addr, amount: 10000, suggestedParams: { ...base, fee: 3000 } });
    const leg1 = realAlgosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({ sender: VAULT.addr, receiver: USER.addr, assetIndex: Number(TFRY), amount: 1000000, suggestedParams: { ...base } });
    realAlgosdk.assignGroupID([leg0, leg1]);
    return { groupId: Buffer.from(leg0.group).toString('base64'), signedUserLegB64: Buffer.from(leg0.signTxn(USER.sk)).toString('base64'), signedServerLegsB64: [Buffer.from(leg1.signTxn(VAULT.sk)).toString('base64')], gasTxId: leg0.txID() };
  };

  test.before(async () => {
    if (!URI) return;
    const host = new URL(URI.replace(/^mongodb(\+srv)?:\/\//, 'http://')).hostname;
    assert.ok(['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host), `refusing non-loopback host ${host}`);
    client = new MongoClient(URI, { directConnection: true, serverSelectionTimeoutMS: 5000 });
    await client.connect();
    const info = await client.db('admin').command({ buildInfo: 1 });
    console.log(`# scratch mongod version ${info.version}, db ${DBNAME}`);
    assert.equal(info.version, EXPECT, 'scratch mongod version');
    const dbs = (await client.db('admin').command({ listDatabases: 1, nameOnly: true })).databases.map((d) => d.name);
    assert.ok(!dbs.includes('main'), 'refusing: server holds a database named main');
    db = client.db(DBNAME); resolveDb(db);
  });
  test.after(async () => { if (db) await db.dropDatabase(); if (client) await client.close(); });

  test('POSITIVE CONTROL: on this engine the old predicate over-settles the fixture', { skip }, async () => {
    await seed(CTRL, 'GCTRL', 'GCTRL2');
    await db.collection('device-rewards').updateOne({ miner_key: CTRL }, { $set: { 'weekly_rewards.$[elem].status': 'claimed', 'weekly_rewards.$[elem].tx_id': 'CTRLTX' } },
      { arrayFilters: [{ 'elem.reward_number': { $in: [17, 18, 31, 40] }, 'elem.status': { $in: ['claimable', 'claiming'] } }] });
    const d = await db.collection('device-rewards').findOne({ miner_key: CTRL });
    const wrongly = [2, 3, 7, 9].filter((i) => d.weekly_rewards[i].status === 'claimed');
    assert.deepEqual(wrongly, [2, 3, 7, 9], 'old predicate must close the unpaid twin, the claimable sibling, the other group\'s row and the Date twin');
  });

  test('confirm on a real mongod settles exactly the paid elements; untouched elements keep value AND BSON type', { skip }, async () => {
    const group = buildGroup(); const G = group.groupId; const G2 = buildGroup().groupId;
    await seed(MINER, G, G2);
    const before = await typed(MINER);
    await db.collection('reward_pending_claims').insertOne({ groupId: G, miner_key: MINER, claimingAddress: USER_ADDR, signedServerLegsB64: group.signedServerLegsB64, status: 'pending', records: RECORDS });
    await db.collection('reward_pending_claims').insertOne({ groupId: G2, miner_key: MINER, claimingAddress: USER_ADDR, signedServerLegsB64: [], status: 'pending', records: [] });
    currentGasTxId = group.gasTxId;
    const handler = require('../pages/api/rewards/confirm.ts').default;
    const cap = {}; const res = { status(c) { cap.s = c; return this; }, json(p) { cap.b = p; return this; } };
    await handler({ method: 'POST', url: '/api/rewards/confirm', headers: {}, socket: {}, body: { groupId: G, signedUserLegB64: group.signedUserLegB64 } }, res);
    assert.equal(cap.s, 200, JSON.stringify(cap.b));
    const d = await db.collection('device-rewards').findOne({ miner_key: MINER });
    for (const [i, amt] of [[0, 11.25], [1, 12.5], [4, 6.4], [8, 10]]) {
      assert.equal(d.weekly_rewards[i].status, 'claimed', `weekly[${i}]`); assert.equal(d.weekly_rewards[i].tx_id, group.gasTxId); assert.equal(d.weekly_rewards[i].claimed_amount, amt);
    }
    assert.equal(d.daily_rewards[0].status, 'claimed');
    const after = await typed(MINER);
    for (const i of [2, 3, 5, 6, 7, 9]) assert.deepStrictEqual(after[0][i], before[0][i], `weekly[${i}] value+type untouched`);
    for (const i of [1, 2]) assert.deepStrictEqual(after[1][i], before[1][i], `daily[${i}] value+type untouched`);
    assert.equal(await db.collection('reward_pending_claims').countDocuments({ groupId: G }), 0, 'envelope deleted after a clean settle');
    assert.equal(await db.collection('reward_pending_claims').countDocuments({ groupId: G2 }), 1, 'other group envelope untouched');
  });

  test('custodial settle on a real mongod: positional writes hit exactly the selected elements (twins, held twin, drift, Date/string epochs); a changed index is a RACE', { skip }, async () => {
    const { settleRows } = require('../lib/rewards/settle');
    const CUST = 'FEM-SCRATCHCUSTODIAL0000000000000000';
    const ws = new Date('2026-01-08T00:00:00Z');
    await db.collection('device-rewards').insertOne({
      miner_key: CUST,
      weekly_rewards: [
        { reward_number: 18, status: 'claimable', asset_id: TFRY, amount: 100, corrected_amount: 12.5, week_start: ws },                     // 0 selected (no _id)
        { reward_number: 18, status: 'claimable', asset_id: TFRY, amount: 100, corrected_amount: 12.5, week_start: ws, payout_hold: true },  // 1 held twin: never settled
        { _id: new ObjectId(), reward_number: 18, status: 'claimable', asset_id: TFRY, amount: 200, corrected_amount: 25.75, week_start: new Date('2026-03-19T00:00:00Z') }, // 2 selected, drifts before settle
        { reward_number: 18, status: 'claimed', tx_id: 'OLDTX', claimed_amount: 7.7, asset_id: TFRY, amount: 7.7, week_start: new Date('2025-06-05T00:00:00Z') },        // 3 old claimed
        { reward_number: 18, status: 'claimable', asset_id: TFRY, amount: 12.5, week_start: '2026-01-08' },                                  // 4 string-epoch lookalike, not selected
      ],
      daily_rewards: [
        { reward_number: 5, status: 'claimable', asset_id: TFRY, amount: 3.21, date: '2026-08-01' },   // 0 selected
        { reward_number: 5, status: 'claimable', asset_id: TFRY, amount: 3.21, date: '2026-08-02' },   // 1 same rn + amount, not selected
      ],
    });
    const coll = db.collection('device-rewards');
    const snap = await coll.findOne({ miner_key: CUST });
    const selected = [snap.weekly_rewards[0], snap.weekly_rewards[2], snap.daily_rewards[0]];
    const records = [{ source: 'weekly', reward_number: 18, amount: 12.5 }, { source: 'weekly', reward_number: 18, amount: 25.75 }, { source: 'daily', reward_number: 5, amount: 3.21 }];
    await coll.updateOne({ miner_key: CUST }, { $set: { 'weekly_rewards.2.corrected_amount': 25.8 } }); // drift after the claim read, before the settle
    const before = await typed(CUST);
    const claimedAt = new Date('2026-09-24T20:00:00Z');
    const out = await settleRows(coll, { minerKey: CUST, txId: 'CUSTTX', claimedAt, records, selected });
    assert.deepEqual([out.settled, out.clean, out.issues.map((i) => i.code)], [3, true, ['AMOUNT_DRIFT']]);
    const d = await coll.findOne({ miner_key: CUST });
    for (const [arr, i, amt] of [['weekly_rewards', 0, 12.5], ['weekly_rewards', 2, 25.75], ['daily_rewards', 0, 3.21]]) {
      assert.equal(d[arr][i].status, 'claimed', `${arr}[${i}]`); assert.equal(d[arr][i].tx_id, 'CUSTTX'); assert.equal(d[arr][i].claimed_amount, amt);
      assert.equal(d[arr][i].claimed_at.getTime(), claimedAt.getTime());
    }
    const after = await typed(CUST);
    for (const i of [1, 3, 4]) assert.deepStrictEqual(after[0][i], before[0][i], `weekly[${i}] value+type untouched`);
    assert.deepStrictEqual(after[1][1], before[1][1], 'daily[1] value+type untouched');

    // RACE on the real engine: the element at the resolved index changes between the helper's read and its write.
    await coll.updateOne({ miner_key: CUST }, { $push: { weekly_rewards: { reward_number: 22, status: 'claimable', asset_id: TFRY, amount: 4, week_start: new Date('2026-04-02T00:00:00Z') } } });
    const snap2 = await coll.findOne({ miner_key: CUST });
    const racing = { findOne: async (q, o) => { const doc = await coll.findOne(q, o); await coll.updateOne({ miner_key: CUST }, { $set: { 'weekly_rewards.5.status': 'claiming', 'weekly_rewards.5.claiming_group': 'OTHER' } }); return doc; },
      updateOne: (f, u, o) => coll.updateOne(f, u, o) };
    const out2 = await settleRows(racing, { minerKey: CUST, txId: 'CUSTTX2', claimedAt, records: [{ source: 'weekly', reward_number: 22, amount: 4 }], selected: [snap2.weekly_rewards[5]] });
    assert.deepEqual([out2.settled, out2.clean, out2.issues.map((i) => i.code)], [0, false, ['RACE']]);
    const d2 = await coll.findOne({ miner_key: CUST });
    assert.equal(d2.weekly_rewards[5].status, 'claiming', 'the concurrently changed element is not overwritten');
    assert.equal(d2.weekly_rewards[5].tx_id, undefined);
  });
}
