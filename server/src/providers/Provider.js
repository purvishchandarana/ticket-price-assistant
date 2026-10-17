/**
 * Common interface for event/price sources. Add a source by subclassing
 * Provider and registering it in registry.js.
 *
 * @typedef {object} SearchQuery
 * @property {'concerts'|'sports'|'theatre'} category
 * @property {string} keyword
 * @property {number} qty            tickets wanted (1..MAX_QTY)
 *
 * @typedef {object} OnSaleInfo
 * @property {'onsale'|'scheduled'|'offsale'|'cancelled'|'postponed'|'rescheduled'|'unknown'} status
 * @property {string|null} rawStatus           source's own status code
 * @property {string|null} publicStart         ISO datetime general sale opens
 * @property {string|null} publicEnd
 * @property {{name: string, start: string|null, end: string|null}[]} presales
 *
 * @typedef {object} NormalizedEvent
 * @property {string} id                       `${source}:${sourceEventId}` (globally unique)
 * @property {string} source                   provider id
 * @property {string} sourceName
 * @property {string} sourceEventId
 * @property {string} name
 * @property {string|null} category
 * @property {string|null} url                 deep link to the event on the source site
 * @property {string|null} imageUrl
 * @property {{localDate: string|null, localTime: string|null, dateTime: string|null, timezone: string|null, tba: boolean}} start
 * @property {{name: string|null, city: string|null, region: string|null, country: string|null}|null} venue
 * @property {OnSaleInfo} onSale
 * @property {import('../pricing/normalizer.js').PriceQuote} price
 */

/** Error with a message that is safe to show in the UI. */
export class ProviderError extends Error {
  constructor(providerId, message, { cause, status } = {}) {
    super(message, { cause });
    this.name = 'ProviderError';
    this.providerId = providerId;
    this.status = status;
    this.expose = true;
  }
}

export class Provider {
  /**
   * @param {{id: string, name: string, categories: string[]}} meta
   */
  constructor({ id, name, categories }) {
    this.id = id;
    this.name = name;
    this.categories = categories;
  }

  /** False when required credentials are missing; unconfigured providers are skipped. */
  isConfigured() {
    return true;
  }

  supportsCategory(category) {
    return this.categories.includes(category);
  }

  /**
   * @param {SearchQuery} _query
   * @returns {Promise<NormalizedEvent[]>}
   */
  async search(_query) {
    throw new Error(`${this.id}: search() not implemented`);
  }

  /**
   * @param {string} _sourceEventId
   * @param {{qty?: number}} [_options]
   * @returns {Promise<NormalizedEvent>}
   */
  async getEvent(_sourceEventId, _options) {
    throw new Error(`${this.id}: getEvent() not implemented`);
  }

  /**
   * Used by the on-sale watcher. Override with something cheaper if the
   * source has a dedicated status endpoint.
   * @returns {Promise<OnSaleInfo>}
   */
  async getOnSaleStatus(sourceEventId) {
    const event = await this.getEvent(sourceEventId);
    return event.onSale;
  }
}
