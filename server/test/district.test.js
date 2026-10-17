import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseSitemap } from '../src/lib/html.js';
import {
  DistrictProvider, admitsFromTierName, cityVariants, districtSearchHits, parseDistrictPage, rankSitemapEntries,
} from '../src/providers/district.js';

const NOW = new Date('2026-10-17T12:00:00Z');
const PAGE_URL = 'https://www.district.in/events/laugh-out-loud-mumbai-nov8-2026-buy-tickets';

/** A synthetic page with the same shape as District's: JSON-LD + Next.js payload. */
function makePage({ ldEvents, items = [], categories = ['Comedy'] }) {
  const ld = ldEvents.map((e) => `<script type="application/ld+json">${JSON.stringify(e)}</script>`).join('');
  const faq = '<script type="application/ld+json">{"@context":"https://schema.org","@type":"FAQPage","mainEntity":[]}</script>';
  const tags = categories.map((name) => ({ tag_id: { _id: 'x' }, display_name: name, tag_type: 'category', level: 0 }));
  const flight = `5:["$","div",null,{"data":{"items":${JSON.stringify(items)},"tags":${JSON.stringify(tags)}}}]\n`;
  // Split the payload across two pushes, as Next.js does.
  const half = Math.floor(flight.length / 2);
  const pushes = [flight.slice(0, half), flight.slice(half)]
    .map((chunk) => `<script>self.__next_f.push([1,${JSON.stringify(chunk)}])</script>`).join('');
  return `<!doctype html><html><head>${ld}${faq}</head><body><h1>Event</h1>${pushes}</body></html>`;
}

const comedyEvent = (overrides = {}) => ({
  '@context': 'https://schema.org',
  '@type': 'Event',
  name: 'Laugh Out Loud Live',
  url: PAGE_URL,
  image: 'https://cdn.district.in/x.png',
  eventStatus: 'EventScheduled',
  startDate: '2026-11-08T14:30:00.000Z',
  endDate: '2026-11-08T16:00:00.000Z',
  location: {
    '@type': 'Place',
    name: 'The Laugh Store',
    address: '3rd Floor, Some Mall, Andheri West, Mumbai, Maharashtra 400053, India',
  },
  offers: {
    '@type': 'AggregateOffer', lowPrice: 499, highPrice: 899, priceCurrency: 'INR', offerCount: 2,
    offers: [
      { '@type': 'Offer', name: 'Entry for 1', price: 499, availability: 'http://schema.org/InStock', validFrom: '2026-10-01T00:00:00Z' },
      { '@type': 'Offer', name: 'Entry for 2', price: 899, availability: 'http://schema.org/InStock', validFrom: '2026-10-01T00:00:00Z' },
    ],
  },
  ...overrides,
});

const item = (name, price, extra = {}) => ({
  _id: name, name, price, convenience_fee_percentage: 0.04, taxes: [], gst: [],
  item_state: 'available', is_available: true, tax_exemption: 'not_exempt', has_seats: false, ...extra,
});

