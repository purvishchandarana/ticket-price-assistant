import { sortByTotal } from '../pricing/normalizer.js';

/**
 * Fan a query out to every configured provider that supports the category.
 * One provider failing doesn't fail the search; its error is reported in `sources`.
 */
export async function searchEvents(registry, query, { preferredCurrency } = {}) {
  const providers = registry.configured().filter((p) => p.supportsCategory(query.category));
  const settled = await Promise.allSettled(providers.map((p) => p.search(query)));

  const results = [];
  const sources = settled.map((outcome, i) => {
    const { id, name } = providers[i];
    if (outcome.status === 'fulfilled') {
      results.push(...outcome.value);
      return { id, name, ok: true, count: outcome.value.length };
    }
    const err = outcome.reason;
    console.warn(`[search] ${id} failed:`, err?.cause?.message ?? err?.message);
    return { id, name, ok: false, error: err?.expose ? err.message : 'Provider error' };
  });

  const warnings = [];
  if (providers.length === 0) {
    warnings.push('No providers are configured for this category. Add an API key to .env.');
  }

  return {
    query,
    results: sortByTotal(results, { preferredCurrency }),
    sources,
    warnings,
  };
}
