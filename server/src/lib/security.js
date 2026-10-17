// The API controls your browser, so it must only be usable from this machine
// and from this app's own pages:
//   - Host header must be a loopback name (blocks DNS-rebinding attacks).
//   - Browser requests that change state must come from an allowed Origin
//     (blocks other websites from driving the API / WebSocket via your browser).

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

export function isLoopbackHost(hostHeader) {
  if (!hostHeader) return false;
  const host = hostHeader.startsWith('[')
    ? hostHeader.slice(0, hostHeader.indexOf(']') + 1)
    : hostHeader.split(':')[0];
  return LOOPBACK_HOSTS.has(host.toLowerCase());
}

/** Missing Origin (curl, server-to-server) is allowed; a foreign Origin is not. */
export function isAllowedOrigin(origin, allowedOrigins) {
  if (!origin) return true;
  return allowedOrigins.includes(origin);
}

export function securityMiddleware({ allowedOrigins, allowAnyHost = false }) {
  return (req, res, next) => {
    if (!allowAnyHost && !isLoopbackHost(req.headers.host)) {
      return res.status(403).json({ error: 'Forbidden host' });
    }
    const safeMethod = req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS';
    if (!safeMethod && !isAllowedOrigin(req.headers.origin, allowedOrigins)) {
      return res.status(403).json({ error: 'Forbidden origin' });
    }
    next();
  };
}