describe('parseDistrictPage', () => {
  it('maps JSON-LD and tier data into a normalized event', () => {
    const html = makePage({ ldEvents: [comedyEvent()], items: [item('Entry for 1', 499), item('Entry for 2', 899)] });
    const [event] = parseDistrictPage(html, PAGE_URL, { qty: 1, category: 'comedy', now: NOW });

    assert.equal(event.id, 'district:laugh-out-loud-mumbai-nov8-2026-buy-tickets@2026-11-08T14:30:00.000Z');
    assert.equal(event.source, 'district');
    assert.equal(event.category, 'comedy');
    assert.equal(event.url, PAGE_URL);
    assert.deepEqual(event.start, {
      localDate: '2026-11-08', localTime: '20:00:00', dateTime: '2026-11-08T14:30:00.000Z',
      endDateTime: '2026-11-08T16:00:00.000Z', timezone: 'Asia/Kolkata', tba: false,
    });
    assert.equal(event.venue.city, 'Mumbai');
    assert.equal(event.venue.region, 'Maharashtra');
    assert.equal(event.onSale.status, 'onsale');
    assert.equal(event.tiers.length, 2);

    // 1 person: "Entry for 1" ₹499 + 4% fee (19.96) + 18% GST on that fee (3.59); ticket ≤ ₹500 has no GST.
    assert.equal(event.price.total, 522.55);
    assert.equal(event.price.components.fees, 'reported');
    assert.equal(event.price.components.taxes, 'estimated'); // GST on the fee is our estimate
    assert.equal(event.price.confidence, 'medium');
  });

  it('picks the cheapest combination for the quantity ("Entry for 2")', () => {
    const html = makePage({ ldEvents: [comedyEvent()], items: [item('Entry for 1', 499), item('Entry for 2', 899)] });
    const [event] = parseDistrictPage(html, PAGE_URL, { qty: 2, category: 'comedy', now: NOW });
    assert.equal(event.price.units, 1);
    assert.equal(event.price.base, 899);
    assert.match(event.price.notes[0], /1 × "Entry for 2" \(admits 2 each\)/);
  });

  it('uses reported GST and reaches high confidence when there is no fee', () => {
    const html = makePage({
      categories: ['Sports'],
      ldEvents: [comedyEvent({ name: 'Box Cricket League', offers: { '@type': 'AggregateOffer', priceCurrency: 'INR', lowPrice: 2750, offers: [{ name: 'Team of 8 Players', price: 2750, availability: 'http://schema.org/InStock' }] } })],
      items: [item('Team of 8 Players', 2750, { convenience_fee_percentage: 0, gst: [{ percent: 0.09, name: 'CGST' }, { percent: 0.09, name: 'SGST' }] })],
    });
    const [event] = parseDistrictPage(html, PAGE_URL, { qty: 1, category: 'sports', now: NOW });
    assert.equal(event.category, 'sports');
    assert.equal(event.price.total, 3245);
    assert.equal(event.price.confidence, 'high');
  });

  it('falls back to estimates when the page has no tier data', () => {
    const html = makePage({ ldEvents: [comedyEvent()], items: [] });
    const [event] = parseDistrictPage(html, PAGE_URL, { qty: 1, category: 'comedy', now: NOW });
    assert.equal(event.price.components.fees, 'estimated');
    assert.equal(event.price.confidence, 'low');
  });

  it('derives sold-out, scheduled and cancelled statuses', () => {
    const soldOut = comedyEvent({ offers: { '@type': 'AggregateOffer', priceCurrency: 'INR', offers: [{ name: 'GA', price: 999, availability: 'http://schema.org/SoldOut' }] } });
    const later = comedyEvent({ offers: { '@type': 'AggregateOffer', priceCurrency: 'INR', offers: [{ name: 'GA', price: 999, availability: 'http://schema.org/InStock', validFrom: '2026-11-01T06:30:00Z' }] } });
    const cancelled = comedyEvent({ eventStatus: 'https://schema.org/EventCancelled' });

    const status = (ld) => parseDistrictPage(makePage({ ldEvents: [ld] }), PAGE_URL, { now: NOW })[0].onSale;
    assert.equal(status(soldOut).status, 'soldout');
    assert.deepEqual([status(later).status, status(later).publicStart], ['scheduled', '2026-11-01T06:30:00.000Z']);
    assert.equal(status(cancelled).status, 'cancelled');
  });

  it('returns one event per show date on the page', () => {
    const html = makePage({ ldEvents: [comedyEvent(), comedyEvent({ startDate: '2026-11-09T14:30:00.000Z' })] });
    const events = parseDistrictPage(html, PAGE_URL, { now: NOW });
    assert.equal(events.length, 2);
    assert.notEqual(events[0].id, events[1].id);
  });

  it('ignores pages without Event JSON-LD', () => {
    assert.deepEqual(parseDistrictPage('<html></html>', PAGE_URL), []);
  });
});

