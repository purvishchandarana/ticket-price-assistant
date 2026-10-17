// Minimal robots.txt support (RFC 9309): user-agent groups, Allow/Disallow with
// `*` and `$` wildcards (longest match wins, Allow wins ties) and Crawl-delay.

import { HttpError } from './http.js';
import { TtlCache } from './cache.js';

/** @returns {{agents: string[], rules: {allow: boolean, pattern: string}[], crawlDelay: number|null}[]} */
export function parseRobots(text) {
  const groups = [];
  let current = null;
  let lastWasAgent = false;

  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    const sep = line.indexOf(':');
    if (sep < 0) continue;
    const field = line.slice(0, sep).trim().toLowerCase();
    const value = line.slice(sep + 1).trim();

    if (field === 'user-agent') {
      if (!lastWasAgent) {
        current = { agents: [], rules: [], crawlDelay: null };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;

    if (field === 'allow' || field === 'disallow') {
      // An empty Disallow means "allow everything"; it adds no rule.
      if (value) current.rules.push({ allow: field === 'allow', pattern: value });
    } else if (field === 'crawl-delay') {
      const seconds = Number(value);
      if (Number.isFinite(seconds) && seconds >= 0) current.crawlDelay = seconds;
    }
  }
  return groups;
}

function patternToRegExp(pattern) {
  const anchored = pattern.endsWith('$');
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${body}${anchored ? '$' : ''}`);
}

/** Pick the group for our agent: the most specific matching token, else `*`. */
export function selectGroup(groups, agentToken) {
  const token = agentToken.toLowerCase();
  let best = null;
  let bestLength = -1;
  for (const group of groups) {
    for (const agent of group.agents) {
      if (agent !== '*' && token.includes(agent) && agent.length > bestLength) {
        best = group;
        bestLength = agent.length;
      }
    }
  }
  if (best) return best;
  // Merge all `*` groups, as crawlers commonly do.
  const star = groups.filter((g) => g.agents.includes('*'));
  if (star.length === 0) return null;
  return {
    agents: ['*'],
    rules: star.flatMap((g) => g.rules),
    crawlDelay: star.find((g) => g.crawlDelay != null)?.crawlDelay ?? null,
  };
}

/** @param {string} pathWithQuery e.g. "/events/foo?x=1" */
export function isPathAllowed(group, pathWithQuery) {
  if (!group) return true;
  let verdict = { allow: true, length: -1 };
  for (const rule of group.rules) {
    if (!patternToRegExp(rule.pattern).test(pathWithQuery)) continue;
    const length = rule.pattern.length;
    if (length > verdict.length || (length === verdict.length && rule.allow)) {
      verdict = { allow: rule.allow, length };
    }
  }
  return verdict.allow;
}

/**
 * Fetches and caches robots.txt per origin. Unreachable robots.txt (network
 * error or 5xx) is treated as "disallow all", per RFC 9309; 4xx means "allow all".
 */
export function createRobotsChecker({ http, agentToken, ttlMs = 24 * 60 * 60 * 1000 }) {
  const cache = new TtlCache({ ttlMs, maxEntries: 50 });

  async function groupFor(origin) {
    const cached = cache.get(origin);
    if (cached !== undefined) return cached;
    let entry;
    try {
      const text = await http.getText(`${origin}/robots.txt`);
      entry = { group: selectGroup(parseRobots(text), agentToken), reachable: true };
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 0;
      entry = status >= 400 && status < 500
        ? { group: null, reachable: true }
        : { group: null, reachable: false };
    }
    cache.set(origin, entry);
    return entry;
  }

  return {
    /** @returns {Promise<{allowed: boolean, crawlDelayMs: number|null}>} */
    async check(url) {
      const u = new URL(url);
      const { group, reachable } = await groupFor(u.origin);
      if (!reachable) return { allowed: false, crawlDelayMs: null };
      return {
        allowed: isPathAllowed(group, u.pathname + u.search),
        crawlDelayMs: group?.crawlDelay != null ? group.crawlDelay * 1000 : null,
      };
    },
  };
}
