import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { SessionChip } from '../components/Badges.jsx';
import { api } from '../lib/api.js';
import { formatEventDate, venueLine } from '../lib/format.js';
import { useLive } from '../lib/live.jsx';

const TIMELINE_ICON = { step: '→', pause: '⏸', resume: '▶', handoff: '🤝', error: '⚠', info: '•' };

function LiveView({ session }) {
  const { onFrame } = useLive();
  const img = useRef(null);
  const [hasFrame, setHasFrame] = useState(false);

  useEffect(() => onFrame((frame) => {
    if (frame.sessionId !== session?.id || !img.current) return;
    img.current.src = `data:image/jpeg;base64,${frame.data}`;
    setHasFrame(true);
  }), [onFrame, session?.id]);

  const live = session && ['starting', 'running', 'paused', 'your_turn'].includes(session.status);
  return (
    <div className="relative aspect-[16/10] overflow-hidden rounded-xl bg-slate-900">
      <img ref={img} alt="Live view of the assisted Chrome tab" className={`size-full object-contain ${hasFrame && live ? '' : 'hidden'}`} />
      {(!hasFrame || !live) && (
        <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-slate-300">
          {session?.status === 'at_payment'
            ? 'Live view stopped at the payment page for your privacy.'
            : live ? 'Waiting for the first frame… (the tab must be visible in Chrome)' : 'Live view appears while a session is running.'}
        </div>
      )}
      {live && hasFrame && <span className="absolute left-3 top-3 rounded bg-rose-600 px-2 py-0.5 text-xs font-bold text-white">LIVE</span>}
    </div>
  );
}

export default function Session() {
  const { session, setSession } = useLive();
  const [busy, setBusy] = useState(false);
  const [notifyPermission, setNotifyPermission] = useState(typeof Notification === 'undefined' ? 'unsupported' : Notification.permission);

  useEffect(() => {
    api.currentSession().then(setSession).catch(() => {});
  }, [setSession]);

  async function act(action) {
    setBusy(true);
    try {
      setSession(await api.sessionAction(action));
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (!session) {
    return (
      <div className="card text-slate-600">
        No booking session yet. <Link to="/" className="font-medium text-brand-600 hover:underline">Search for an event</Link> and click <b>Start assist</b>.
      </div>
    );
  }

  const s = session.status;
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <section className="space-y-3">
        <LiveView session={session} />
        <p className="text-xs text-slate-500">Read-only view of the Chrome tab. Click and type in Chrome itself.</p>
      </section>

      <aside className="space-y-4">
        <div className="card space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h1 className="font-semibold">{session.event.name}</h1>
            <SessionChip status={s} />
          </div>
          <p className="text-sm text-slate-600">
            {formatEventDate(session.event.start)}<br />
            {venueLine(session.event.venue)}<br />
            {session.qty} ticket{session.qty > 1 ? 's' : ''} · {session.event.sourceName} · {session.adapter.label}
            {session.filters?.maxPrice ? ` · max ₹${session.filters.maxPrice}` : ''}
          </p>
          <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-800">{session.message}</p>
          {session.currentStep && <p className="text-sm text-brand-700">Now: {session.currentStep.label}</p>}
          {session.pauseDetails?.length > 0 && <p className="text-xs text-amber-800">Detected: {session.pauseDetails.join(', ')}</p>}

          <div className="flex flex-wrap gap-2">
            {(s === 'running' || s === 'your_turn') && <button className="btn-secondary" disabled={busy} onClick={() => act('pause')}>Pause</button>}
            {(s === 'paused' || s === 'interrupted') && <button className="btn-primary" disabled={busy} onClick={() => act('continue')}>Continue</button>}
            {['starting', 'running', 'paused', 'your_turn', 'interrupted'].includes(s) && (
              <button className="btn-secondary text-rose-700" disabled={busy} onClick={() => act('stop')}>Stop</button>
            )}
          </div>
          {notifyPermission === 'default' && (
            <button className="text-xs text-brand-600 underline" onClick={() => Notification.requestPermission().then(setNotifyPermission)}>
              Enable desktop notifications for "your turn" alerts
            </button>
          )}
        </div>

        <div className="card">
          <h2 className="mb-2 text-sm font-semibold text-slate-700">Timeline</h2>
          <ol className="max-h-96 space-y-1.5 overflow-y-auto text-sm">
            {[...session.timeline].reverse().map((t, i) => (
              <li key={`${t.at}-${i}`} className="flex gap-2">
                <span className="w-4 shrink-0 text-center" aria-hidden>{TIMELINE_ICON[t.kind] ?? '•'}</span>
                <span className="min-w-0 flex-1 text-slate-700">{t.message}</span>
                <time className="shrink-0 text-xs text-slate-400">{new Date(t.at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time>
              </li>
            ))}
          </ol>
        </div>
      </aside>
    </div>
  );
}