describe('District search helpers', () => {
  const entries = [
    { url: 'https://www.district.in/events/a', slug: 'laugh-out-loud-mumbai-nov8-2026-buy-tickets', lastmod: '2026-10-10' },
    { url: 'https://www.district.in/events/b', slug: 'laugh-out-loud-pune-nov9-2026-buy-tickets', lastmod: '2026-10-12' },
    { url: 'https://www.district.in/events/c', slug: 'sunset-jazz-evening-goa-buy-tickets', lastmod: '2026-10-15' },
  ];

  it('ranks slugs that contain every keyword; city boosts', () => {
    assert.deepEqual(rankSitemapEntries(entries, 'Laugh Out Loud').map((e) => e.url.at(-1)), ['b', 'a']);
    assert.deepEqual(rankSitemapEntries(entries, 'laugh out loud', { city: 'Mumbai' }).map((e) => e.url.at(-1)), ['a', 'b']);
    assert.deepEqual(rankSitemapEntries(entries, 'jazz').map((e) => e.url.at(-1)), ['c']);
    assert.deepEqual(rankSitemapEntries(entries, 'the live show'), []); // only stop words
    assert.deepEqual(rankSitemapEntries(entries, 'laugh kolkata'), []);
  });

  it('knows Indian city aliases', () => {
    assert.deepEqual(cityVariants('Bangalore'), ['bengaluru', 'bangalore']);
    assert.deepEqual(cityVariants('Gurgaon'), ['gurugram', 'gurgaon']);
    assert.deepEqual(cityVariants('Jaipur'), ['jaipur']);
  });

  it('reads how many people a tier admits', () => {
    assert.equal(admitsFromTierName('Entry for 2'), 2);
    assert.equal(admitsFromTierName('Early Couple tickets'), 2);
    assert.equal(admitsFromTierName('Group of 4'), 4);
    assert.equal(admitsFromTierName('Stag Entry'), 1);
    assert.equal(admitsFromTierName('Team of 8 Players'), 1); // one team registration
    assert.equal(admitsFromTierName(null), 1);
  });

  it('parses sitemaps and sitemap indexes', () => {
    const index = parseSitemap('<sitemapindex><sitemap><loc>https://cdn.test/a.xml</loc></sitemap></sitemapindex>');
    assert.deepEqual(index.sitemaps, [{ url: 'https://cdn.test/a.xml', lastmod: null }]);
    const set = parseSitemap('<urlset><url><loc>https://x.test/events/a?x=1&amp;y=2</loc><lastmod>2026-10-16</lastmod></url></urlset>');
    assert.deepEqual(set.urls, [{ url: 'https://x.test/events/a?x=1&y=2', lastmod: '2026-10-16' }]);
  });
});


describe('districtSearchHits', () => {
  const hit = (title, slug, city, extra = {}) => ({
    entity_type: 'EntityTypeEvent', display_title: title,
    metadata: { slug, city_name: city, venue_name: extra.venue ?? '', artist_name: extra.artist ?? '' },
  });
  const SEARCH = {
    results: [
      hit('Parampara Navratri 2026 ft. Kirtidan Gadhvi', 'kirtidaan-gadhvi-2026', 'Ahmedabad', { venue: 'Parampara Navratri' }),
      { entity_type: 'EntityTypeArtist', display_title: 'Kirtidan Gadhvi', metadata: { slug: 'kirtidan' } },
      hit('Radhe Raas Navratri', 'radhe-raas-navratri-oct7-2026', 'Ahmedabad'),
      hit('Grand Celebration at Ministry of Sound', 'grand-celebration-oct18-2026', 'Noida'),
    ],
  };

  it('maps event hits to page URLs, even when the slug differs from the name', () => {
    assert.deepEqual(districtSearchHits(SEARCH, 'Parampara Navratri'), [
      'https://www.district.in/events/kirtidaan-gadhvi-2026-buy-tickets',
      'https://www.district.in/events/radhe-raas-navratri-oct7-2026-buy-tickets',
    ]);
  });

  it('filters by city when one is given', () => {
    assert.deepEqual(districtSearchHits(SEARCH, 'navratri', { city: 'Noida' }), []);
    assert.equal(districtSearchHits(SEARCH, 'navratri', { city: 'Ahmedabad' }).length, 2);
  });
});

