import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { openStore } from '../src/db/store.js';
import { normalizePrice } from '../src/pricing/normalizer.js';
import { registryFromProviders } from '../src/providers/registry.js';
import { createWatcher, diffEvent } from '../src/watcher/watcher.js';

const event = ({ status = 'scheduled', base = 1000 } = {}) => ({
  id: 'demo:show-1',
  source: 'demo',
  sourceName: 'Demo',
  sourceEventId: 'show-1',
  name: 'Show One',
  url: 'http://127.0.0.1:4100/events/show-1',
  category: 'concerts',
  start: { localDate: '2026-12-01' },
  venue: { name: 'Hall', city: 'Pune' },
  onSale: { status },
  price: normalizePrice({ currency: 'INR', base, includesFees: true, includesTaxes: true }, { qty: 2 }),
});

describe('store', () => {
  it('keeps a watchlist with price history', () => {
    const store = openStore(':memory:');
    store.watchlist.add(event(), 2);
    assert.equal(store.watchlist.list().length, 1);
    const item = store.watchlist.get('demo:show-1');
    assert.equal(item.lastStatus, 'scheduled');
    assert.equal(item.lastTotalMinor, 200000);
    assert.equal(item.event.name, 'Show One');

    store.watchlist.recordCheck('demo:show-1', event({ status: 'onsale', base: 900 }));
    assert.equal(store.watchlist.get('demo:show-1').lastStatus, 'onsale');
    assert.equal(store.watchlist.history('demo:show-1').length, 1);

    assert.equal(store.watchlist.remove('demo:show-1'), true);
    assert.equal(store.watchlist.remove('demo:show-1'), false);
    store.close();
  });

  it('stores alerts with unread counts', () => {
    const store = openStore(':memory:');
    const a = store.alerts.add({ type: 'status', title: 'On sale', message: 'm' });
    store.alerts.add({ type: 'price_drop', title: 'Drop', message: 'm' });
    assert.equal(store.alerts.unreadCount(), 2);
    store.alerts.markRead([a.id]);
    assert.equal(store.alerts.unreadCount(), 1);
    store.alerts.markRead('all');
    assert.equal(store.alerts.unreadCount(), 0);
    store.close();
  });

  it('persists session state', () => {
    const store = openStore(':memory:');
    store.sessions.save({ id: 's1', status: 'running', createdAt: '2026-10-17T00:00:00Z', step: 1 });
    store.sessions.save({ id: 's1', status: 'paused', createdAt: '2026-10-17T00:00:00Z', step: 2 });
    assert.deepEqual(store.sessions.latest(), { id: 's1', status: 'paused', createdAt: '2026-10-17T00:00:00Z', step: 2 });
    store.close();
  });
});

describe('diffEvent', () => {
  it('reports status changes and price drops', () => {
    const changes = diffEvent(
      { lastStatus: 'scheduled', lastTotalMinor: 200000, lastCurrency: 'INR' },
      event({ status: 'onsale', base: 900 }),
    );
    assert.deepEqual(changes.map((c) => c.type), ['status', 'price_drop']);
    assert.match(changes[0].title, /^On sale now: Show One/);
    assert.match(changes[1].message, /₹2,000.*₹1,800/);
  });

  it('stays quiet when nothing meaningful changed', () => {
    assert.deepEqual(diffEvent({ lastStatus: 'onsale', lastTotalMinor: 100, lastCurrency: 'INR' }, event({ status: 'onsale', base: 1000 })), []);
    assert.deepEqual(diffEvent({ lastStatus: 'onsale' }, event({ status: 'unknown' })), []);
  });
});

describe('watcher', () => {
  it('checks watched events, records history and raises alerts', async () => {
    const store = openStore(':memory:');
    store.watchlist.add(event(), 2);
    let next = event({ status: 'onsale', base: 950 });
    const provider = {
      id: 'demo', isConfigured: () => true,
      getEvent: async (id, { qty }) => { assert.equal(id, 'show-1'); assert.equal(qty, 2); return next; },
    };
    const alerts = [];
    const notified = [];
    const watcher = createWatcher({
      store,
      registry: registryFromProviders([provider]),
      intervalMs: 60_000,
      onAlert: (a) => alerts.push(a),
      notify: async (a) => { notified.push(a.type); },
    });

    await watcher.checkAll();
    assert.deepEqual(alerts.map((a) => a.type), ['status', 'price_drop']);
    assert.deepEqual(notified, ['status', 'price_drop']);
    assert.equal(store.alerts.unreadCount(), 2);
    assert.equal(store.watchlist.get('demo:show-1').lastStatus, 'onsale');

    // Same state again: no new alerts.
    await watcher.checkAll();
    assert.equal(alerts.length, 2);

    // Provider error is recorded, not thrown.
    provider.getEvent = async () => { const e = new Error('Demo down'); e.expose = true; throw e; };
    await watcher.checkAll();
    assert.equal(store.watchlist.get('demo:show-1').lastError, 'Demo down');
    next = null;
    store.close();
  });
});
