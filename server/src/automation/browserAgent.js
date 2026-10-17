// Browser-assisted data access: runs a few low-rate requests inside a helper
// tab in the user's own Chrome (the same Chrome used for booking assist).
//
// Used for sites that only serve real browsers (BookMyShow) or whose search
// only works from their own web page (District). It is the user's real,
// unmodified browser and session: no stealth, no spoofed headers, no
// fingerprint changes. If a site shows a CAPTCHA or bot check, the agent
// pauses, brings the tab to the front and waits for the human to complete it.

import { EventEmitter } from 'node:events';
import { isPathAllowed, parseRobots, selectGroup } from '../lib/robots.js';
import { USER_AGENT_TOKEN } from '../lib/http.js';
import { challengeDetected } from './challenge.js';
import { sleep } from './pacing.js';

export class BrowserAgentError extends Error {
  constructor(message, { status } = {}) {
    super(message);
    this.name = 'BrowserAgentError';
    this.expose = true;
    this.status = status;
  }
}

export class BrowserAgent extends EventEmitter {
  #tabs = new Map();
  #queues = new Map();
  #nextSlot = new Map();
  #robots = new Map();

  constructor({
    browser,
    minIntervalMs = 1500,
    challengeTimeoutMs = 120_000,
    pollMs = 1500,
    detectChallenge = challengeDetected,
  }) {
    super();
    this.browser = browser;
    this.minIntervalMs = minIntervalMs;
    this.challengeTimeoutMs = challengeTimeoutMs;
    this.pollMs = pollMs;
    this.detectChallenge = detectChallenge;
  }

  async available() {
    return (await this.browser.status()).reachable;
  }

  /**
   * Run `fn` with a helper tab for `origin`. Calls for the same origin are
   * serialized, so a site never sees parallel requests from us.
   */
  withTab(origin, fn) {
    const previous = this.#queues.get(origin) ?? Promise.resolve();
    const run = previous.catch(() => {}).then(async () => {
      if (!(await this.available())) {
        throw new BrowserAgentError('Chrome is not running with remote debugging. Start it to include this source (see README).', { status: 503 });
      }
      const page = await this.#tab(origin);
      return fn(this.#api(page, origin));
    });
    this.#queues.set(origin, run);
    return run;
  }

  async #tab(origin) {
    let page = this.#tabs.get(origin);
    if (!page || page.isClosed()) {
      // Reuse a tab already open on this site (e.g. from before a server
      // restart) rather than piling up new ones.
      page = await this.browser.findPage?.((url) => url.startsWith(origin)) ?? null;
      if (!page) page = await (await this.browser.getContext()).newPage();
      this.#tabs.set(origin, page);
    }
    return page;
  }

  async #throttle(origin) {
    const now = Date.now();
    const slot = Math.max(now, this.#nextSlot.get(origin) ?? 0);
    this.#nextSlot.set(origin, slot + this.minIntervalMs);
    if (slot > now) await sleep(slot - now);
  }

  /** In-page fetch: a normal same-origin request from the real browser session. */
  async #pageFetch(page, url) {
    return page.evaluate(async (target) => {
      const res = await fetch(target, { credentials: 'include' });
      return { status: res.status, text: await res.text() };
    }, url);
  }

  async #checkRobots(page, origin, url) {
    let group = this.#robots.get(origin);
    if (group === undefined) {
      try {
        const { status, text } = await this.#pageFetch(page, `${origin}/robots.txt`);
        if (status >= 500) throw new Error(`HTTP ${status}`);
        group = status >= 400 ? null : selectGroup(parseRobots(text), USER_AGENT_TOKEN);
      } catch {
        group = { agents: ['*'], rules: [{ allow: false, pattern: '/' }] }; // unreachable: be conservative
      }
      this.#robots.set(origin, group);
    }
    const u = new URL(url, origin);
    if (!isPathAllowed(group, u.pathname + u.search)) {
      throw new BrowserAgentError(`robots.txt disallows ${u.pathname}`);
    }
  }

  /** Pause until the human clears a challenge on this tab (or time out). */
  async #clearChallenges(page, origin) {
    let check = await this.detectChallenge(page);
    if (!check.detected) return;
    this.emit('attention', { origin, reasons: check.reasons });
    await page.bringToFront().catch(() => {});
    const deadline = Date.now() + this.challengeTimeoutMs;
    while (check.detected) {
      if (Date.now() > deadline) {
        throw new BrowserAgentError(`${new URL(origin).hostname} is showing a check in Chrome. Complete it, then search again.`);
      }
      await sleep(this.pollMs);
      check = await this.detectChallenge(page);
    }
    this.emit('cleared', { origin });
  }

  #api(page, origin) {
    const absolute = (url) => new URL(url, origin).toString();
    /** Navigate the helper tab. `reload: true` loads the page even if it's already open. */
    const goto = async (url, { reload = false } = {}) => {
      const target = absolute(url);
      await this.#throttle(origin);
      if (!page.url().startsWith(origin)) {
        // First visit to the site in this tab: robots.txt needs a same-origin page.
        await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        await this.#clearChallenges(page, origin);
      }
      await this.#checkRobots(page, origin, target);
      if (reload || page.url() !== target) {
        await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      }
      await this.#clearChallenges(page, origin);
    };

    const fetchText = async (url) => {
      const target = absolute(url);
      if (!page.url().startsWith(origin)) await goto(origin);
      await this.#checkRobots(page, origin, target);
      await this.#throttle(origin);
      let result = await this.#pageFetch(page, target);
      if (result.status === 403 || result.status === 429 || result.status === 503) {
        // Possibly a bot check: reload the site's home page so any check shows
        // up for the human to clear, then retry once.
        await goto(origin, { reload: true });
        await this.#throttle(origin);
        result = await this.#pageFetch(page, target);
      }
      if (result.status >= 400) {
        const host = new URL(origin).hostname;
        const blocked = /you have been blocked|access denied|attention required/i.test(
          await page.evaluate(() => `${document.title} ${document.body?.innerText?.slice(0, 500) ?? ''}`).catch(() => ''),
        );
        // A hard block is the site's decision; we report it and never try to get around it.
        throw new BrowserAgentError(blocked
          ? `${host} is blocking automated access from this Chrome. Search there directly; the assistant won't try to get around the block.`
          : `${host} returned HTTP ${result.status}.`, { status: result.status });
      }
      return result.text;
    };

    return {
      page,
      goto,
      fetchText,
      fetchJson: async (url) => JSON.parse(await fetchText(url)),
      clearChallenges: () => this.#clearChallenges(page, origin),
    };
  }
}
