import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { pickAdapter } from '../adapters/index.js';
import { createApp } from './app.js';
import { createBrowserConnector } from './automation/browser.js';
import { BrowserAgent } from './automation/browserAgent.js';
import { SessionManager } from './automation/sessionManager.js';
import { loadConfig } from './config.js';
import { openStore } from './db/store.js';
import { createProviderRegistry } from './providers/registry.js';
import { createWatcher } from './watcher/watcher.js';
import { createNotifier } from './watcher/notifiers.js';
import { createHub } from './ws/hub.js';

const config = loadConfig();
const browser = createBrowserConnector({ cdpUrl: config.browser.cdpUrl });
const agent = new BrowserAgent({ browser, minIntervalMs: config.browser.minIntervalMs });
const registry = createProviderRegistry(config, { agent });
const store = openStore(config.dbFile);
const notifier = createNotifier(config.notify);
const sessions = new SessionManager({ store, browser, pickAdapter });
sessions.init();

let hub = null;
const watcher = createWatcher({
  store,
  registry,
  intervalMs: config.watcher.intervalMs,
  notify: (alert) => notifier.notify(alert),
  onAlert: (alert) => hub?.broadcast('alert', { alert, unread: store.alerts.unreadCount() }),
  onItem: (item) => hub?.broadcast('watchlist:update', { item }),
});

const clientDir = fileURLToPath(new URL('../../client/dist', import.meta.url));
const app = createApp({ config, registry, store, sessions, watcher, browser, notifier, clientDir });
const server = createServer(app);

hub = createHub({
  server,
  allowedOrigins: config.allowedOrigins,
  getSnapshot: () => ({ session: sessions.current(), unread: store.alerts.unreadCount() }),
});
sessions.on('update', (session) => hub.broadcast('session:update', { session }));
sessions.on('paused', (payload) => hub.broadcast('bot:paused', payload));
sessions.on('resumed', (payload) => hub.broadcast('bot:resumed', payload));
sessions.on('payment', (payload) => hub.broadcast('bot:payment', payload));
sessions.on('frame', (frame) => { if (hub.clientCount() > 0) hub.frame(frame); });
// A site showed a CAPTCHA / bot check in the search helper tab: the human's turn.
agent.on('attention', ({ origin, reasons }) => hub.broadcast('source:attention', { site: new URL(origin).hostname, reasons }));
agent.on('cleared', ({ origin }) => hub.broadcast('source:cleared', { site: new URL(origin).hostname }));

server.listen(config.port, config.host, () => {
  console.log(`Ticket Price Assistant on http://${config.host}:${config.port}`);
  for (const p of registry.all()) {
    console.log(`  provider ${p.name}: ${p.isConfigured() ? 'enabled' : 'not configured'}`);
  }
  console.log(`  Chrome (CDP): ${config.browser.cdpUrl}`);
  console.log(`  alerts: in-app${notifier.channels.length ? ` + ${notifier.channels.join(', ')}` : ''}`);
  if (config.watcher.enabled) {
    watcher.start();
    console.log(`  watcher: every ${config.watcher.intervalMs / 60_000} min`);
  }
});

function shutdown() {
  watcher.stop();
  server.close();
  store.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
