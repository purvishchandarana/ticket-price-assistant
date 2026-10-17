// Ticketmaster Discovery API v2: https://developer.ticketmaster.com/products-and-docs/apis/discovery-api/v2/
// Free tier quota: 5,000 calls/day, 5 req/s. The shared HTTP client throttles
// well below that and search responses are cached briefly.

import { TtlCache } from '../lib/cache.js';
import { HttpError } from '../lib/http.js';
import { getFeeModel } from '../pricing/feeModels.js';
import { normalizePrice } from '../pricing/normalizer.js';
import { Provider, ProviderError } from './Provider.js';

const BASE_URL = 'https://app.ticketmaster.com/discovery/v2';

/** Ticketmaster "segment" ids for our top-level categories. */
export const TM_SEGMENTS = {
  concerts: 'KZFzniwnSyZfZ7v7nJ', // Music
  sports: 'KZFzniwnSyZfZ7v7nE', // Sports
  theatre: 'KZFzniwnSyZfZ7v7na', // Arts & Theatre
};

const SEGMENT_TO_CATEGORY = Object.fromEntries(
  Object.entries(TM_SEGMENTS).map(([category, segmentId]) => [segmentId, category]),
);

// TM wants second precision without millis, e.g. 2026-10-17T12:00:00Z.
// Truncating to the minute also keeps the cache key stable.
const isoMinute = (date) => date.toISOString().slice(0, 16) + ':00Z';

export class TicketmasterProvider extends Provider {
  #apiKey;

  /**
   * @param {object} options
   * @param {string} options.apiKey
   * @param {string} [options.countryCode]
   * @param {{getJson: (url: string) => Promise<any>}} options.http
   * @param {number} [options.cacheTtlMs]
   * @param {() => Date} [options.now]
   */
  constructor({ apiKey, countryCode = '', http, cacheTtlMs = 60_000, now = () => new Date() }) {
    super({ id: 'ticketmaster', name: 'Ticketmaster', categories: Object.keys(TM_SEGMENTS) });
    this.#apiKey = apiKey;
    this.countryCode = countryCode;
    this.http = http;
    this.now = now;
    this.cache = new TtlCache({ ttlMs: cacheTtlMs });
    this.feeModel = getFeeModel('ticketmaster');
  }

