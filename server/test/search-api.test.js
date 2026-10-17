import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createApp } from '../src/app.js';
import { normalizePrice } from '../src/pricing/normalizer.js';
import { Provider, ProviderError } from '../src/providers/Provider.js';
import { registryFromProviders } from '../src/providers/registry.js';

class FakeProvider extends Provider {
  constructor(id, events, { fail, configured = true } = {}) {
    super({ id, name: id.toUpperCase(), categories: ['concerts', 'sports'] });
    this.events = events;
    this.fail = fail;
    this.configured = configured;
    this.queries = [];
  }
  isConfigured() { return this.configured; }
  async search(query) {
    this.queries.push(query);
    if (this.fail) throw this.fail;
    return this.events.map(([name, base]) => ({
      id: `${this.id}:${name}`,
      name,
      price: normalizePrice(base == null ? null : { currency: 'USD', base, includesFees: true }, { qty: query.qty }),
    }));
  }
}

describe('GET /api/search', () => {
  let server;
  let baseUrl;
  const alpha = new FakeProvider('alpha', [['A-pricey', 120], ['A-unpriced', null]]);
  const beta = new FakeProvider('beta', [['B-cheap', 40]]);
  const broken = new FakeProvider('broken', [], { fail: new ProviderError('broken', 'Upstream is down') });
  const unconfigured = new FakeProvider('off', [['never', 1]], { configured: false });

  before(async () => {
    const app = createApp({
      config: { preferredCurrency: 'USD' },
      registry: registryFromProviders([alpha, beta, broken, unconfigured]),
    });
    await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => new Promise((resolve) => server.close(resolve)));

  const get = async (path) => {
    const res = await fetch(baseUrl + path);
    return { status: res.status, body: await res.json() };
  };

  it('merges providers, sorts by total and reports per-source status', async () => {
    const { status, body } = await get('/api/search?category=concerts&q=%20aurora%20&qty=2');
    assert.equal(status, 200);
    assert.deepEqual(body.query, { category: 'concerts', keyword: 'aurora', qty: 2 });
    assert.deepEqual(body.results.map((r) => r.name), ['B-cheap', 'A-pricey', 'A-unpriced']);
    assert.equal(body.results[0].price.total, 80);
    assert.deepEqual(body.sources, [
      { id: 'alpha', name: 'ALPHA', ok: true, count: 2 },
      { id: 'beta', name: 'BETA', ok: true, count: 1 },
      { id: 'broken', name: 'BROKEN', ok: false, error: 'Upstream is down' },
    ]);
    assert.equal(unconfigured.queries.length, 0);
  });

  it('warns when no provider covers the category', async () => {
    const { status, body } = await get('/api/search?category=theatre&q=hamlet');
    assert.equal(status, 200);
    assert.deepEqual(body.results, []);
    assert.equal(body.warnings.length, 1);
  });

  for (const [label, qs, pattern] of [
    ['unknown category', 'category=opera&q=x', /category/],
    ['missing keyword', 'category=concerts&q=%20', /q \(event name\)/],
    ['qty above purchase limit', 'category=concerts&q=x&qty=9', /qty/],
    ['fractional qty', 'category=concerts&q=x&qty=1.5', /qty/],
  ]) {
    it(`rejects ${label} with 400`, async () => {
      const { status, body } = await get(`/api/search?${qs}`);
      assert.equal(status, 400);
      assert.match(body.error, pattern);
    });
  }

  it('lists providers with their configuration state', async () => {
    const { body } = await get('/api/providers');
    assert.deepEqual(body.map((p) => [p.id, p.configured]), [
      ['alpha', true], ['beta', true], ['broken', true], ['off', false],
    ]);
  });
});
