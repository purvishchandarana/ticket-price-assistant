import { Link } from 'react-router';
import { api } from '../lib/api.js';
import { useLive } from '../lib/live.jsx';

/** Global "your turn" banner shown on every page while a session needs you. */
export default function ActionBanner() {
  const { session, setSession, dismissedId, dismissSession } = useLive();
  if (!session || session.id === dismissedId) return null;

  const act = (action) => api.sessionAction(action).then(setSession).catch((e) => alert(e.message));
  let banner = null;

  if (session.status === 'paused' && session.pauseReason === 'challenge') {
    banner = {
      cls: 'bg-amber-100 text-amber-950 border-amber-300',
      title: 'Action needed: your turn',
      body: 'A queue or "verify you are human" check is showing in Chrome. Complete it there; I\'ll resume automatically.',
      action: <button className="btn-amber" onClick={() => act('continue')}>Continue</button>,
    };
  } else if (session.status === 'your_turn') {
    banner = {
      cls: 'bg-sky-100 text-sky-950 border-sky-300',
      title: 'Your turn: choose your seats',
      body: session.challengeVisible?.length
        ? 'A check or queue is showing in Chrome. Complete it, then pick your seats.'
        : 'Pick your seats in Chrome and continue to checkout. I\'ll stop when you reach payment.',
    };
  } else if (session.status === 'at_payment') {
    banner = {
      cls: 'bg-emerald-100 text-emerald-950 border-emerald-300',
      title: 'Complete payment yourself',
      body: 'All automation has stopped and your Chrome tab is in front. Nothing on the payment page is read or recorded.',
      action: <button className="btn-secondary" onClick={() => dismissSession(session.id)}>Done</button>,
    };
  } else if (session.status === 'interrupted') {
    banner = {
      cls: 'bg-amber-50 text-amber-950 border-amber-200',
      title: 'Session interrupted',
      body: 'The server restarted during a booking session.',
      action: <button className="btn-amber" onClick={() => act('continue')}>Re-attach</button>,
    };
  }
  if (!banner) return null;

  return (
    <div role="alert" className={`border-b ${banner.cls}`}>
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{banner.title}</p>
          <p className="text-sm opacity-90">{banner.body}</p>
        </div>
        <Link to="/session" className="text-sm font-medium underline underline-offset-2">Open session</Link>
        {banner.action}
      </div>
    </div>
  );
}
