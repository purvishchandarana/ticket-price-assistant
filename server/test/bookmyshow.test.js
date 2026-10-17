import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BrowserAgent } from '../src/automation/browserAgent.js';
import { BookMyShowProvider, bookMyShowSearchHits, parseBookMyShowPage } from '../src/providers/bookmyshow.js';

const NOW = new Date('2026-10-17T12:00:00Z');
const EVENT_URL = 'https://in.bookmyshow.com/events/swar-parampara/ET00522026';

const musicEvent = (overrides = {}) => ({
  '@context': 'https://schema.org',
  '@type': 'MusicEvent',
  name: 'SWAR PARAMPARA',
  startDate: '2026-11-06T06:15:00+05:30',
  endDate: '2026-11-06T08:15:00+05:30',
  eventStatus: 'https://schema.org/EventScheduled',
  location: {
    '@type': 'Place',
    name: 'Phoenix Avenue Of Stars: Pune',
    address: { '@type': 'PostalAddress', addressLocality: 'Pune', addressRegion: 'MH', addressCountry: 'IN', streetAddress: 'Viman Nagar, Pune' },
  },
  offers: {
    '@type': 'AggregateOffer', priceCurrency: 'INR', lowPrice: 499, highPrice: 1180, offerCount: 3,
    offers: [
      { '@type': 'Offer', name: 'SILVER', price: '499.00', priceCurrency: 'INR', validFrom: '2026-10-10T16:08:27+05:30', validThrough: '2026-11-06T06:15:00+05:30', availability: 'https://schema.org/InStock' },
      { '@type': 'Offer', name: 'GOLD', price: '826.00', priceCurrency: 'INR', validFrom: '2026-10-10T16:08:27+05:30', validThrough: '2026-11-06T06:15:00+05:30', availability: 'https://schema.org/InStock' },
    ],
  },
  url: EVENT_URL,
  ...overrides,
});

// BookMyShow wraps its JSON-LD in arrays alongside other types.
const page = (event = musicEvent()) => `<html><head>
  <script type="application/ld+json">{"@type":"WebSite","name":"BookMyShow"}</script>
  <script type="application/ld+json">[${JSON.stringify(event)},{"@type":"BreadcrumbList"}]</script>
</head><body></body></html>`;

const searchJson = (cards) => ({ data: { widgets: { 'search-vi-v2-results': { data: { cards: { data: cards } } } } } });
const card = (identifier, title, url, extra = {}) => ({
  data: { identifier, 'result-title': title, 'result-location': extra.location ?? '', cta: { url, analytics: { metadata: { content_status: 'bookable' } } } },
});

describe('BookMyShow parsing', () => {
  it('maps event subtypes and treats listed prices as GST-inclusive', () => {
    const [event] = parseBookMyShowPage(page(), EVENT_URL, { qty: 2, now: NOW });
    assert.equal(event.id, 'bookmyshow:/events/swar-parampara/ET00522026');
    assert.equal(event.category, 'concerts'); // MusicEvent
    assert.equal(event.venue.city, 'Pune');
    assert.equal(event.onSale.status, 'onsale');
    // 2 × ₹499 + 10% estimated convenience fee (99.80) + 18% GST on that fee (17.96); no GST added on the ticket.
    assert.equal(event.price.total, 1115.76);
    assert.equal(event.price.components.fees, 'estimated');
    assert.equal(event.price.confidence, 'low');
    assert.ok(event.price.notes.some((n) => /include GST/.test(n)));
  });

  it('marks a sale that has ended as not on sale', () => {
    const [event] = parseBookMyShowPage(page(), EVENT_URL, { now: new Date('2026-11-07T00:00:00Z') });
    assert.notEqual(event.onSale.status, 'onsale');
  });

  it('keeps only relevant event hits from search', () => {
    const json = searchJson([
      card('1088020', 'Rabi Parampara', 'https://in.bookmyshow.com/person/rabi-parampara/1088020'),
      card('ET00522026', 'SWAR PARAMPARA', EVENT_URL, { location: 'Phoenix Avenue Of Stars: Pune' }),
      card('SMQW', 'Sachi Navratri', 'https://in.bookmyshow.com/explore/c/venues/sachi-navratri-ahmedabad/smqw'),
      card('ET00522085', 'Navratri garba Night', 'https://in.bookmyshow.com/activities/navratri-garba-night/ET00522085'),
      card('ET00000001', 'Unrelated Comedy Night', 'https://in.bookmyshow.com/events/unrelated/ET00000001'),
    ]);
    assert.deepEqual(bookMyShowSearchHits(json, 'parampara navratri').map((h) => h.code), ['ET00522026', 'ET00522085']);
  });
});