describe('DistrictProvider', () => {
  const SITEMAP_INDEX = '<sitemapindex><sitemap><loc>https://cdn.district.in/sitemap/event-detail-pages.xml</loc></sitemap></sitemapindex>';
  const DETAIL = `<urlset>
    <url><loc>${PAGE_URL}</loc><lastmod>2026-10-16</lastmod></url>
    <url><loc>https://www.district.in/events/other-show-buy-tickets</loc></url>
  </urlset>`;

  function provider({ allowed = true, agent = null, page = makePage({ ldEvents: [comedyEvent()], items: [item('Entry for 1', 499), item('Entry for 2', 899)] }) } = {}) {
    const fetched = [];
    const http = {
      async getText(url) {
        fetched.push(url);
        if (url.endsWith('sitemap-events.xml')) return SITEMAP_INDEX;
        if (url.endsWith('event-detail-pages.xml')) return DETAIL;
        if (url === PAGE_URL) return page;
        throw new Error(`unexpected ${url}`);
      },
    };
    const robots = { check: async () => ({ allowed }) };
    return { fetched, district: new DistrictProvider({ http, robots, agent, now: () => NOW }) };
  }

  /** A fake browser agent that plays District's search page. */
  function fakeAgent(results) {
    const calls = { filled: null, visited: null };
    const page = {
      locator: () => ({ first: () => ({ waitFor: async () => {}, fill: async (v) => { calls.filled = v; } }) }),
      waitForLoadState: async () => {},
      waitForResponse: async (predicate) => {
        await new Promise((r) => setTimeout(r, 1)); // resolves after fill(), like the real page
        const res = {
          url: () => 'https://www.district.in/gw/web/search',
          request: () => ({ method: () => 'POST', postData: () => JSON.stringify({ keyword: calls.filled, tab_id: 'all' }) }),
          json: async () => ({ results }),
        };
        assert.equal(predicate(res), true);
        return res;
      },
    };
    return {
      calls,
      available: async () => true,
      withTab: async (origin, fn) => fn({ page, goto: async (url) => { calls.visited = url; } }),
    };
  }

  it('uses District site search in Chrome when available', async () => {
    const agent = fakeAgent([{ entity_type: 'EntityTypeEvent', display_title: 'Laugh Out Loud Live', metadata: { slug: 'laugh-out-loud-mumbai-nov8-2026', city_name: 'Mumbai' } }]);
    const { fetched, district } = provider({ agent });
    const { events, notice } = await district.search({ keyword: 'Laugh Out Loud', qty: 2 });
    assert.equal(agent.calls.visited, '/search');
    assert.equal(agent.calls.filled, 'Laugh Out Loud');
    assert.equal(notice, null);
    assert.equal(events.length, 1);
    assert.equal(events[0].category, 'comedy');
    assert.ok(!fetched.some((u) => u.includes('sitemap')), 'no sitemap needed');
  });

  it('falls back to the sitemap without Chrome, with a notice', async () => {
    const { fetched, district } = provider();
    const { events, notice } = await district.search({ keyword: 'laugh out loud', qty: 2, city: 'Mumbai' });
    assert.match(notice, /Start Chrome/);
    assert.equal(events.length, 1);
    assert.equal(events[0].price.base, 899);
    assert.equal(fetched.filter((u) => u.includes('/events/')).length, 1);

    // Cached: a second search re-fetches nothing.
    await district.search({ keyword: 'laugh', qty: 1 });
    assert.equal(fetched.length, 3);
  });

  it('filters other cities, past events and (optionally) other categories', async () => {
    const { district } = provider();
    assert.equal((await district.search({ category: 'sports', keyword: 'laugh' })).events.length, 0);
    assert.equal((await district.search({ keyword: 'laugh', city: 'Delhi' })).events.length, 0);
    const past = provider({ page: makePage({ ldEvents: [comedyEvent({ startDate: '2026-01-01T10:00:00Z', endDate: '2026-01-01T12:00:00Z' })] }) });
    assert.equal((await past.district.search({ keyword: 'laugh' })).events.length, 0);
  });

  it('respects robots.txt', async () => {
    const { fetched, district } = provider({ allowed: false });
    await assert.rejects(district.search({ keyword: 'laugh' }), /Could not read District/);
    assert.equal(fetched.filter((u) => u.includes('/events/')).length, 0);
  });

  it('getEvent re-reads a page and picks the right show', async () => {
    const { district } = provider();
    const event = await district.getEvent('laugh-out-loud-mumbai-nov8-2026-buy-tickets@2026-11-08T14:30:00.000Z', { qty: 1 });
    assert.equal(event.name, 'Laugh Out Loud Live');
    await assert.rejects(district.getEvent('../../etc@x'), /Invalid District event id/);
  });
});
