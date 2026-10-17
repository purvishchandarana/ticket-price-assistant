// Provider for the bundled local demo ticket site (demo-site/). Lets you try
// search → watch → booking assist end to end without touching a real site.

import { HttpError } from '../lib/http.js';
import { normalizePrice, sortByTotal } from '../pricing/normalizer.js';
import { Provider, ProviderError } from './Provider.js';

export class DemoProvider extends Provider {
  constructor({ url, http }) {
    super({ id: 'demo', name: 'DemoTix (local demo)', categories: ['concerts', 'comedy', 'sports', 'theatre'] });
    this.baseUrl = url ? url.replace(/\/$/, '') : '';
    this.http = http;
  }

  isConfigured() {
    return Boolean(this.baseUrl);
  }

  async search({ category, keyword, qty = 1, city }) {
    const events = await this.#events();
    const words = keyword.toLowerCase().split(/\s+/).filter(Boolean);
    return events
      .filter((e) => !category || e.category === category)
      .filter((e) => words.every((w) => `${e.name} ${e.venue.city}`.toLowerCase().includes(w)))
      .filter((e) => !city || e.venue.city.toLowerCase() === city.toLowerCase())
      .map((e) => this.mapEvent(e, { qty }));
  }

  async getEvent(sourceEventId, { qty = 1 } = {}) {
    const raw = (await this.#events()).find((e) => e.id === sourceEventId);
    if (!raw) throw new ProviderError(this.id, 'Event not found on the demo site.', { status: 404 });
    return this.mapEvent(raw, { qty });
  }

  mapEvent(raw, { qty = 1 } = {}) {
    // Demo sections report exact fees and GST, so totals are high confidence.
    const quotes = raw.sections
      .filter((s) => s.available > 0)
      .map((s) => ({
        section: s,
        price: normalizePrice(
          { currency: 'INR', base: s.price, fees: s.fee, taxRate: s.gstRate, feeTaxRate: 0.18, notes: [`Cheapest section: ${s.name}.`] },
          { qty },
        ),
      }));
    const cheapest = sortByTotal(quotes)[0]?.price ?? normalizePrice(null, { qty });
    return {
      id: `demo:${raw.id}`,
      source: this.id,
      sourceName: this.name,
      sourceEventId: raw.id,
      name: raw.name,
      category: raw.category,
      url: `${this.baseUrl}/events/${raw.id}`,
      imageUrl: null,
      start: { localDate: raw.date, localTime: raw.time, dateTime: null, timezone: 'Asia/Kolkata', tba: false },
      venue: { name: raw.venue.name, city: raw.venue.city, region: null, country: 'IN' },
      onSale: { status: raw.status, rawStatus: raw.status, publicStart: raw.onSaleAt ?? null, publicEnd: null, presales: [] },
      price: cheapest,
    };
  }

  async #events() {
    try {
      return await this.http.getJson(`${this.baseUrl}/api/events`);
    } catch (err) {
      const reason = err instanceof HttpError && err.status === 0
        ? 'Demo site is not running. Start it with `npm run demo-site`.'
        : 'Demo site request failed.';
      throw new ProviderError(this.id, reason, { cause: err });
    }
  }
}
