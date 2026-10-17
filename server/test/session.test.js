import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SessionManager } from '../src/automation/sessionManager.js';
import { openStore } from '../src/db/store.js';

const EVENT = {
  id: 'demo:show', source: 'demo', sourceName: 'Demo', sourceEventId: 'show', name: 'Show',
  url: 'http://127.0.0.1:4100/events/show',
};

async function until(predicate, timeoutMs = 3000) {
  const end = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > end) throw new Error('timed out waiting for condition');
    await new Promise((r) => setTimeout(r, 5));
  }
}

function harness({ steps } = {}) {
  const world = { challenge: false, seatMap: false, fronted: 0, screencastStopped: 0, ran: [] };
  const listeners = {};
  const page = {
    _url: 'about:blank',
    url: () => page._url,
    isClosed: () => false,
    mainFrame: () => 'main',
    on: (name, fn) => { (listeners[name] ??= []).push(fn); },
    off: () => {},
    bringToFront: async () => { world.fronted++; },
    navigate(url) {
      page._url = url;
      for (const fn of listeners.framenavigated ?? []) fn('main');
    },
    close() {
      for (const fn of listeners.close ?? []) fn();
    },
  };
  const adapter = {
    id: 'fake',
    label: 'Fake adapter',
    matches: () => true,
    isPaymentUrl: (url) => url.includes('/checkout/payment'),
    isAtPayment: async (p) => p.url().includes('/checkout/payment'),
    prepare: steps ?? (async (p, { event, qty }, ctx) => {
      await ctx.step('open', 'Open event', async () => { world.ran.push('open'); p.navigate(event.url); });
      await ctx.step('qty', `Quantity ${qty}`, async () => { world.ran.push('qty'); });
      await ctx.step('find', 'Find tickets', async () => { world.ran.push('find'); world.challenge = true; });
      await ctx.waitFor('seats', 'Wait for seat map', () => world.seatMap, { intervalMs: 5 });
    }),
  };
  const store = openStore(':memory:');
  const manager = new SessionManager({
    store,
    browser: { getContext: async () => ({ newPage: async () => page }), findPage: async () => null },
    pickAdapter: () => adapter,
    detectChallenge: async () => (world.challenge ? { detected: true, reasons: ['queue text'] } : { detected: false, reasons: [] }),
    startScreencast: async () => async () => { world.screencastStopped++; },
    delay: async () => {},
    pollMs: 5,
  });
  const events = [];
  for (const name of ['paused', 'resumed', 'payment']) manager.on(name, (p) => events.push([name, p.reason ?? p.by ?? '']));
  return { world, page, manager, store, events };
}

describe('SessionManager', () => {
  it('pauses on a challenge, resumes automatically, hands off, and stops at payment', async () => {
    const { world, page, manager, events } = harness();
    await manager.start({ event: EVENT, qty: 2, filters: {} });

    await until(() => manager.current().status === 'paused');
    assert.equal(manager.current().pauseReason, 'challenge');
    assert.deepEqual(events[0], ['paused', 'challenge']);
    assert.ok(world.fronted >= 2, 'tab brought to front for the challenge');

    world.challenge = false; // user completed the check
    await until(() => events.some(([n, by]) => n === 'resumed' && by === 'auto'));
    world.seatMap = true;
    await until(() => manager.current().status === 'your_turn');
    assert.deepEqual(world.ran, ['open', 'qty', 'find']);

    page.navigate('http://127.0.0.1:4100/checkout/payment');
    await until(() => manager.current().status === 'at_payment');
    assert.ok(events.some(([n]) => n === 'payment'));
    assert.equal(world.screencastStopped, 1);
    assert.equal(manager.isActive(), false);
  });

  it('allows only one active session at a time', async () => {
    const { manager } = harness();
    await manager.start({ event: EVENT, qty: 1 });
    await assert.rejects(manager.start({ event: EVENT, qty: 1 }), { status: 409 });
    await manager.stop();
  });

  it('pause/continue by the user returns to the previous state', async () => {
    const { world, manager } = harness();
    await manager.start({ event: EVENT, qty: 1 });
    await until(() => manager.current().status === 'paused');
    world.challenge = false;
    world.seatMap = true;
    await until(() => manager.current().status === 'your_turn');

    manager.pause();
    assert.equal(manager.current().status, 'paused');
    await manager.continue();
    assert.equal(manager.current().status, 'your_turn');
    await manager.stop();
  });

  it('continue overrides a challenge pause', async () => {
    const { manager } = harness();
    await manager.start({ event: EVENT, qty: 1 });
    await until(() => manager.current().status === 'paused');
    await manager.continue();
    assert.ok(['running', 'paused'].includes(manager.current().status));
    await manager.stop();
  });

  it('stop halts automation and leaves the tab alone', async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    const ran = [];
    const { manager } = harness({
      steps: async (_p, _o, ctx) => {
        await ctx.step('one', 'One', async () => { ran.push('one'); await gate; });
        await ctx.step('two', 'Two', async () => { ran.push('two'); });
      },
    });
    await manager.start({ event: EVENT, qty: 1 });
    await until(() => ran.length === 1);
    await manager.stop();
    release();
    await new Promise((r) => setTimeout(r, 30));
    assert.deepEqual(ran, ['one']);
    assert.equal(manager.current().status, 'stopped');
  });

  it('stops when the user closes the tab', async () => {
    const { page, manager } = harness();
    await manager.start({ event: EVENT, qty: 1 });
    page.close();
    await until(() => manager.current().status === 'stopped');
  });

  it('marks a session that was active at shutdown as interrupted', () => {
    const { store } = harness();
    store.sessions.save({ id: 'old', status: 'running', createdAt: '2026-10-17T00:00:00Z', timeline: [] });
    const manager = new SessionManager({ store, browser: {}, pickAdapter: () => null });
    manager.init();
    assert.equal(manager.current().status, 'interrupted');
    assert.equal(manager.isActive(), true);
  });
});
