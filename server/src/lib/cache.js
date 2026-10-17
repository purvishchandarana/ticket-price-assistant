/** Small in-memory TTL cache. Used to avoid re-hitting APIs for repeat queries. */
export class TtlCache {
  #entries = new Map();

  constructor({ ttlMs = 60_000, maxEntries = 200, now = Date.now } = {}) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    this.now = now;
  }

  get(key) {
    const entry = this.#entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.#entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key, value) {
    if (this.#entries.size >= this.maxEntries) {
      // Map preserves insertion order, so the first key is the oldest.
      this.#entries.delete(this.#entries.keys().next().value);
    }
    this.#entries.set(key, { value, expiresAt: this.now() + this.ttlMs });
  }
}
