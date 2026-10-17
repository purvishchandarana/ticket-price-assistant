async function request(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? `Request failed (HTTP ${res.status})`);
  return data;
}

export const api = {
  categories: () => request('GET', '/api/categories'),
  providers: () => request('GET', '/api/providers'),
  browser: () => request('GET', '/api/browser'),
  search: (params) => request('GET', `/api/search?${new URLSearchParams(params)}`),

  watchlist: () => request('GET', '/api/watchlist'),
  watch: (event, qty) => request('POST', '/api/watchlist', { event, qty }),
  unwatch: (eventId) => request('DELETE', `/api/watchlist/${encodeURIComponent(eventId)}`),
  history: (eventId) => request('GET', `/api/watchlist/${encodeURIComponent(eventId)}/history`),
  checkNow: () => request('POST', '/api/watchlist/check'),

  alerts: () => request('GET', '/api/alerts'),
  markAlertsRead: (ids = 'all') => request('POST', '/api/alerts/read', { ids }),

  currentSession: () => request('GET', '/api/sessions/current'),
  startSession: (event, qty, filters) => request('POST', '/api/sessions', { event, qty, filters }),
  sessionAction: (action) => request('POST', `/api/sessions/current/${action}`),
};
