import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createProviderRegistry } from './providers/registry.js';

const config = loadConfig();
const registry = createProviderRegistry(config);
const app = createApp({ config, registry });

app.listen(config.port, config.host, () => {
  console.log(`Ticket Price Assistant API on http://${config.host}:${config.port}`);
  for (const p of registry.all()) {
    console.log(`  provider ${p.name}: ${p.isConfigured() ? 'configured' : 'NOT configured (missing API key)'}`);
  }
});