  isConfigured() {
    return Boolean(this.#apiKey);
  }

  async search({ category, keyword, qty = 1 }, { size = 20 } = {}) {
    const params = {
      keyword,
      segmentId: TM_SEGMENTS[category],
      size: String(size),
      sort: 'relevance,desc',
      startDateTime: isoMinute(this.now()),
    };
    if (this.countryCode) params.countryCode = this.countryCode;

    const data = await this.#get('/events.json', params);
    const events = data?._embedded?.events ?? [];
    return events.map((raw) => this.mapEvent(raw, { qty }));
  }

  async getEvent(sourceEventId, { qty = 1 } = {}) {
    const raw = await this.#get(`/events/${encodeURIComponent(sourceEventId)}.json`, {});
    return this.mapEvent(raw, { qty });
  }

  async #get(path, params) {
    if (!this.isConfigured()) {
      throw new ProviderError(this.id, 'Ticketmaster API key is not set (TICKETMASTER_API_KEY).');
    }
    const url = new URL(BASE_URL + path);
    for (const [key, value] of Object.entries(params)) {
      if (value) url.searchParams.set(key, value);
    }
    const cacheKey = url.toString(); // built before the key is added
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    url.searchParams.set('apikey', this.#apiKey);
    try {
      const data = await this.http.getJson(url.toString());
      this.cache.set(cacheKey, data);
      return data;
    } catch (err) {
      throw toProviderError(this.id, err);
    }
  }

  /** Map a raw Discovery API event to a NormalizedEvent. */
  mapEvent(raw, { qty = 1 } = {}) {
    const start = raw.dates?.start ?? {};
    const venue = raw._embedded?.venues?.[0];
    return {
      id: `ticketmaster:${raw.id}`,
      source: this.id,
      sourceName: this.name,
      sourceEventId: raw.id,
      name: raw.name,
      category: categoryFromClassifications(raw.classifications),
      url: raw.url ?? null,
      imageUrl: pickImage(raw.images),
      start: {
        localDate: start.localDate ?? null,
        localTime: start.localTime ?? null,
        dateTime: start.dateTime ?? null,
        timezone: raw.dates?.timezone ?? null,
        tba: Boolean(start.dateTBA || start.dateTBD || start.timeTBA),
      },
      venue: venue
        ? {
            name: venue.name ?? null,
            city: venue.city?.name ?? null,
            region: venue.state?.stateCode ?? venue.state?.name ?? null,
            country: venue.country?.countryCode ?? null,
          }
        : null,
      onSale: mapOnSale(raw, this.now()),
      price: normalizePrice(pickPriceInput(raw.priceRanges), { qty, feeModel: this.feeModel }),
    };
  }
}

/**
 * Pick the cheapest price range, preferring "standard including fees" (all-in)
 * ranges over plain "standard" ones, which exclude fees.
 */
export function pickPriceInput(priceRanges) {
  if (!Array.isArray(priceRanges) || priceRanges.length === 0) return null;
  const valid = priceRanges.filter((r) => typeof r.min === 'number' && r.min > 0);
  const allIn = valid.filter((r) => /including fees/i.test(r.type ?? ''));
  const pool = allIn.length > 0 ? allIn : valid;
  const best = pool.toSorted((a, b) => a.min - b.min)[0];
  if (!best) return null;
  return {
    currency: best.currency,
    base: best.min,
    includesFees: allIn.length > 0,
    priceKind: 'range-min',
  };
}

export function mapOnSale(raw, now = new Date()) {
  const code = raw.dates?.status?.code?.toLowerCase() ?? null;
  const publicSale = raw.sales?.public ?? {};
  const publicStart = publicSale.startTBD ? null : (publicSale.startDateTime ?? null);

  let status;
  if (code === 'cancelled' || code === 'canceled') status = 'cancelled';
  else if (code === 'postponed' || code === 'rescheduled') status = code;
  else if (publicStart && Date.parse(publicStart) > now.getTime()) status = 'scheduled';
  else if (code === 'onsale' || code === 'offsale') status = code;
  else status = 'unknown';

  return {
    status,
    rawStatus: code,
    publicStart,
    publicEnd: publicSale.endDateTime ?? null,
    presales: (raw.sales?.presales ?? []).map((p) => ({
      name: p.name ?? 'Presale',
      start: p.startDateTime ?? null,
      end: p.endDateTime ?? null,
    })),
  };
}

function categoryFromClassifications(classifications) {
  const primary = classifications?.find((c) => c.primary) ?? classifications?.[0];
  return SEGMENT_TO_CATEGORY[primary?.segment?.id] ?? null;
}

function pickImage(images) {
  if (!Array.isArray(images) || images.length === 0) return null;
  const wide = images.filter((i) => i.ratio === '16_9');
  const pool = wide.length > 0 ? wide : images;
  // Smallest image that's still at least 600px wide, else the largest.
  const sorted = pool.toSorted((a, b) => (a.width ?? 0) - (b.width ?? 0));
  return (sorted.find((i) => (i.width ?? 0) >= 600) ?? sorted.at(-1)).url ?? null;
}

function toProviderError(providerId, err) {
  if (err instanceof ProviderError) return err;
  if (err instanceof HttpError) {
    const status = err.status;
    let message;
    if (status === 401 || status === 403) message = 'Ticketmaster rejected the API key. Check TICKETMASTER_API_KEY.';
    else if (status === 404) message = 'Event not found on Ticketmaster.';
    else if (status === 429) message = 'Ticketmaster rate limit reached. Try again shortly.';
    else if (status === 0) message = 'Could not reach Ticketmaster (network error).';
    else message = `Ticketmaster request failed (HTTP ${status}).`;
    return new ProviderError(providerId, message, { cause: err, status });
  }
  return new ProviderError(providerId, 'Unexpected error querying Ticketmaster.', { cause: err });
}
