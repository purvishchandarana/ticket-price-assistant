import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createApp } from '../src/app.js';
import { openStore } from '../src/db/store.js';
import { isAllowedOrigin, isLoopbackHost } from '../src/lib/security.js';
import { Provider } from '../src/providers/Provider.js';
import { registryFromProviders } from '../src/providers/registry.js';

describe('security helpers', () => {
  it('accepts only loopback Host headers', () => {
    for (const host of ['localhost:3001', '127.0.0.1:3001', '[::1]:3001', 'localhost']) assert.equal(isLoopbackHost(host), true, host);
    for (const host of ['evil.example', 'evil.example:3001', '192.168.1.5:3001', undefined]) assert.equal(isLoopbackHost(host), false, String(host));
  });

  it('allows missing or listed origins only', () => {
    const allowed = ['http://localhost:5173'];
    assert.equal(isAllowedOrigin(undefined, allowed), true);
    assert.equal(isAllowedOrigin('http://localhost:5173', allowed), true);
    assert.equal(isAllowedOrigin('https://evil.example', allowed), false);
  });
});

describe('API origin protection', () => {
  let server;
  let base;
  const store = openStore(':memory:');

  before(async () => {
    const registry = registryFromProviders([new Provider({ id: 'demo', name: 'Demo', categories: ['concerts'] })]);
    const app = createApp({ config: { allowedOrigins: ['http://localhost:5173'] }, registry, store });
    await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => new Promise((r) => server.close(r)));

  const event = { id: 'demo:x', source: 'demo', sourceEventId: 'x', name: 'X', url: 'http://127.0.0.1:4100/events/x' };
  const post = (origin) => fetch(`${base}/api/watchlist`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) },
    body: JSON.stringify({ event, qty: 2 }),
  });

  it('rejects state-changing requests from other websites', async () => {
    assert.equal((await post('https://evil.example')).status, 403);
    assert.equal(store.watchlist.list().length, 0);
  });

  it('accepts requests from the app and from non-browser clients', async () => {
    assert.equal((await post('http://localhost:5173')).status, 201);
    assert.equal((await post(null)).status, 201);
    assert.equal(store.watchlist.list().length, 1);
  });

  it('validates event payloads', async () => {
    const res = await fetch(`${base}/api/watchlist`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ event: { ...event, url: 'javascript:alert(1)' }, qty: 2 }),
    });
    assert.equal(res.status, 400);
  });
});
