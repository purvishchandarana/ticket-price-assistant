// Polite JSON HTTP client: per-host throttling, bounded retries on 429/5xx
// (honouring Retry-After), request timeouts, and secret redaction in errors.

const SECRET_PARAMS = ['apikey', 'api_key', 'client_id', 'client_secret', 'token', 'access_token'];
const MAX_RETRY_AFTER_MS = 30_000;

export class HttpError extends Error {
  constructor(message, { status, url, body } = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.url = url;
    this.body = body;
  }
}

/** Replace secret query params so URLs are safe to log or return. */
export function redactUrl(url) {
  try {
    const u = new URL(url);
    for (const key of SECRET_PARAMS) {
      if (u.searchParams.has(key)) u.searchParams.set(key, 'REDACTED');
    }
    return u.toString();
  } catch {
    return '[unparseable url]';
  }
}

export function parseRetryAfter(value, now = Date.now()) {
  if (!value) return null;
  const seconds = Number(value);
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - now;
  if (!Number.isFinite(ms) || ms < 0) return null;
  return Math.min(ms, MAX_RETRY_AFTER_MS);
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function createHttpClient({
  minIntervalMs = 500,
  maxRetries = 2,
  timeoutMs = 10_000,
  userAgent = 'TicketPriceAssistant/0.1 (personal use)',
  fetchImpl = globalThis.fetch,
  sleep = defaultSleep,
} = {}) {
  const nextSlotByHost = new Map();

  // Reserve the next free slot for this host so concurrent callers queue up.
  async function throttle(host) {
    const now = Date.now();
    const slot = Math.max(now, nextSlotByHost.get(host) ?? 0);
    nextSlotByHost.set(host, slot + minIntervalMs);
    if (slot > now) await sleep(slot - now);
  }

  const backoff = (attempt) => 500 * 2 ** attempt + Math.floor(Math.random() * 250);

  async function getJson(url, { headers = {} } = {}) {
    const host = new URL(url).host;
    const safeUrl = redactUrl(url);

    for (let attempt = 0; ; attempt++) {
      await throttle(host);

      let res;
      try {
        res = await fetchImpl(url, {
          headers: { accept: 'application/json', 'user-agent': userAgent, ...headers },
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        if (attempt < maxRetries) {
          await sleep(backoff(attempt));
          continue;
        }
        throw new HttpError(`Network error contacting ${host}: ${err.message}`, { status: 0, url: safeUrl });
      }

      if (res.ok) return res.json();

      const retryable = res.status === 429 || res.status >= 500;
      if (retryable && attempt < maxRetries) {
        await sleep(parseRetryAfter(res.headers.get('retry-after')) ?? backoff(attempt));
        continue;
      }

      const body = await res.text().catch(() => '');
      throw new HttpError(`HTTP ${res.status} from ${host}`, {
        status: res.status,
        url: safeUrl,
        body: body.slice(0, 500),
      });
    }
  }

  return { getJson };
}
