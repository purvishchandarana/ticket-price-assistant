import { existsSync } from 'node:fs';
import { join } from 'node:path';
import express from 'express';
import { CATEGORIES } from './categories.js';
import { securityMiddleware } from './lib/security.js';
import { ValidationError, parseQty, parseSearchQuery } from './search/query.js';
import { searchEvents } from './search/searchService.js';

/** Validate an event snapshot sent back by the UI (from search results). */
function parseEventPayload(event, registry) {
  const str = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max;
  if (!event || typeof event !== 'object') throw new ValidationError('event is required');
  if (!str(event.id, 300) || !str(event.sourceEventId, 300) || !str(event.name, 300)) {
    throw new ValidationError('event must include id, sourceEventId and name');
  }
  if (!registry.get(event.source)) throw new ValidationError('event.source is not a known provider');
  if (!str(event.url, 2000) || !/^https?:\/\//i.test(event.url)) throw new ValidationError('event.url must be an http(s) URL');
  return event;
}

function parseFilters(filters = {}) {
  const out = {};
  if (filters.maxPrice !== undefined && filters.maxPrice !== null && filters.maxPrice !== '') {
    const maxPrice = Number(filters.maxPrice);
    if (!Number.isFinite(maxPrice) || maxPrice <= 0 || maxPrice > 10_000_000) {
      throw new ValidationError('filters.maxPrice must be a positive number');
    }
    out.maxPrice = Math.round(maxPrice);
  }
  return out;
}

/**
 * @param {object} deps  `config` and `registry` are required; the rest are
 *   optional so tests can mount only what they need.
 */
export function createApp({ config, registry, store, sessions, watcher, browser, notifier, clientDir }) {
  const app = express();
  app.disable('x-powered-by');
  app.use('/api', securityMiddleware({ allowedOrigins: config.allowedOrigins ?? [] }));
  app.use(express.json({ limit: '100kb' }));

  app.get('/api/health', (_req, res) => res.json({ ok: true }));

  app.get('/api/categories', (_req, res) => res.json(CATEGORIES));

  app.get('/api/providers', (_req, res) => {
    res.json(registry.all().map((p) => ({
      id: p.id, name: p.name, categories: p.categories, configured: p.isConfigured(),
    })));
  });

  // Identical searches already in flight share one run, so sites never see
  // duplicate requests (e.g. a page reload, or React dev mode's double effects).
  const inFlight = new Map();
  app.get('/api/search', async (req, res) => {
    const query = parseSearchQuery(req.query);
    const key = JSON.stringify(query);
    if (!inFlight.has(key)) {
      inFlight.set(key, searchEvents(registry, query, { preferredCurrency: config.preferredCurrency })
        .finally(() => inFlight.delete(key)));
    }
    res.json(await inFlight.get(key));
  });

  if (browser) {
    app.get('/api/browser', async (_req, res) => {
      res.json({ cdpUrl: browser.cdpUrl, ...(await browser.status()) });
    });
  }

  if (sessions) {
    app.get('/api/sessions/current', (_req, res) => res.json(sessions.current()));

    app.post('/api/sessions', async (req, res) => {
      const event = parseEventPayload(req.body?.event, registry);
      const qty = parseQty(req.body?.qty);
      const filters = parseFilters(req.body?.filters);
      res.status(201).json(await sessions.start({ event, qty, filters }));
    });

    app.post('/api/sessions/current/:action', async (req, res) => {
      const actions = {
        pause: () => sessions.pause(),
        continue: () => sessions.continue(),
        stop: () => sessions.stop(),
      };
      const action = actions[req.params.action];
      if (!action) return res.status(404).json({ error: 'Unknown action' });
      res.json(await action());
    });
  }

  if (store) {
    app.get('/api/watchlist', (_req, res) => res.json(store.watchlist.list()));

    app.post('/api/watchlist', (req, res) => {
      const event = parseEventPayload(req.body?.event, registry);
      res.status(201).json(store.watchlist.add(event, parseQty(req.body?.qty)));
    });

    app.delete('/api/watchlist/:eventId', (req, res) => {
      if (!store.watchlist.remove(req.params.eventId)) return res.status(404).json({ error: 'Not watching that event' });
      res.status(204).end();
    });

    app.get('/api/watchlist/:eventId/history', (req, res) => {
      res.json(store.watchlist.history(req.params.eventId));
    });

    if (watcher) {
      app.post('/api/watchlist/check', async (_req, res) => {
        await watcher.checkAll();
        res.json(store.watchlist.list());
      });
    }

    app.get('/api/alerts', (_req, res) => {
      res.json({ alerts: store.alerts.list(), unread: store.alerts.unreadCount(), channels: notifier?.channels ?? [] });
    });

    app.post('/api/alerts/read', (req, res) => {
      const ids = req.body?.ids;
      if (ids !== 'all' && !(Array.isArray(ids) && ids.every(Number.isInteger))) {
        throw new ValidationError('ids must be "all" or an array of alert ids');
      }
      store.alerts.markRead(ids);
      res.json({ unread: store.alerts.unreadCount() });
    });
  }

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

  // Serve the built UI (npm run build) from the same origin, if present.
  if (clientDir && existsSync(join(clientDir, 'index.html'))) {
    app.use(express.static(clientDir));
    app.get(/^(?!\/api\/|\/ws$).*/, (_req, res) => res.sendFile(join(clientDir, 'index.html')));
  }

  // Express 5 forwards rejected async handlers here.
  app.use((err, _req, res, _next) => {
    const status = err.status ?? err.statusCode ?? 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: err.expose ? err.message : 'Internal server error' });
  });

  return app;
}
