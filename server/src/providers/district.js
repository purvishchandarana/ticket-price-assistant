// District (by Zomato): https://www.district.in
//
// District has no public API.
//   Discovery: District's own site search, run in a helper tab in the user's
//     Chrome (one search per query, exactly what District's search box does).
//     If Chrome isn't available, falls back to slug matching on District's
//     published sitemap, which misses events whose URL doesn't contain their name.
//   Prices: public event pages (robots.txt-allowed), fetched server-side at a
//     slow, dedicated rate and cached. schema.org Event JSON-LD gives tiers;
//     the page's embedded ticket data adds each tier's convenience-fee % and GST.

import { TtlCache } from '../lib/cache.js';
import { HttpError } from '../lib/http.js';
import { extractJsonLd, extractNextFlight, findJsonObjects, parseSitemap } from '../lib/html.js';
import { getFeeModel } from '../pricing/feeModels.js';
import {
  admitsFromTierName, cityVariants, eventFromLd, isEventLd, isPast, keywordTokens, matchesCity, relevantHits,
} from './jsonld.js';
import { Provider, ProviderError } from './Provider.js';

export { admitsFromTierName, cityVariants };

const ORIGIN = 'https://www.district.in';
const SITEMAP_INDEX = 'https://cdn.district.in/sitemap/sitemap-events.xml';
const EVENT_PATH = /^\/events\/([a-z0-9-]+)$/i;
// District's search page has two text inputs: the search box (no `type` or
// placeholder attribute) and a city picker. Verified on the live site; update
// here if District changes its markup.
const SEARCH_INPUT = ['input:not([type])', 'input[type="text"]', 'input[type="search"]']
  .map((s) => `${s}:not([placeholder*="city" i])`)
  .join(', ');

const CATEGORY_PATTERNS = [
  ['comedy', /comedy|stand-?up/i],
  ['sports', /sport|cricket|football|match|marathon|run\b/i],
  ['concerts', /music|concert|gig|festival|dj|party|nightlife|garba|dandiya/i],
  ['theatre', /theat|play|drama|performance|dance|art/i],
];

export function mapDistrictCategory(names) {
  for (const name of names) {
    for (const [category, pattern] of CATEGORY_PATTERNS) {
      if (pattern.test(name)) return category;
    }
  }
  return null;
}

/**
 * Fallback discovery: rank sitemap entries by keyword tokens in their URL slug.
 * Every token must appear; a city in the slug and recent lastmod rank higher.
 */
export function rankSitemapEntries(entries, keyword, { city } = {}) {
  const tokens = keywordTokens(keyword);
  if (tokens.length === 0) return [];
  const cityTokens = cityVariants(city).flatMap(keywordTokens);

  const ranked = [];
  for (const entry of entries) {
    const slugTokens = entry.slug.split('-');
    let score = 0;
    let matchedAll = true;
    for (const token of tokens) {
      if (slugTokens.includes(token)) score += 2;
      else if (token.length >= 3 && entry.slug.includes(token)) score += 1;
      else { matchedAll = false; break; }
    }
    if (!matchedAll) continue;
    if (cityTokens.some((t) => slugTokens.includes(t))) score += 2;
    ranked.push({ ...entry, score });
  }
  return ranked.sort((a, b) => b.score - a.score || String(b.lastmod).localeCompare(String(a.lastmod)));
}

const sumPercents = (list) =>
  Array.isArray(list) ? list.reduce((sum, t) => sum + (typeof t?.percent === 'number' ? t.percent : 0), 0) : 0;

/**
 * Parse one District event page into NormalizedEvents (one per show/date).
 * Pure function: exported for tests.
 */
