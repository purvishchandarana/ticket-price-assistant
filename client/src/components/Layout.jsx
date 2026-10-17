import { NavLink, Outlet } from 'react-router';
import { useLive } from '../lib/live.jsx';
import ActionBanner from './ActionBanner.jsx';
import { SessionChip } from './Badges.jsx';

const navClass = ({ isActive }) =>
  `rounded-lg px-3 py-1.5 text-sm font-medium transition ${isActive ? 'bg-white/15 text-white' : 'text-brand-100 hover:bg-white/10 hover:text-white'}`;

export default function Layout() {
  const { session, unread, connected, toasts, dismissToast } = useLive();
  const sessionActive = session && !['stopped', 'error'].includes(session.status);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="bg-brand-900 text-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <NavLink to="/" className="flex items-center gap-2 text-lg font-semibold tracking-tight">
            <span aria-hidden>🎟️</span> Ticket Price Assistant
          </NavLink>
          <nav className="flex flex-1 flex-wrap items-center gap-1">
            <NavLink to="/" end className={navClass}>Search</NavLink>
            <NavLink to="/watchlist" className={navClass}>
              Watchlist{unread > 0 && <span className="ml-1.5 rounded-full bg-amber-400 px-1.5 text-xs font-bold text-amber-950">{unread}</span>}
            </NavLink>
            <NavLink to="/session" className={navClass}>
              <span className="inline-flex items-center gap-2">Session {sessionActive && <SessionChip status={session.status} />}</span>
            </NavLink>
          </nav>
          <span className={`text-xs ${connected ? 'text-emerald-300' : 'text-rose-300'}`} title="Live connection to the local server">
            ● {connected ? 'Live' : 'Reconnecting…'}
          </span>
        </div>
      </header>
      <ActionBanner />

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        <Outlet />
      </main>

      <footer className="border-t border-slate-200 py-4 text-center text-xs text-slate-500">
        You solve CAPTCHAs and queues, choose seats, and pay. Automation stops at payment.
      </footer>

      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2">
        {toasts.map((t) => (
          <div key={t.id} className={`pointer-events-auto rounded-xl border bg-white p-3 shadow-lg ${t.tone === 'warn' ? 'border-amber-300' : t.tone === 'ok' ? 'border-emerald-300' : 'border-slate-200'}`}>
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{t.title}</p>
                {t.body && <p className="text-sm text-slate-600">{t.body}</p>}
                {t.url && <a href={t.url} target="_blank" rel="noreferrer" className="text-sm font-medium text-brand-600 underline">Open event</a>}
              </div>
              <button className="text-slate-400 hover:text-slate-700" onClick={() => dismissToast(t.id)} aria-label="Dismiss">×</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
