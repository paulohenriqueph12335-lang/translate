import assert from 'node:assert/strict';
import test from 'node:test';
import {
  advanceNotificationPolicy,
  createNotificationPolicy,
  loadNotificationSeen,
  notificationIntervalMs,
  saveNotificationSeen,
  type NotificationFrequency,
} from './notification-policy.ts';

const item = (id: string) => ({ id, title: `Notification ${id}` });

test('the first unread snapshot establishes a baseline even with a previous cache', () => {
  const result = advanceNotificationPolicy(createNotificationPolicy<{ id: string }>(['old']), [item('new'), item('old')], 'immediate', 100);
  assert.deepEqual(result.alerts, []);
  assert.deepEqual(result.fresh, []);
  assert.deepEqual([...result.state.seen], ['old', 'new']);
  assert.equal(result.state.lastAlertAt, 100);
});

test('immediate alerts deduplicate successive polls and preserve arrival order', () => {
  const baseline = advanceNotificationPolicy(createNotificationPolicy<{ id: string }>(), [item('1')], 'immediate', 0).state;
  const first = advanceNotificationPolicy(baseline, [item('3'), item('2'), item('1')], 'immediate', 20_000);
  assert.deepEqual(
    first.alerts.map(({ id }) => id),
    ['2', '3'],
  );
  const repeated = advanceNotificationPolicy(first.state, [item('3'), item('2'), item('1')], 'immediate', 40_000);
  assert.deepEqual(repeated.alerts, []);
  assert.deepEqual(repeated.fresh, []);
  assert.equal(baseline.seen.has('2'), false, 'advancing leaves the previous snapshot unchanged');
});

for (const frequency of ['5m', '15m', '1h'] satisfies NotificationFrequency[]) {
  test(`${frequency} accumulates notifications until the configured interval and starts a new window after delivery`, () => {
    const interval = notificationIntervalMs(frequency);
    const baseline = advanceNotificationPolicy(createNotificationPolicy<{ id: string }>(), [], frequency, 0).state;
    const waiting = advanceNotificationPolicy(baseline, [item('1')], frequency, 20_000);
    assert.deepEqual(waiting.alerts, []);
    const beforeBoundary = advanceNotificationPolicy(waiting.state, [item('2'), item('1')], frequency, interval - 1);
    assert.deepEqual(beforeBoundary.alerts, []);
    const delivery = advanceNotificationPolicy(beforeBoundary.state, [item('2'), item('1')], frequency, interval);
    assert.deepEqual(
      delivery.alerts.map(({ id }) => id),
      ['1', '2'],
    );
    const next = advanceNotificationPolicy(delivery.state, [item('3'), item('2'), item('1')], frequency, interval + 20_000);
    assert.deepEqual(next.alerts, []);
    const nextDelivery = advanceNotificationPolicy(next.state, [item('3'), item('2'), item('1')], frequency, 2 * interval);
    assert.deepEqual(
      nextDelivery.alerts.map(({ id }) => id),
      ['3'],
    );
  });
}

test('a notification read before a delayed delivery does not produce an alert', () => {
  const baseline = advanceNotificationPolicy(createNotificationPolicy<{ id: string }>(), [], '5m', 0).state;
  const waiting = advanceNotificationPolicy(baseline, [item('1')], '5m', 20_000).state;
  const delivery = advanceNotificationPolicy(waiting, [], '5m', 300_000);
  assert.deepEqual(delivery.alerts, []);
  assert.equal(delivery.state.pending.size, 0);
});

test('notification caches remain isolated per user', () => {
  const data = new Map<string, string>();
  const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => void data.set(key, value) };
  saveNotificationSeen(storage, 'alice', new Set(['1', '2']));
  saveNotificationSeen(storage, 'bob', new Set(['3']));
  assert.deepEqual([...loadNotificationSeen(storage, 'alice')], ['1', '2']);
  assert.deepEqual([...loadNotificationSeen(storage, 'bob')], ['3']);
});

test('unavailable, corrupt and incorrectly shaped browser storage never prevents notifications', () => {
  const unavailable = {
    getItem: () => {
      throw new Error('Storage denied');
    },
    setItem: () => {
      throw new Error('Storage full');
    },
  };
  assert.deepEqual([...loadNotificationSeen(unavailable, 'alice')], []);
  assert.doesNotThrow(() => saveNotificationSeen(unavailable, 'alice', new Set(['1'])));
  assert.deepEqual([...loadNotificationSeen({ getItem: () => '{broken' }, 'alice')], []);
  assert.deepEqual([...loadNotificationSeen({ getItem: () => '{"id":"1"}' }, 'alice')], []);
  assert.deepEqual([...loadNotificationSeen({ getItem: () => '[1,null,"valid"]' }, 'alice')], ['valid']);
  assert.deepEqual([...loadNotificationSeen(null, 'alice')], []);
});
