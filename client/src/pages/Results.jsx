import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Badge, SaleStatusBadge } from '../components/Badges.jsx';
import PriceCell from '../components/PriceCell.jsx';
import StartAssistDialog from '../components/StartAssistDialog.jsx';
import { api } from '../lib/api.js';
import { formatEventDate, venueLine } from '../lib/format.js';

const CATEGORY_LABEL = { concerts: 'Music', comedy: 'Comedy', sports: 'Sports', theatre: 'Theatre' };

// Results arrive as best matches, then related events (each cheapest first).
const hasBoth = (results) => results.some((e) => e.match === 'best') && results.some((e) => e.match === 'related');

function groupHeading(results, i) {
  const startsGroup = i === 0 || results[i - 1].match !== results[i].match;
  if (!startsGroup || !hasBoth(results)) return null;
  return results[i].match === 'best' ? 'Best matches' : 'Related events';
}

function isCheapestOfGroup(results, i) {
  const startsGroup = i === 0 || results[i - 1].match !== results[i].match;
  return startsGroup && results[i].price?.total != null && (results[i].match === 'best' || !hasBoth(results));
}

export default function Results() {
  const [params] = useSearchParams();
  const qty = Number(params.get('qty') ?? 1);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [watched, setWatched] = useState(new Set());
  const [assistEvent, setAssistEvent] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    api.search(Object.fromEntries(params))
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) setError(e.message); });
    api.watchlist().then((list) => setWatched(new Set(list.map((w) => w.eventId)))).catch(() => {});
    return () => { cancelled = true; };
  }, [params]);

  async function watch(event) {
    try {
      await api.watch(event, qty);
      setWatched((s) => new Set(s).add(event.id));
    } catch (e) {
      alert(e.message);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <Link to="/" className="text-sm text-brand-600 hover:underline">← New search</Link>
          <h1 className="text-2xl font-bold tracking-tight">
            “{params.get('q')}” <span className="font-normal text-slate-500">{params.get('city') ? `· ${params.get('city')} ` : ''}· {qty} ticket{qty > 1 ? 's' : ''}</span>
          </h1>
        </div>
        <p className="text-sm text-slate-500">Best matches first, then cheapest total</p>
      </div>

      {error && <div className="card border-l-4 border-rose-500 text-rose-800">{error}</div>}

      {!data && !error && (
        <div className="card animate-pulse text-slate-600">
          Searching District, BookMyShow and other sources… Pages are fetched slowly and politely, so this can take 10–20 seconds.
          If Chrome shows a check, complete it there and the search will continue.
        </div>
      )}

      {data && (
        <>
          <div className="flex flex-wrap gap-2 text-sm">
            {data.sources.map((s) => (
              <span key={s.id} title={s.notice ?? ''} className={`rounded-full px-2.5 py-1 ring-1 ${!s.ok ? 'bg-rose-50 text-rose-800 ring-rose-200' : s.notice ? 'bg-amber-50 text-amber-900 ring-amber-200' : 'bg-white ring-slate-200'}`}>
                {s.name}: {s.ok ? `${s.count} result${s.count === 1 ? '' : 's'}` : s.error}{s.ok && s.notice ? ` (${s.notice})` : ''}
              </span>
            ))}
            {data.warnings.map((w) => <span key={w} className="rounded-full bg-amber-50 px-2.5 py-1 text-amber-900 ring-1 ring-amber-200">{w}</span>)}
          </div>

          {data.results.length === 0 ? (
            <div className="card text-slate-600">No matching upcoming events. Try fewer words or leave the city empty.</div>
          ) : (
            <div className="overflow-x-auto rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Event</th>
                    <th className="px-4 py-3">Source</th>
                    <th className="px-4 py-3">Total price</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.results.map((event, i) => [
                    groupHeading(data.results, i) && (
                      <tr key={`heading-${event.match}`} className="bg-slate-50">
                        <td colSpan={4} className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                          {groupHeading(data.results, i)}
                        </td>
                      </tr>
                    ),
                    <tr key={event.id} className="align-top">
                      <td className="max-w-sm px-4 py-3">
                        <div className="flex items-start gap-2">
                          {isCheapestOfGroup(data.results, i) && <span className="mt-0.5 rounded bg-emerald-600 px-1.5 text-[10px] font-bold uppercase text-white">Cheapest</span>}
                          <div>
                            <p className="font-semibold text-slate-900">{event.name}</p>
                            <p className="text-slate-600">{formatEventDate(event.start)}</p>
                            <p className="text-slate-500">{venueLine(event.venue) || 'Venue TBA'}</p>
                            <div className="mt-1 flex flex-wrap gap-1.5">
                              <SaleStatusBadge status={event.onSale?.status} />
                              {event.category && <Badge color="slate">{CATEGORY_LABEL[event.category] ?? event.category}</Badge>}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-700">{event.sourceName}</td>
                      <td className="px-4 py-3"><PriceCell price={event.price} /></td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col items-end gap-1.5">
                          <button className="btn-primary" onClick={() => setAssistEvent(event)} disabled={!event.url}>Start assist</button>
                          <button className="btn-secondary" onClick={() => watch(event)} disabled={watched.has(event.id)}>
                            {watched.has(event.id) ? '✓ Watching' : 'Watch'}
                          </button>
                          {event.url && <a href={event.url} target="_blank" rel="noreferrer" className="text-xs text-brand-600 hover:underline">Open on {event.sourceName} ↗</a>}
                        </div>
                      </td>
                    </tr>,
                  ])}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {assistEvent && <StartAssistDialog event={assistEvent} qty={qty} onClose={() => setAssistEvent(null)} />}
    </div>
  );
}
