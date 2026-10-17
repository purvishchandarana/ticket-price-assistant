// Attach to the user's own Chrome over CDP. We never launch, configure or
// modify the browser: no stealth plugins, no flags, no fingerprint changes.

import { chromium } from 'playwright-core';

export class BrowserUnavailableError extends Error {
  constructor(cdpUrl, cause) {
    super(`Can't reach Chrome at ${cdpUrl}. Start Chrome with --remote-debugging-port=9222 and a dedicated --user-data-dir (see README).`);
    this.name = 'BrowserUnavailableError';
    this.status = 503;
    this.expose = true;
    this.cause = cause;
  }
}

export function createBrowserConnector({ cdpUrl, connect = (url) => chromium.connectOverCDP(url) }) {
  let browserPromise = null;

  async function getBrowser() {
    if (!browserPromise) {
      browserPromise = connect(cdpUrl)
        .then((browser) => {
          browser.on('disconnected', () => { browserPromise = null; });
          return browser;
        })
        .catch((err) => {
          browserPromise = null;
          throw new BrowserUnavailableError(cdpUrl, err);
        });
    }
    return browserPromise;
  }

  return {
    cdpUrl,
    getBrowser,

    /** The user's default browser context (their profile's tabs). */
    async getContext() {
      const browser = await getBrowser();
      const context = browser.contexts()[0];
      if (!context) throw new BrowserUnavailableError(cdpUrl, new Error('No browser context'));
      return context;
    },

    /** Find an open tab by URL prefix, e.g. to re-attach after a server restart. */
    async findPage(predicate) {
      const browser = await getBrowser();
      for (const context of browser.contexts()) {
        const page = context.pages().find((p) => !p.isClosed() && predicate(p.url()));
        if (page) return page;
      }
      return null;
    },

    /** Lightweight reachability check that doesn't attach. */
    async status() {
      try {
        const res = await fetch(new URL('/json/version', cdpUrl), { signal: AbortSignal.timeout(2000) });
        const info = await res.json();
        return { reachable: true, browser: info.Browser ?? null };
      } catch {
        return { reachable: false, browser: null };
      }
    },
  };
}
