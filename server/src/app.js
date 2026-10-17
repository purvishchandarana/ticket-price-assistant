import express from 'express';
import { CATEGORIES } from './categories.js';
import { parseSearchQuery } from './search/query.js';
import { searchEvents } from './search/searchService.js';

export function createApp({ config, registry }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.get('/api/categories', (_req, res) => {
    res.json(CATEGORIES);
  });

  app.get('/api/providers', (_req, res) => {
    res.json(
      registry.all().map((p) => ({
        id: p.id,
        name: p.name,
        categories: p.categories,
        configured: p.isConfigured(),
      })),
    );
  });

  app.get('/api/search', async (req, res) => {
    const query = parseSearchQuery(req.query);
    res.json(await searchEvents(registry, query, { preferredCurrency: config.preferredCurrency }));
  });

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  // Express 5 forwards rejected async handlers here.
  app.use((err, _req, res, _next) => {
    const status = err.status ?? 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: err.expose ? err.message : 'Internal server error' });
  });

  return app;
}
