import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { api } from '../lib/api.js';
import { useLive } from '../lib/live.jsx';
import ChromeHelp from './ChromeHelp.jsx';

export default function StartAssistDialog({ event, qty: initialQty, onClose }) {
  const navigate = useNavigate();
  const { setSession } = useLive();
  const [qty, setQty] = useState(initialQty);
  const [maxPrice, setMaxPrice] = useState('');
  const [browser, setBrowser] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const fullPrefill = event.source === 'demo';

  useEffect(() => {
    api.browser().then(setBrowser).catch(() => setBrowser({ reachable: false }));
  }, []);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const session = await api.startSession(event, qty, maxPrice ? { maxPrice: Number(maxPrice) } : {});
      setSession(session);
      navigate('/session');
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="assist-title" className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 id="assist-title" className="text-lg font-semibold">Start booking assist</h2>
        <p className="mt-1 text-sm text-slate-600">{event.name}</p>

        <div className="mt-4 rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
          {fullPrefill
            ? 'Opens the event in your Chrome, sets quantity and filters, and pauses for queues or checks. You pick seats and pay.'
            : event.source === 'district'
              ? 'Opens the event in your Chrome, picks this date and show, then the cheapest stand and ticket type (within your max price) and sets the quantity. Then it\'s your turn: check it, click "Add to cart" and continue. It stops at payment.'
              : `"Open & watch" mode for ${event.sourceName}: opens the event in your Chrome and watches for queues and checkout. It doesn't click or type on the site. You choose tickets and pay.`}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <label className="text-sm font-medium">Tickets
            <select className="field mt-1" value={qty} onChange={(e) => setQty(Number(e.target.value))}>
              {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => <option key={n}>{n}</option>)}
            </select>
          </label>
          {(fullPrefill || event.source === 'district') && (
            <label className="text-sm font-medium">Max price / ticket (₹)
              <input className="field mt-1" type="number" min="1" placeholder="Any" value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)} />
            </label>
          )}
        </div>

        {browser && !browser.reachable && <div className="mt-4"><ChromeHelp /></div>}
        {browser?.reachable && <p className="mt-4 text-sm text-emerald-700">● Connected to {browser.browser ?? 'Chrome'}</p>}
        {error && <p className="mt-3 text-sm text-rose-700">{error}</p>}

        <div className="mt-6 flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={busy || !browser?.reachable} onClick={start}>
            {busy ? 'Starting…' : 'Start assist'}
          </button>
        </div>
      </div>
    </div>
  );
}
