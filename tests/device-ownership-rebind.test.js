const test = require('node:test');
const assert = require('node:assert/strict');
const { MongoClient } = require('mongodb');

// Regression guard for the "premature device-wallet binding" state described in
// pages/api/registrations/create.ts (address === device_algo_address). Devices left in that
// state resolve to no owner, so /api/my-keys, /api/devices/list and
// /api/devices/status-summary all report zero for the rightful wallet.
const WALLET = 'SYNTHWALLETL6AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const EXPECTED_MINER_KEYS = [
  'FEM-ABCECB4JMH7HR6K7M8PWWA9RSDLAW111',
  'FEM-K3QVR1OQ8Q76EP59OERY68SUTT16YF3L',
];

// Mirrors the ownership resolution in pages/api/devices/list.ts (address OR user_id).
async function resolveOwnedDevices(db, wallet) {
  const userDoc = await db
    .collection('registration-users')
    .findOne({ address: wallet }, { projection: { _id: 1 } });
  const clauses = [{ address: wallet }];
  if (userDoc?._id) {
    clauses.push({ user_id: userDoc._id });
    clauses.push({ user_id: userDoc._id.toString() });
  }
  return db
    .collection('devices')
    .find({ $or: clauses })
    .project({ miner_key: 1, address: 1, reward_wallet: 1, device_algo_address: 1 })
    .toArray();
}

test('dashboard ownership query resolves every device registered to the wallet', async () => {
  const client = await MongoClient.connect(process.env.MONGO_URI);
  try {
    const db = client.db('main');
    const owned = await resolveOwnedDevices(db, WALLET);
    const keys = owned.map((d) => d.miner_key);
    for (const expected of EXPECTED_MINER_KEYS) {
      assert.ok(
        keys.includes(expected),
        `${expected} is registered to ${WALLET} but the ownership query did not return it`
      );
    }
  } finally {
    await client.close();
  }
});

test('no device registered to the wallet is bound to its own device wallet', async () => {
  const client = await MongoClient.connect(process.env.MONGO_URI);
  try {
    const db = client.db('main');
    const devices = await db
      .collection('devices')
      .find({ miner_key: { $in: EXPECTED_MINER_KEYS } })
      .project({ miner_key: 1, address: 1, reward_wallet: 1, device_algo_address: 1 })
      .toArray();
    assert.equal(devices.length, EXPECTED_MINER_KEYS.length);
    for (const d of devices) {
      assert.notEqual(
        d.address,
        d.device_algo_address,
        `${d.miner_key} address is its own device wallet, so it has no resolvable owner`
      );
      assert.equal(d.address, WALLET, `${d.miner_key} address should be the owner wallet`);
      assert.equal(
        d.reward_wallet,
        WALLET,
        `${d.miner_key} reward_wallet should be the owner wallet (claim.ts pays device.reward_wallet)`
      );
    }
  } finally {
    await client.close();
  }
});
