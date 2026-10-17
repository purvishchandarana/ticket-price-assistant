// WebSocket hub on /ws: pushes session status, `bot:paused` events, alerts and
// live-view frames to the UI. Control actions go through the REST API.

import { WebSocketServer } from 'ws';
import { isAllowedOrigin, isLoopbackHost } from '../lib/security.js';

const MAX_BUFFERED_BYTES = 2 * 1024 * 1024; // drop frames for slow clients

export function createHub({ server, allowedOrigins, allowAnyHost = false, getSnapshot = () => ({}) }) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });

  server.on('upgrade', (req, socket, head) => {
    const { pathname } = new URL(req.url, 'http://localhost');
    const hostOk = allowAnyHost || isLoopbackHost(req.headers.host);
    // Browsers always send Origin on WebSocket upgrades; require an allowed one.
    const originOk = Boolean(req.headers.origin) && isAllowedOrigin(req.headers.origin, allowedOrigins);
    if (pathname !== '/ws' || !hostOk || !originOk) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  wss.on('connection', (ws) => {
    ws.send(JSON.stringify({ type: 'hello', ...getSnapshot() }));
    ws.on('message', () => {}); // clients don't send commands over the socket
  });

  function send(message, { droppable = false } = {}) {
    const data = JSON.stringify(message);
    for (const client of wss.clients) {
      if (client.readyState !== client.OPEN) continue;
      if (droppable && client.bufferedAmount > MAX_BUFFERED_BYTES) continue;
      client.send(data);
    }
  }

  return {
    broadcast: (type, payload = {}) => send({ type, ...payload }),
    frame: (payload) => send({ type: 'frame', ...payload }, { droppable: true }),
    clientCount: () => wss.clients.size,
    close: () => new Promise((resolve) => wss.close(resolve)),
  };
}
