import { fileURLToPath } from 'node:url';

function int(value, fallback, { min = -Infinity } = {}) {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) ? Math.max(min, n) : fallback;
}

const bool = (value, fallback) =>
  value === undefined || value === '' ? fallback : /^(1|true|yes|on)$/i.test(value);

const list = (value) => String(value ?? '').split(',').map((s) => s.trim()).filter(Boolean);

const defaultDbFile = fileURLToPath(new URL('../../data/ticket-assistant.db', import.meta.url));

export function loadConfig(env = process.env) {
  const port = int(env.PORT, 3001);
  const clientDevPort = int(env.CLIENT_DEV_PORT, 5173);
  return {
    port,
    host: env.HOST || '127.0.0.1',
    preferredCurrency: (env.PREFERRED_CURRENCY || 'INR').toUpperCase(),
    // Browser origins allowed to call state-changing endpoints and open the WebSocket.
    allowedOrigins: [
      `http://localhost:${port}`, `http://127.0.0.1:${port}`,
      `http://localhost:${clientDevPort}`, `http://127.0.0.1:${clientDevPort}`,
      ...list(env.ALLOWED_ORIGINS),
    ],
    dbFile: env.DB_FILE || defaultDbFile,
    http: {
      minIntervalMs: int(env.HTTP_MIN_INTERVAL_MS, 500, { min: 200 }),
    },
    ticketmaster: {
      apiKey: env.TICKETMASTER_API_KEY || '',
      countryCode: env.TICKETMASTER_COUNTRY_CODE || '',
    },
    district: {
      enabled: bool(env.DISTRICT_ENABLED, true),
      minIntervalMs: int(env.DISTRICT_MIN_INTERVAL_MS, 1500, { min: 1000 }),
      maxPagesPerSearch: int(env.DISTRICT_MAX_PAGES, 5, { min: 1 }),
    },
    bookmyshow: {
      enabled: bool(env.BOOKMYSHOW_ENABLED, true),
      maxPagesPerSearch: int(env.BOOKMYSHOW_MAX_PAGES, 4, { min: 1 }),
    },
    demo: {
      url: env.DEMO_SITE_URL || '',
    },
    browser: {
      cdpUrl: env.CDP_URL || 'http://localhost:9222',
      // Gap between requests to one site from the browser helper tab (ms, min 1000).
      minIntervalMs: int(env.BROWSER_MIN_INTERVAL_MS, 1500, { min: 1000 }),
    },
    watcher: {
      enabled: bool(env.WATCHER_ENABLED, true),
      intervalMs: int(env.WATCH_INTERVAL_MIN, 15, { min: 5 }) * 60_000,
    },
    notify: {
      smtpUrl: env.SMTP_URL || '',
      emailFrom: env.ALERT_EMAIL_FROM || '',
      emailTo: env.ALERT_EMAIL_TO || '',
      twilioAccountSid: env.TWILIO_ACCOUNT_SID || '',
      twilioAuthToken: env.TWILIO_AUTH_TOKEN || '',
      twilioFrom: env.TWILIO_FROM || '',
      smsTo: env.ALERT_SMS_TO || '',
    },
  };
}
