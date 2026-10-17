import { sortByTotal } from '../pricing/normalizer.js';
import { keywordTokens } from '../providers/jsonld.js';

/**
 * How well an event matches the search words: 'best' when every word appears
 * in its name or venue, otherwise 'related' (the source's search matched it on
 * something looser, e.g. a shared word or the artist).
 */
export function matchQuality(event, keyword) {
  const tokens = keywordTokens(keyword);
  if (tokens.length === 0) return 'best';
  const text = `${event.name ?? ''} ${event.venue?.name ?? ''}`.toLowerCase();
  return tokens.every((t) => text.includes(t)) ? 'best' : 'related';
}

/**
 * Fan a query out to every configured provider (that supports the category,
 * if one was given). One provider failing doesn't fail the search; its error
 * is reported in `sources`. Providers return either an array of events or
 * `{ events, notice }` where `notice` explains partial results.
 *
 * Results: best matches first, then related events; each group cheapest first.
 */
export async function searchEvents(registry, query, { preferredCurrency } = {}) {
  const providers = registry.configured().filter((p) => !query.category || p.supportsCategory(query.category));
  const settled = await Promise.allSettled(providers.map((p) => p.search(query)));

  const results = [];
  const sources = settled.map((outcome, i) => {
    const { id, name } = providers[i];
    if (outcome.status === 'fulfilled') {
      const value = outcome.value;
      const events = Array.isArray(value) ? value : (value?.events ?? []);
      results.push(...events);
      const source = { id, name, ok: true, count: events.length };
      if (value?.notice) source.notice = value.notice;
      return source;
    }
    const err = outcome.reason;
    console.warn(`[search] ${id} failed:`, err?.cause?.message ?? err?.message);
    return { id, name, ok: false, error: err?.expose ? err.message : 'Provider error' };
  });

  const warnings = [];
  if (providers.length === 0) {
    warnings.push('No sources are configured. Add an API key to .env or enable District.');
  }

  const withMatch = results.map((event) => ({ ...event, match: matchQuality(event, query.keyword) }));
  const best = withMatch.filter((e) => e.match === 'best');
  const related = withMatch.filter((e) => e.match === 'related');

  return {
    query,
    results: [...sortByTotal(best, { preferredCurrency }), ...sortByTotal(related, { preferredCurrency })],
    sources,
    warnings,
  };
}
