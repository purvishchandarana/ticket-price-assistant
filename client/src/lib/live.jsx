// Live connection to the server's WebSocket: session status, bot:paused
// events, alerts and screencast frames.

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

const LiveContext = createContext(null);

function desktopNotify(title, body) {
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && document.hidden) {
    new Notification(title, { body });
  }
}

export function LiveProvider({ children }) {
  const [connected, setConnected] = useState(false);
  const [session, setSession] = useState(null);
  const [unread, setUnread] = useState(0);
  const [toasts, setToasts] = useState([]);
  const [dismissedId, setDismissedId] = useState(null); // hides the "complete payment" banner once acknowledged
  const frameListeners = useRef(new Set());
  const watchListeners = useRef(new Set());

  const pushToast = useCallback((toast) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((list) => [...list.slice(-3), { id, ...toast }]);
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), 8000);
  }, []);

  useEffect(() => {
    let ws;
    let retry;
    let closed = false;

    function connect() {
      const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
      ws = new WebSocket(`${protocol}://${location.host}/ws`);
      ws.onopen = () => setConnected(true);
      ws.onclose = () => {
        setConnected(false);
        if (!closed) retry = setTimeout(connect, 2000);
      };
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        switch (msg.type) {
          case 'hello':
            setSession(msg.session ?? null);
            setUnread(msg.unread ?? 0);
            break;
          case 'session:update':
            setSession(msg.session);
            break;
          case 'bot:paused':
            if (msg.reason === 'challenge') {
              pushToast({ tone: 'warn', title: 'Action needed: your turn', body: 'Complete the check or wait in the queue in Chrome.' });
              desktopNotify('Action needed: your turn', 'Complete the check or queue in Chrome.');
            } else if (msg.reason === 'your_turn') {
              pushToast({ tone: 'info', title: 'Your turn', body: 'Choose your seats in Chrome.' });
              desktopNotify('Your turn', 'Choose your seats in Chrome.');
            }
            break;
          case 'bot:payment':
            pushToast({ tone: 'ok', title: 'Complete payment yourself', body: 'Automation has stopped. Your Chrome tab is in front.' });
            desktopNotify('Complete payment yourself', 'Automation has stopped.');
            break;
          case 'source:attention':
            pushToast({ tone: 'warn', title: `Action needed in Chrome: ${msg.site}`, body: 'The site is showing a check. Complete it in Chrome and the search will continue.' });
            desktopNotify('Action needed in Chrome', `${msg.site} is showing a check.`);
            break;
          case 'source:cleared':
            pushToast({ tone: 'ok', title: `${msg.site}: check cleared`, body: 'Continuing the search…' });
            break;
          case 'alert':
            setUnread(msg.unread ?? 0);
            pushToast({ tone: 'info', title: msg.alert.title, body: msg.alert.message, url: msg.alert.url });
            desktopNotify(msg.alert.title, msg.alert.message);
            break;
          case 'watchlist:update':
            watchListeners.current.forEach((fn) => fn(msg.item));
            break;
          case 'frame':
            frameListeners.current.forEach((fn) => fn(msg));
            break;
          default:
        }
      };
    }

    connect();
    return () => {
      closed = true;
      clearTimeout(retry);
      ws?.close();
    };
  }, [pushToast]);

  // Flag the tab title when the user needs to act.
  useEffect(() => {
    const needsAction = session && session.id !== dismissedId && (
      (session.status === 'paused' && session.pauseReason === 'challenge') ||
      session.status === 'your_turn' || session.status === 'at_payment');
    document.title = needsAction ? '● Your turn · Ticket Price Assistant' : 'Ticket Price Assistant';
  }, [session, dismissedId]);

  const value = {
    connected,
    session,
    setSession,
    dismissedId,
    dismissSession: (id) => setDismissedId(id),
    unread,
    setUnread,
    toasts,
    dismissToast: (id) => setToasts((list) => list.filter((t) => t.id !== id)),
    onFrame: (fn) => {
      frameListeners.current.add(fn);
      return () => frameListeners.current.delete(fn);
    },
    onWatchUpdate: (fn) => {
      watchListeners.current.add(fn);
      return () => watchListeners.current.delete(fn);
    },
  };
  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}

export const useLive = () => useContext(LiveContext);
