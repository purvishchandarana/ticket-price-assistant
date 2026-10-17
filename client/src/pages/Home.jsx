import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import ChromeHelp from '../components/ChromeHelp.jsx';
import { api } from '../lib/api.js';

export default function Home() {
  const navigate = useNavigate();
  const [providers, setProviders] = useState([]);
  const [browser, setBrowser] = useState(null);
  const [q, setQ] = useState('');
  const [city, setCity] = useState('');
  const [qty, setQty] = useState(2);

  useEffect(() => {
    api.providers().then(setProviders).catch(() => {});
    const check = () => api.browser().then(setBrowser).catch(() => setBrowser({ reachable: false }));
    check();
    const timer = setInterval(check, 5000);
    return () => clearInterval(timer);
  }, []);

  function submit(e) {
    e.preventDefault();
    if (!q.trim()) return;
    const params = { q: q.trim(), qty: String(qty) };
    if (city.trim()) params.city = city.trim();
    navigate(`/results?${new URLSearchParams(params)}`);
  }

  return (
    <div className="mx-auto max-w-3xl">
      <section className="py-6 text-center">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">Find the cheapest total price</h1>
        <p className="mt-2 text-slate-600">Ticket price + convenience fee + GST, compared across District, BookMyShow and more. You stay in control of seats and payment.</p>
      </section>

      <form onSubmit={submit} className="card space-y-4">
        <div>
          <label htmlFor="q" className="text-sm font-semibold text-slate-700">Event, artist or team</label>
          <input
            id="q"
            className="field mt-2 py-3 text-base"
            placeholder="e.g. Parampara Navratri, Vivek Samtani, Bengaluru FC"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoFocus
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm font-semibold text-slate-700">City <span className="font-normal text-slate-400">(optional)</span>
            <input className="field mt-2" placeholder="e.g. Ahmedabad" value={city} onChange={(e) => setCity(e.target.value)} />
          </label>
          <label className="text-sm font-semibold text-slate-700">Tickets
            <select className="field mt-2" value={qty} onChange={(e) => setQty(Number(e.target.value))}>
              {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => <option key={n}>{n}</option>)}
            </select>
          </label>
        </div>

        <button className="btn-primary w-full py-2.5 text-base" disabled={!q.trim()}>Compare prices</button>
      </form>

      <div className="mt-4 space-y-3">
        {browser?.reachable && (
          <p className="text-center text-sm text-emerald-700">
            ● Chrome connected: BookMyShow and full District search are on. A helper tab opens in Chrome while searching.
          </p>
        )}
        {browser && !browser.reachable && (
          <ChromeHelp title="Start Chrome to include BookMyShow and complete District results">
            BookMyShow and District search run in your own Chrome (you complete any check they show). Start Chrome with remote debugging, using a dedicated profile:
          </ChromeHelp>
        )}
        <p className="flex flex-wrap justify-center gap-2 text-xs text-slate-500">
          Sources:
          {providers.map((p) => (
            <span key={p.id} className={p.configured ? 'text-slate-700' : 'line-through'} title={p.configured ? 'Enabled' : 'Not configured'}>
              {p.name}
            </span>
          ))}
        </p>
      </div>
    </div>
  );
}
