const test = require('node:test');
const assert = require('node:assert/strict');
const { MongoClient } = require('mongodb');

// The dead-clause removal is a no-op only while no device is owned via the user_id clause.
// This asserts that invariant against the live database, so a future backfill of
// devices.user_id would fail here rather than silently changing dashboard visibility.
const FIXTURES = [
  'SYNTHWALLETL6AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  'SYNTHWALLETBXAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  'SYNTHWALLETOKAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
];

async function withDb(fn) {
  const client = await MongoClient.connect(process.env.MONGO_URI);
  try {
    return await fn(client.db('main'));
  } finally {
    await client.close();
  }
}

test('no device is owned through the user_id clause', async () => {
  await withDb(async (db) => {
    const ids = [];
    const strs = [];
    const cursor = db.collection('registration-users').find({}, { projection: { _id: 1 } });
    for await (const r of cursor) {
      ids.push(r._id);
      strs.push(String(r._id));
    }
    const matched = await db.collection('devices').countDocuments({
      $or: [{ user_id: { $in: ids } }, { user_id: { $in: strs } }]
    });
    assert.equal(matched, 0, `${matched} devices would be owned via user_id; removal is no longer a no-op`);
  });
});

for (const wallet of FIXTURES) {
  test(`address-only ownership matches address+user_id for ${wallet.slice(0, 10)}…`, async () => {
    await withDb(async (db) => {
      const ru = await db
        .collection('registration-users')
        .findOne({ address: wallet }, { projection: { _id: 1 } });
      const clauses = [{ address: wallet }];
      if (ru) {
        clauses.push({ user_id: ru._id });
        clauses.push({ user_id: String(ru._id) });
      }
      const keys = async (q) =>
        (await db.collection('devices').find(q, { projection: { miner_key: 1, _id: 0 } }).sort({ miner_key: 1 }).toArray())
          .map((d) => d.miner_key);
      assert.deepEqual(await keys({ address: wallet }), await keys({ $or: clauses }));
    });
  });
}
