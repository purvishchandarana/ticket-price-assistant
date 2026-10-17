import { formatMoney } from '../lib/format.js';
import { ConfidenceBadge } from './Badges.jsx';

const SOURCE_LABEL = { reported: 'from source', included: 'included', estimated: 'estimated', unknown: 'not included' };

export default function PriceCell({ price }) {
  if (!price || price.total == null) {
    return (
      <div className="space-y-1">
        <span className="text-slate-500">No price published</span>
        <div><ConfidenceBadge confidence="none" /></div>
      </div>
    );
  }
  const people = price.qty === 1 ? '1 ticket' : `${price.qty} tickets`;
  return (
    <div className="space-y-1">
      <div className="flex items-baseline gap-2">
        <span className="text-lg font-semibold tabular-nums">{price.isEstimated ? '≈ ' : ''}{formatMoney(price.total, price.currency)}</span>
        <span className="text-xs text-slate-500">for {people}</span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <ConfidenceBadge confidence={price.confidence} />
        {price.isEstimated && <span className="text-xs text-slate-500">estimated</span>}
      </div>
      <details className="text-xs text-slate-600">
        <summary className="cursor-pointer select-none text-brand-600">Breakdown</summary>
        <dl className="mt-1 grid grid-cols-[auto_1fr_auto] gap-x-2 gap-y-0.5">
          <dt>Base</dt><dd className="text-right tabular-nums">{formatMoney(price.base, price.currency)}</dd><dd className="text-slate-400">{SOURCE_LABEL[price.components.base]}</dd>
          <dt>Fees</dt><dd className="text-right tabular-nums">{formatMoney(price.fees, price.currency)}</dd><dd className="text-slate-400">{SOURCE_LABEL[price.components.fees]}</dd>
          <dt>Taxes</dt><dd className="text-right tabular-nums">{formatMoney(price.taxes, price.currency)}</dd><dd className="text-slate-400">{SOURCE_LABEL[price.components.taxes]}</dd>
          <dt className="font-medium">Per ticket</dt><dd className="text-right font-medium tabular-nums">{formatMoney(price.perTicket, price.currency)}</dd><dd />
        </dl>
        {price.notes?.length > 0 && (
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-slate-500">
            {price.notes.map((n) => <li key={n}>{n}</li>)}
          </ul>
        )}
      </details>
    </div>
  );
}