describe('BookMyShowProvider', () => {
  function fakeAgent({ available = true } = {}) {
    const requested = [];
    return {
      requested,
      available: async () => available,
      withTab: async (origin, fn) => {
        assert.equal(origin, 'https://in.bookmyshow.com');
        return fn({
          fetchJson: async (url) => { requested.push(url); return searchJson([card('ET00522026', 'SWAR PARAMPARA', EVENT_URL)]); },
          fetchText: async (url) => { requested.push(url); return page(); },
        });
      },
    };
  }

  it('searches through the browser agent and parses event pages', async () => {
    const agent = fakeAgent();
    const bms = new BookMyShowProvider({ agent, now: () => NOW });
    const events = await bms.search({ keyword: 'swar parampara', qty: 1, city: 'Pune' });
    assert.equal(events.length, 1);
    assert.match(agent.requested[0], /^\/api\/v1\/search\/dynamic\?q=swar%20parampara&/);
    assert.equal(agent.requested[1], EVENT_URL);
    assert.equal((await bms.search({ keyword: 'swar parampara', city: 'Delhi' })).length, 0);
  });

  it('explains that Chrome is needed when it is not running', async () => {
    const bms = new BookMyShowProvider({ agent: fakeAgent({ available: false }) });
    await assert.rejects(bms.search({ keyword: 'x' }), /Start Chrome/);
  });
});

describe('BrowserAgent', () => {
  function fakeBrowser({ robots = 'User-agent: *\nDisallow: /private', challengeUntil = 0 } = {}) {
    const state = { url: 'about:blank', fetches: [], challengeChecks: 0 };
    const page = {
      url: () => state.url,
      isClosed: () => false,
      goto: async (url) => { state.url = url; },
      bringToFront: async () => {},
      evaluate: async (_fn, url) => {
        state.fetches.push(url);
        if (url.endsWith('/robots.txt')) return { status: 200, text: robots };
        return { status: 200, text: `body of ${url}` };
      },
    };
    const browser = {
      status: async () => ({ reachable: true }),
      getContext: async () => ({ newPage: async () => page }),
    };
    const detectChallenge = async () => {
      state.challengeChecks++;
      return state.challengeChecks <= challengeUntil ? { detected: true, reasons: ['bot check'] } : { detected: false, reasons: [] };
    };
    return { state, browser, detectChallenge };
  }

  it('fetches same-origin pages in the helper tab and honours robots.txt', async () => {
    const { state, browser, detectChallenge } = fakeBrowser();
    const agent = new BrowserAgent({ browser, detectChallenge, minIntervalMs: 0, pollMs: 1 });
    const text = await agent.withTab('https://site.test', (tab) => tab.fetchText('/events/a'));
    assert.equal(text, 'body of https://site.test/events/a');
    assert.deepEqual(state.fetches, ['https://site.test/robots.txt', 'https://site.test/events/a']);
    await assert.rejects(agent.withTab('https://site.test', (tab) => tab.fetchText('/private/x')), /robots\.txt disallows/);
  });

  it('waits for the human to clear a challenge and reports it', async () => {
    const { browser, detectChallenge } = fakeBrowser({ challengeUntil: 2 });
    const agent = new BrowserAgent({ browser, detectChallenge, minIntervalMs: 0, pollMs: 1 });
    const seen = [];
    agent.on('attention', (e) => seen.push(['attention', e.reasons[0]]));
    agent.on('cleared', () => seen.push(['cleared']));
    await agent.withTab('https://site.test', (tab) => tab.goto('/'));
    assert.deepEqual(seen, [['attention', 'bot check'], ['cleared']]);
  });

  it('gives up with a clear message if the challenge is never completed', async () => {
    const { browser, detectChallenge } = fakeBrowser({ challengeUntil: Infinity });
    const agent = new BrowserAgent({ browser, detectChallenge, minIntervalMs: 0, pollMs: 1, challengeTimeoutMs: 20 });
    await assert.rejects(agent.withTab('https://site.test', (tab) => tab.goto('/')), /showing a check in Chrome/);
  });

  it('reports when Chrome is not running', async () => {
    const agent = new BrowserAgent({ browser: { status: async () => ({ reachable: false }) } });
    await assert.rejects(agent.withTab('https://site.test', async () => {}), /Chrome is not running/);
  });
});
