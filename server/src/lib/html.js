// Helpers for reading structured data out of public HTML pages. No DOM
// selectors: only schema.org JSON-LD, sitemaps, and embedded JSON payloads.

const decodeXml = (s) =>
  s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");

/** Parse a sitemap. Returns page URLs (`urlset`) and child sitemaps (`sitemapindex`). */
export function parseSitemap(xml) {
  const urls = [];
  const sitemaps = [];
  const blockRe = /<(url|sitemap)>([\s\S]*?)<\/\1>/g;
  let m;
  while ((m = blockRe.exec(xml))) {
    const loc = m[2].match(/<loc>\s*([^<]+?)\s*<\/loc>/)?.[1];
    if (!loc) continue;
    const lastmod = m[2].match(/<lastmod>\s*([^<]+?)\s*<\/lastmod>/)?.[1] ?? null;
    (m[1] === 'url' ? urls : sitemaps).push({ url: decodeXml(loc), lastmod });
  }
  return { urls, sitemaps };
}

/** All JSON-LD objects on a page, flattened (arrays and @graph expanded). */
export function extractJsonLd(html) {
  const out = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    let data;
    try {
      data = JSON.parse(m[1].trim());
    } catch {
      continue;
    }
    const stack = Array.isArray(data) ? [...data] : [data];
    while (stack.length) {
      const item = stack.shift();
      if (!item || typeof item !== 'object') continue;
      if (Array.isArray(item['@graph'])) stack.push(...item['@graph']);
      out.push(item);
    }
  }
  return out;
}

export function hasType(item, type) {
  const t = item?.['@type'];
  return Array.isArray(t) ? t.includes(type) : t === type;
}

/**
 * Concatenate the Next.js streaming payload (`self.__next_f.push([1,"…"])`)
 * into one string. Returns '' if the page has none.
 */
export function extractNextFlight(html) {
  let out = '';
  const re = /self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g;
  let m;
  while ((m = re.exec(html))) {
    try {
      out += JSON.parse(`"${m[1]}"`);
    } catch {
      // Skip a malformed chunk rather than failing the page.
    }
  }
  return out;
}

/**
 * Find JSON objects embedded anywhere in `text` that have all of `requiredKeys`
 * as their own properties. String-aware brace scanning; tolerant of non-JSON
 * text between objects.
 */
export function findJsonObjects(text, requiredKeys, { maxObjectLength = 50_000 } = {}) {
  const found = [];
  const starts = [];
  let inString = false;
  let escaped = false;

  // Positions of the first required key, so each candidate object can be
  // checked with a binary search instead of re-scanning its text.
  const probe = `"${requiredKeys[0]}"`;
  const probes = [];
  for (let p = text.indexOf(probe); p >= 0; p = text.indexOf(probe, p + 1)) probes.push(p);
  if (probes.length === 0) return found;
  const hasProbeBetween = (from, to) => {
    let lo = 0;
    let hi = probes.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (probes[mid] < from) lo = mid + 1;
      else hi = mid;
    }
    return lo < probes.length && probes[lo] < to;
  };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === '{') starts.push(i);
    else if (c === '}' && starts.length) {
      const start = starts.pop();
      if (i + 1 - start > maxObjectLength || !hasProbeBetween(start, i)) continue;
      try {
        const obj = JSON.parse(text.slice(start, i + 1));
        if (requiredKeys.every((k) => Object.hasOwn(obj, k))) found.push(obj);
      } catch {
        // Not valid JSON on its own; ignore.
      }
    }
  }
  return found;
}
