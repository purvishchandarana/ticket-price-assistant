function int(value, fallback) {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
}

export function loadConfig(env = process.env) {
  return {
    port: int(env.PORT, 3001),
    host: env.HOST || '127.0.0.1',
    preferredCurrency: (env.PREFERRED_CURRENCY || 'INR').toUpperCase(),
    http: {
      minIntervalMs: int(env.HTTP_MIN_INTERVAL_MS, 500),
    },
    ticketmaster: {
      apiKey: env.TICKETMASTER_API_KEY || '',
      countryCode: env.TICKETMASTER_COUNTRY_CODE || '',
    },
  };
}
