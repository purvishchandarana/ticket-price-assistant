import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { HttpError } from '../src/lib/http.js';
import { ProviderError } from '../src/providers/Provider.js';
import { TicketmasterProvider, TM_SEGMENTS, pickPriceInput } from '../src/providers/ticketmaster.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/tm-events.json', import.meta.url), 'utf8'));
const NOW = new Date('2026-10-17T12:34:56.789Z');

function fakeHttp(response = fixture) {
  const calls = [];
  return {
    calls,
    async getJson(url) {
      calls.push(new URL(url));
      if (response instanceof Error) throw response;
      return response;
    },
  };
}

function provider(http, overrides = {}) {
  return new TicketmasterProvider({ apiKey: 'test-key', countryCode: 'US', http, now: () => NOW, ...overrides });
}

describe('TicketmasterProvider.search', () => {
  it('builds the Discovery API request', async () => {
    const http = fakeHttp();
    await provider(http).search({ category: 'sports', keyword: 'Lakers', qty: 2 });

    assert.equal(http.calls.length, 1);
    const url = http.calls[0];
    assert.equal(url.origin + url.pathname, 'https://app.ticketmaster.com/discovery/v2/events.json');
    assert.equal(url.searchParams.get('apikey'), 'test-key');
    assert.equal(url.searchParams.get('keyword'), 'Lakers');
    assert.equal(url.searchParams.get('segmentId'), TM_SEGMENTS.sports);
    assert.equal(url.searchParams.get('countryCode'), 'US');
    assert.equal(url.searchParams.get('startDateTime'), '2026-10-17T12:34:00Z');
  });

  it('maps events to the normalized shape', async () => {
    const events = await provider(fakeHttp()).search({ category: 'concerts', keyword: 'Aurora', qty: 2 });
    assert.equal(events.length, 4);

    const [allIn, standard, upcoming, cancelled] = events;

    assert.equal(allIn.id, 'ticketmaster:vvFAKE0001');
    assert.equal(allIn.source, 'ticketmaster');
    assert.equal(allIn.category, 'concerts');
    assert.equal(allIn.url, 'https://www.ticketmaster.com/event/vvFAKE0001');
    assert.equal(allIn.imageUrl, 'https://example.test/img/a-640.jpg');
    assert.deepEqual(allIn.venue, { name: 'Example Arena', city: 'Los Angeles', region: 'CA', country: 'US' });
    assert.equal(allIn.start.timezone, 'America/Los_Angeles');
    assert.equal(allIn.start.tba, false);
    assert.equal(allIn.onSale.status, 'onsale');
    // Prefers the "including fees" range even though "standard" has a lower min.
    assert.equal(allIn.price.total, 179);
    assert.equal(allIn.price.components.fees, 'included');
    assert.equal(allIn.price.confidence, 'medium');

    // Fees not published, so they're estimated with the Ticketmaster fee model.
    assert.equal(standard.price.total, 161.9);
    assert.equal(standard.price.components.fees, 'estimated');
    assert.equal(standard.price.confidence, 'low');

    assert.equal(upcoming.onSale.status, 'scheduled');
    assert.equal(upcoming.onSale.publicStart, '2026-11-01T17:00:00Z');
    assert.deepEqual(upcoming.onSale.presales, [
      { name: 'Fan Club Presale', start: '2026-10-28T17:00:00Z', end: '2026-10-30T03:00:00Z' },
    ]);
    assert.equal(upcoming.start.tba, true);
    assert.equal(upcoming.price.confidence, 'none');

    assert.equal(cancelled.onSale.status, 'cancelled');
    assert.equal(cancelled.venue, null);
    assert.equal(cancelled.imageUrl, null);
  });

  it('caches identical searches and keeps the API key out of the cache key', async () => {
    const http = fakeHttp();
    const tm = provider(http);
    await tm.search({ category: 'concerts', keyword: 'Aurora', qty: 1 });
    await tm.search({ category: 'concerts', keyword: 'Aurora', qty: 4 }); // qty doesn't change the request
    assert.equal(http.calls.length, 1);
    await tm.search({ category: 'concerts', keyword: 'Other', qty: 1 });
    assert.equal(http.calls.length, 2);
  });

  it('handles an empty result page', async () => {
    const events = await provider(fakeHttp({ page: { totalElements: 0 } })).search({ category: 'theatre', keyword: 'x' });
    assert.deepEqual(events, []);
  });

  it('refuses to call the API without a key', async () => {
    const http = fakeHttp();
    const tm = provider(http, { apiKey: '' });
    assert.equal(tm.isConfigured(), false);
    await assert.rejects(tm.search({ category: 'concerts', keyword: 'x' }), ProviderError);
    assert.equal(http.calls.length, 0);
  });

  it('turns HTTP failures into UI-safe provider errors', async () => {
    const cases = [
      [401, /rejected the API key/],
      [429, /rate limit/],
      [503, /HTTP 503/],
    ];
    for (const [status, pattern] of cases) {
      const tm = provider(fakeHttp(new HttpError('boom', { status })));
      await assert.rejects(tm.search({ category: 'concerts', keyword: 'x' }), (err) => {
        assert.ok(err instanceof ProviderError);
        assert.equal(err.expose, true);
        assert.match(err.message, pattern);
        return true;
      });
    }
  });
});

describe('pickPriceInput', () => {
  it('returns null when there are no usable ranges', () => {
    assert.equal(pickPriceInput(undefined), null);
    assert.equal(pickPriceInput([]), null);
    assert.equal(pickPriceInput([{ type: 'standard', currency: 'USD', min: 0, max: 0 }]), null);
  });

  it('picks the cheapest standard range when no all-in range exists', () => {
    const input = pickPriceInput([
      { type: 'standard', currency: 'USD', min: 80, max: 100 },
      { type: 'standard', currency: 'USD', min: 55, max: 70 },
    ]);
    assert.deepEqual(input, { currency: 'USD', base: 55, includesFees: false, priceKind: 'range-min' });
  });
});
