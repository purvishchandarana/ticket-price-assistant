// BookMyShow: https://in.bookmyshow.com
//
// BookMyShow has no public API and only serves real browsers, so every request
// goes through a helper tab in the user's own Chrome (BrowserAgent): one call
// to the site's own search endpoint per query, then a few event pages, at
// least 1.5 s apart, with robots.txt checked. Any CAPTCHA or bot check is
// handed to the human. Without Chrome, this source is skipped.
//
// Prices come from each event page's schema.org Event JSON-LD. BookMyShow's
// listed ticket prices include GST (e.g. ₹826 = ₹700 + 18%); its convenience
// fee is added at checkout and is estimated here.

import { TtlCache } from '../lib/cache.js';
import { extractJsonLd } from '../lib/html.js';
import { getFeeModel } from '../pricing/feeModels.js';
import { eventFromLd, isEventLd, isPast, matchesCity, relevantHits } from './jsonld.js';
import { Provider, ProviderError } from './Provider.js';

const ORIGIN = 'https://in.bookmyshow.com';
const EVENT_PATH = /^\/(events|activities|plays|sports)\/[a-z0-9-]+\/(ET\d+)\/?$/i;
const PATH_CATEGORY = { plays: 'theatre', sports: 'sports' };

/** Event hits from BookMyShow's /api/v1/search/dynamic response. */
export function bookMyShowSearchHits(json, keyword) {
  const cards = json?.data?.widgets?.['search-vi-v2-results']?.data?.cards?.data ?? [];
  const events = cards
    .map((card) => card.data ?? {})
    .map((d) => ({
      code: d.identifier,
      title: d['result-title'] ?? '',
      url: d.cta?.url ?? '',
      date: d['result-date'] ?? '',
      location: d['result-location'] ?? '',
      status: d.cta?.analytics?.metadata?.content_status ?? null,
    }))
    .filter((h) => /^ET\d+$/i.test(h.code ?? '') && h.url.startsWith(ORIGIN) && EVENT_PATH.test(new URL(h.url).pathname));
  return relevantHits(events, keyword, (h) => `${h.title} ${h.location}`);
}

/** Parse a BookMyShow event page. Pure function: exported for tests. */
export function parseBookMyShowPage(html, pageUrl, { qty = 1, now = new Date(), feeModel = getFeeModel('bookmyshow') } = {}) {
  const path = new URL(pageUrl).pathname;
  const match = path.match(EVENT_PATH);
  if (!match) return [];
  const ld = extractJsonLd(html).filter(isEventLd);
  return ld.map((event, i) => eventFromLd(event, {
    source: 'bookmyshow',
    sourceName: 'BookMyShow',
    // One code per page; suffix extra shows so ids stay unique.
    sourceEventId: i === 0 ? path : `${path}#${event.startDate ?? i}`,
    url: `${ORIGIN}${path}`,
    category: PATH_CATEGORY[match[1].toLowerCase()] ?? null,
    qty,
    now,
    feeModel,
    // GST is already inside the listed price; GST on the convenience fee still applies.
    priceDefaults: { taxRate: 0 },
    extraNotes: ['BookMyShow ticket prices include GST; the convenience fee is estimated.'],
  }));
}

export class BookMyShowProvider extends Provider {
  /**
   * @param {object} options
   * @param {import('../automation/browserAgent.js').BrowserAgent} options.agent
   */
  constructor({ agent, enabled = true, maxPagesPerSearch = 4, now = () => new Date() }) {
    super({ id: 'bookmyshow', name: 'BookMyShow', categories: ['concerts', 'comedy', 'sports', 'theatre'] });
    this.agent = agent;
    this.enabled = enabled;
    this.maxPagesPerSearch = maxPagesPerSearch;
    this.now = now;
    this.feeModel = getFeeModel('bookmyshow');
    this.pageCache = new TtlCache({ ttlMs: 10 * 60 * 1000, maxEntries: 200 });
  }

  isConfigured() {
    return this.enabled && Boolean(this.agent);
  }

  async search({ category, keyword, qty = 1, city }) {
    if (!(await this.agent.available())) {
      throw new ProviderError(this.id, 'Start Chrome with remote debugging to include BookMyShow (see README).');
    }
    const hits = await this.#run(async (tab) => {
      const json = await tab.fetchJson(`/api/v1/search/dynamic?q=${encodeURIComponent(keyword.trim())}&instant=true&firstLoad=false`);
      return bookMyShowSearchHits(json, keyword);
    });

    const events = [];
    for (const hit of hits.slice(0, this.maxPagesPerSearch)) {
      try {
        events.push(...await this.#eventsFromPage(hit.url, { qty }));
      } catch (err) {
        console.warn(`[bookmyshow] ${hit.url}: ${err.message}`);
      }
    }
    const now = this.now();
    const seen = new Set();
    return events.filter((e) => {
      if (seen.has(e.id) || isPast(e, now)) return false;
      seen.add(e.id);
      if (category && e.category && e.category !== category) return false;
      return matchesCity(e, city);
    });
  }

  async getEvent(sourceEventId, { qty = 1 } = {}) {
    const path = sourceEventId.split('#')[0];
    if (!EVENT_PATH.test(path)) throw new ProviderError(this.id, 'Invalid BookMyShow event id.');
    const events = await this.#eventsFromPage(`${ORIGIN}${path}`, { qty, fresh: true });
    const event = events.find((e) => e.sourceEventId === sourceEventId) ?? events[0];
    if (!event) throw new ProviderError(this.id, 'Event not found on BookMyShow.', { status: 404 });
    return event;
  }

  async #eventsFromPage(url, { qty, fresh = false }) {
    let html = fresh ? undefined : this.pageCache.get(url);
    if (html === undefined) {
      html = await this.#run((tab) => tab.fetchText(url));
      this.pageCache.set(url, html);
    }
    return parseBookMyShowPage(html, url, { qty, now: this.now(), feeModel: this.feeModel });
  }

  async #run(fn) {
    try {
      return await this.agent.withTab(ORIGIN, fn);
    } catch (err) {
      if (err instanceof ProviderError) throw err;
      throw new ProviderError(this.id, err.expose ? err.message : 'BookMyShow could not be read right now.', { cause: err });
    }
  }
}
