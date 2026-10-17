import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { SaleStatusBadge } from '../components/Badges.jsx';
import StartAssistDialog from '../components/StartAssistDialog.jsx';
import { api } from '../lib/api.js';
import { formatEventDate, formatMinor, formatRelative, venueLine } from '../lib/format.js';
import { useLive } from '../lib/live.jsx';

export default function Watchlist() {
  const { onWatchUpdate, setUnread } = useLive();
  const [items, setItems] = useState(null);
  const [alerts, setAlerts] = useState({ alerts: [], unread: 0, channels: [] });
  const [checking, setChecking] = useState(false);
  const [assist, setAssist] = useState(null);

  const loadAlerts = () => api.alerts().then((a) => { setAlerts(a); setUnread(a.unread); }).catch(() => {});

  useEffect(() => {
    api.watchlist().then(setItems).catch(() => setItems([]));
    loadAlerts();
    return onWatchUpdate((item) => {
      setItems((list) => list?.map((i) => (i.eventId === item.eventId ? item : i)) ?? list);
      loadAlerts();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function checkNow() {
    setChecking(true);
    try {
      setItems(await api.checkNow());
      loadAlerts();
    } catch (e) {
      alert(e.message);
    } finally {
      setChecking(false);
    }
  }

  async function remove(eventId) {
    await api.unwatch(eventId);
    setItems((list) => list.filter((i) => i.eventId !== eventId));
  }

  async function markAllRead() {
    const { unread } = await api.markAlertsRead('all');
    setUnread(unread);
    loadAlerts();
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold tracking-tight">Watchlist</h1>
          <button className="btn-secondary" onClick={checkNow} disabled={checking || !items?.length}>{checking ? 'Checking…' : 'Check now'}</button>
        </div>
        <p className="text-sm text-slate-500">Watched events are re-checked automatically. You'll get an alert when the on-sale status changes or the cheapest total drops.</p>

        {items === null && <div className="card animate-pulse text-slate-500">Loading…</div>}
        {items?.length === 0 && (
          <div className="card text-slate-600">Nothing watched yet. Use <b>Watch</b> on a <Link to="/" className="text-brand-600 hover:underline">search result</Link>.</div>
        )}
        {items?.map((item) => (
          <article key={item.eventId} className="card">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="font-semibold">{item.name}</h2>
                <p className="text-sm text-slate-600">{formatEventDate(item.event.start)} · {venueLine(item.event.venue)}</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm">
                  <SaleStatusBadge status={item.lastStatus} />
                  <span className="text-slate-700">{formatMinor(item.lastTotalMinor, item.lastCurrency ?? 'INR')} for {item.qty}</span>
                  <span className="text-slate-400">· {item.event.sourceName} · checked {formatRelative(item.lastCheckedAt)}</span>
                </div>
                {item.lastError && <p className="mt-1 text-sm text-rose-700">Last check failed: {item.lastError}</p>}
              </div>
              <div className="flex flex-wrap gap-2">
                <button className="btn-primary" onClick={() => setAssist(item)}>Start assist</button>
                {item.url && <a className="btn-secondary" href={item.url} target="_blank" rel="noreferrer">Open ↗</a>}
                <button className="btn-secondary" onClick={() => remove(item.eventId)}>Remove</button>
              </div>
            </div>
          </article>
        ))}
      </section>

      <aside className="card h-fit space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Alerts</h2>
          {alerts.unread > 0 && <button className="text-xs text-brand-600 underline" onClick={markAllRead}>Mark all read</button>}
        </div>
        <p className="text-xs text-slate-500">Delivered in-app{alerts.channels.length ? ` and by ${alerts.channels.join(' + ')}` : ''}. Email/SMS are optional (see .env).</p>
        {alerts.alerts.length === 0 && <p className="text-sm text-slate-500">No alerts yet.</p>}
        <ul className="space-y-2">
          {alerts.alerts.map((a) => (
            <li key={a.id} className={`rounded-lg p-2.5 text-sm ${a.readAt ? 'bg-slate-50 text-slate-600' : 'bg-brand-50 ring-1 ring-brand-100'}`}>
              <p className="font-medium">{a.title}</p>
              <p>{a.message}</p>
              <p className="mt-0.5 text-xs text-slate-400">
                {formatRelative(a.createdAt)}
                {a.url && <> · <a href={a.url} target="_blank" rel="noreferrer" className="text-brand-600 underline">Open event</a></>}
              </p>
            </li>
          ))}
        </ul>
      </aside>

      {assist && <StartAssistDialog event={assist.event} qty={assist.qty} onClose={() => setAssist(null)} />}
    </div>
  );
}
