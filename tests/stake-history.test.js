const assert = require('node:assert/strict');
const test = require('node:test');

const { collectStakeHistory } = require('../lib/history/collectStakeHistory.js');

test('collectStakeHistory orders mixed stake and withdrawal history', () => {
  const device = {
    staked: {
      amount: 0,
      asset_id: 'fry',
      txId: 'stake-current',
      time: '2024-10-01T00:00:00Z',
      type: 'two',
      history: [
        {
          amount: 400,
          asset_id: 'fry',
          txId: 'stake-previous',
          time: '2024-04-01T00:00:00Z',
          type: 'two'
        },
        {
          amount: 300,
          asset_id: 'fry',
          txId: 'stake-original',
          time: '2023-10-01T00:00:00Z',
          type: 'one'
        }
      ],
      withdrawals: [
        {
          amount: 400,
          asset_id: 'fry',
          txId: 'withdraw-april',
          time: '2024-07-15T00:00:00Z',
          type: 'two'
        }
      ],
      lastWithdrawal: {
        amount: 200,
        asset_id: 'fry',
        txId: 'withdraw-october',
        time: '2024-10-05T00:00:00Z',
        type: 'one'
      }
    }
  };

  const history = collectStakeHistory(device);
  const events = history.verification;

  assert.equal(events.length, 5);
  assert.deepEqual(
    events.map((event) => event.txId),
    [
      'withdraw-october',
      'stake-current',
      'withdraw-april',
      'stake-previous',
      'stake-original'
    ]
  );
  assert.equal(events[0].action, 'withdrawn');
  assert.equal(events[0].amount, 200);
  assert.equal(events[1].action, 'staked');
  assert.equal(events[1].amount, 200);
  assert.equal(events[1].lockType, 'two');
  assert.ok(events.every((event, idx, arr) => idx === 0 || new Date(event.time) <= new Date(arr[idx - 1].time)));
});

test('collectStakeHistory handles sparse registration and node data', () => {
  const device = {
    registration: {
      amount: 100,
      asset_id: 'reg',
      txId: 'reg-stake',
      time: '2024-02-01T12:30:00Z',
      withdrawals: [],
      history: []
    },
    node: {
      amount: 0,
      asset_id: 'node',
      txId: 'node-stake',
      time: '2024-03-01T00:00:00Z',
      withdrawals: [
        {
          amount: 120,
          asset_id: 'node',
          txId: 'node-withdraw',
          time: '2024-04-01T00:00:00Z'
        }
      ],
      lastWithdrawal: {
        amount: 120,
        asset_id: 'node',
        txId: 'node-withdraw',
        time: '2024-04-01T00:00:00Z'
      }
    }
  };

  const history = collectStakeHistory(device);

  assert.equal(history.registration.length, 1);
  assert.equal(history.registration[0].action, 'staked');
  assert.equal(history.registration[0].amount, 100);

  assert.equal(history.node.length, 2);
  assert.equal(history.node[0].action, 'withdrawn');
  assert.equal(history.node[0].amount, 120);
  assert.equal(history.node[1].action, 'staked');
  assert.equal(history.node[1].amount, 120);
});

test('collectStakeHistory returns empty arrays when stake data missing', () => {
  const history = collectStakeHistory({});
  assert.deepEqual(history, {
    verification: [],
    registration: [],
    node: []
  });
});