export function parseDistrictPage(html, pageUrl, { qty = 1, category = null, now = new Date(), feeModel = getFeeModel('india') } = {}) {
  const slug = new URL(pageUrl).pathname.match(EVENT_PATH)?.[1];
  if (!slug) return [];
  const ldEvents = extractJsonLd(html).filter(isEventLd);
  if (ldEvents.length === 0) return [];

  const flight = extractNextFlight(html);
  const items = new Map();
  let pageCategory = null;
  if (flight) {
    for (const item of findJsonObjects(flight, ['convenience_fee_percentage', 'price', 'name'])) {
      items.set(`${item.name}|${Number(item.price)}`, item);
    }
    pageCategory = mapDistrictCategory(
      findJsonObjects(flight, ['display_name', 'tag_type'])
        .filter((t) => t.tag_type === 'category' && t.level === 0)
        .map((t) => t.display_name),
    );
  }

  return ldEvents.map((ld) => {
    const startIso = ld.startDate ?? '';
    return eventFromLd(ld, {
      source: 'district',
      sourceName: 'District',
      sourceEventId: `${slug}@${startIso}`,
      url: typeof ld.url === 'string' && ld.url.startsWith(ORIGIN) ? ld.url.replace(/#.*$/, '') : `${ORIGIN}/events/${slug}`,
      category: pageCategory ?? category,
      qty,
      now,
      feeModel,
      tierDetails: (tier) => {
        const item = tier.name ? items.get(`${tier.name}|${tier.price}`) : undefined;
        if (!item) return { summary: { feePct: null, gstRate: null, hasSeats: null } };
        const feePct = Number(item.convenience_fee_percentage) || 0;
        const gstRate = sumPercents(item.gst);
        return {
          item,
          price: {
            feePct,
            taxRate: item.tax_exemption === 'exempt' ? 0 : gstRate + sumPercents(item.taxes),
            notes: ["Convenience fee and GST rates from District's ticket data; GST is added at checkout."],
          },
          summary: { feePct, gstRate, hasSeats: item.has_seats ?? null },
        };
      },
    });
  });
}

/** Event page URLs from a District site-search response, most relevant first. */
export function districtSearchHits(json, keyword, { city } = {}) {
  const events = (json?.results ?? []).filter((r) => r.entity_type === 'EntityTypeEvent' && r.metadata?.slug);
  const relevant = relevantHits(events, keyword, (r) =>
    [r.display_title, r.metadata.venue_name, r.metadata.artist_name, r.metadata.city_name].filter(Boolean).join(' '));
  const variants = cityVariants(city);
  const inCity = variants.length
    ? relevant.filter((r) => variants.some((v) => String(r.metadata.city_name ?? '').toLowerCase().includes(v)))
    : relevant;
  return [...new Set(inCity.map((r) => `${ORIGIN}/events/${r.metadata.slug}-buy-tickets`))];
}

export class DistrictProvider extends Provider {
  /**
   * @param {object} options
   * @param {{getText: (url: string) => Promise<string>}} options.http  dedicated, slow-throttled client
   * @param {{check: (url: string) => Promise<{allowed: boolean}>}} options.robots
   * @param {import('../automation/browserAgent.js').BrowserAgent} [options.agent]  for site search
   */
  constructor({ http, robots, agent = null, enabled = true, maxPagesPerSearch = 5, now = () => new Date() }) {
    super({ id: 'district', name: 'District', categories: ['concerts', 'comedy', 'sports', 'theatre'] });
    this.http = http;
    this.robots = robots;
    this.agent = agent;
    this.enabled = enabled;
    this.maxPagesPerSearch = maxPagesPerSearch;
    this.now = now;
    this.feeModel = getFeeModel('india');
    this.sitemapCache = new TtlCache({ ttlMs: 6 * 60 * 60 * 1000, maxEntries: 2 });
    this.pageCache = new TtlCache({ ttlMs: 10 * 60 * 1000, maxEntries: 200 });
  }

  isConfigured() {
    return this.enabled;
  }

  async search({ category, keyword, qty = 1, city }) {
    let urls = null;
    let notice = null;
    if (this.agent && await this.agent.available()) {
      try {
        urls = districtSearchHits(await this.#siteSearch(keyword), keyword, { city });
      } catch (err) {
        console.warn('[district] site search failed, using sitemap:', err.message);
        notice = 'District site search failed; results come from the sitemap and may be incomplete.';
      }
    } else {
      notice = 'Start Chrome (remote debugging) for complete District results; sitemap search can miss events.';
    }
    if (!urls) {
      urls = rankSitemapEntries(await this.#sitemapEntries(), keyword, { city }).map((e) => e.url);
    }

    const events = [];
    let failures = 0;
    const candidates = urls.slice(0, this.maxPagesPerSearch);
    for (const url of candidates) {
      try {
        events.push(...await this.#eventsFromPage(url, { qty, category: category ?? null }));
      } catch (err) {
        failures++;
        console.warn(`[district] ${url}: ${err.message}`);
      }
    }
    if (candidates.length > 0 && failures === candidates.length) {
      throw new ProviderError(this.id, 'Could not read District event pages right now. Try again later.');
    }

    const now = this.now();
    const seen = new Set();
    const filtered = events.filter((e) => {
      if (seen.has(e.id) || isPast(e, now)) return false;
      seen.add(e.id);
      if (category && e.category && e.category !== category) return false;
      return matchesCity(e, city);
    });
    return { events: filtered, notice };
  }

  async getEvent(sourceEventId, { qty = 1 } = {}) {
    const at = sourceEventId.lastIndexOf('@');
    const slug = at >= 0 ? sourceEventId.slice(0, at) : sourceEventId;
    const start = at >= 0 ? sourceEventId.slice(at + 1) : '';
    if (!/^[a-z0-9-]+$/i.test(slug)) throw new ProviderError(this.id, 'Invalid District event id.');

    const events = await this.#eventsFromPage(`${ORIGIN}/events/${slug}`, { qty, category: null, fresh: true });
    const event = events.find((e) => e.start.dateTime === start) ?? events[0];
    if (!event) throw new ProviderError(this.id, 'Event not found on District.', { status: 404 });
    return event;
  }

  /** Run District's own search in the helper tab and capture its JSON response. */
  async #siteSearch(keyword) {
    return this.agent.withTab(ORIGIN, async (tab) => {
      await tab.goto('/search', { reload: true }); // fresh page: an old query in the box wouldn't re-trigger
      const input = tab.page.locator(SEARCH_INPUT).first();
      await input.waitFor({ state: 'visible', timeout: 20_000 });
      // On a first visit the box can render before the page is ready to react to it.
      await tab.page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
      const needle = keyword.trim().toLowerCase();
      const isOurSearch = (res) => {
        if (!res.url().includes('/gw/web/search') || res.request().method() !== 'POST') return false;
        try {
          return String(JSON.parse(res.request().postData() ?? '{}').keyword ?? '').trim().toLowerCase() === needle;
        } catch {
          return false;
        }
      };
      for (let attempt = 1; ; attempt++) {
        const response = tab.page.waitForResponse(isOurSearch, { timeout: 8_000 });
        await input.fill('');
        await input.fill(keyword.trim());
        try {
          return await (await response).json();
        } catch (err) {
          if (attempt >= 3) throw err;
        }
      }
    });
  }

  async #sitemapEntries() {
    const cached = this.sitemapCache.get('entries');
    if (cached) return cached;

    const index = parseSitemap(await this.#fetch(SITEMAP_INDEX));
    const detailMaps = index.sitemaps.filter((s) => /event-detail/i.test(s.url));
    const entries = [];
    for (const map of detailMaps.length ? detailMaps : index.sitemaps.slice(0, 1)) {
      const parsed = parseSitemap(await this.#fetch(map.url));
      for (const { url, lastmod } of parsed.urls) {
        const slug = new URL(url).pathname.match(EVENT_PATH)?.[1];
        if (slug) entries.push({ url, slug: slug.toLowerCase(), lastmod });
      }
    }
    if (entries.length === 0) throw new ProviderError(this.id, 'District sitemap returned no events.');
    this.sitemapCache.set('entries', entries);
    return entries;
  }

  async #eventsFromPage(url, { qty, category, fresh = false }) {
    let html = fresh ? undefined : this.pageCache.get(url);
    if (html === undefined) {
      const { allowed } = await this.robots.check(url);
      if (!allowed) throw new ProviderError(this.id, 'robots.txt disallows this page.');
      html = await this.#fetch(url);
      this.pageCache.set(url, html);
    }
    return parseDistrictPage(html, url, { qty, category, now: this.now(), feeModel: this.feeModel });
  }

  async #fetch(url) {
    try {
      return await this.http.getText(url);
    } catch (err) {
      if (err instanceof HttpError) {
        const message = err.status === 403 || err.status === 429
          ? 'District is limiting requests right now. Try again later.'
          : `District request failed (HTTP ${err.status}).`;
        throw new ProviderError(this.id, message, { cause: err, status: err.status });
      }
      throw err;
    }
  }
}
