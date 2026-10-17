import { USER_AGENT_TOKEN, createHttpClient } from '../lib/http.js';
import { createRobotsChecker } from '../lib/robots.js';
import { BookMyShowProvider } from './bookmyshow.js';
import { DemoProvider } from './demo.js';
import { DistrictProvider } from './district.js';
import { TicketmasterProvider } from './ticketmaster.js';

/** Wrap a list of Provider instances with lookup helpers. */
export function registryFromProviders(providers) {
  const byId = new Map(providers.map((p) => [p.id, p]));
  return {
    all: () => [...providers],
    configured: () => providers.filter((p) => p.isConfigured()),
    get: (id) => byId.get(id),
  };
}

/**
 * Build every known provider from config. Add new sources here.
 * @param {object} [deps]
 * @param {import('../automation/browserAgent.js').BrowserAgent} [deps.agent]  browser-assisted access
 */
export function createProviderRegistry(config, { http = createHttpClient(config.http), agent = null } = {}) {
  // District pages get their own, slower throttle and fewer retries.
  const districtHttp = createHttpClient({ minIntervalMs: config.district.minIntervalMs, maxRetries: 1 });
  const robots = createRobotsChecker({ http: districtHttp, agentToken: USER_AGENT_TOKEN });
  // The demo site is local: no throttling needed beyond a small gap, no retries.
  const demoHttp = createHttpClient({ minIntervalMs: 0, maxRetries: 0, timeoutMs: 3000 });

  return registryFromProviders([
    new DistrictProvider({ http: districtHttp, robots, agent, ...config.district }),
    new BookMyShowProvider({ agent, ...config.bookmyshow }),
    new TicketmasterProvider({ ...config.ticketmaster, http }),
    new DemoProvider({ url: config.demo.url, http: demoHttp }),
  ]);
}
