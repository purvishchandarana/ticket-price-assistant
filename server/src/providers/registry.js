import { createHttpClient } from '../lib/http.js';
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

/** Build every known provider from config. Add new sources here. */
export function createProviderRegistry(config, { http = createHttpClient(config.http) } = {}) {
  return registryFromProviders([
    new TicketmasterProvider({ ...config.ticketmaster, http }),
  ]);
}
