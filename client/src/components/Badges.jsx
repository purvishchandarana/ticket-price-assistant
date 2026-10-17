const tone = {
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  amber: 'bg-amber-50 text-amber-800 ring-amber-600/25',
  red: 'bg-rose-50 text-rose-700 ring-rose-600/20',
  blue: 'bg-sky-50 text-sky-700 ring-sky-600/20',
  violet: 'bg-brand-50 text-brand-700 ring-brand-600/20',
  slate: 'bg-slate-100 text-slate-600 ring-slate-500/20',
};

export function Badge({ color = 'slate', children, title }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${tone[color]}`}>
      {children}
    </span>
  );
}

const SALE = {
  onsale: ['green', 'On sale'],
  scheduled: ['blue', 'Sale scheduled'],
  offsale: ['slate', 'Off sale'],
  soldout: ['red', 'Sold out'],
  cancelled: ['red', 'Cancelled'],
  postponed: ['amber', 'Postponed'],
  rescheduled: ['amber', 'Rescheduled'],
  unknown: ['slate', 'Unknown'],
};

export function SaleStatusBadge({ status }) {
  const [color, label] = SALE[status] ?? SALE.unknown;
  return <Badge color={color}>{label}</Badge>;
}

const CONFIDENCE = {
  high: ['green', 'High confidence', 'Base, fees and taxes all come from the source.'],
  medium: ['amber', 'Medium confidence', 'Some taxes are estimated, or this is a "from" price.'],
  low: ['red', 'Low confidence', 'Fees are not published; they are estimated.'],
  none: ['slate', 'No price', 'The source publishes no price.'],
};

export function ConfidenceBadge({ confidence }) {
  const [color, label, title] = CONFIDENCE[confidence] ?? CONFIDENCE.none;
  return <Badge color={color} title={title}>{label}</Badge>;
}

const SESSION = {
  starting: ['blue', 'Starting'],
  running: ['violet', 'Running'],
  paused: ['amber', 'Paused'],
  your_turn: ['blue', 'Your turn'],
  at_payment: ['green', 'At payment'],
  stopped: ['slate', 'Stopped'],
  error: ['red', 'Error'],
  interrupted: ['amber', 'Interrupted'],
};

export function SessionChip({ status }) {
  const [color, label] = SESSION[status] ?? ['slate', status];
  return (
    <Badge color={color}>
      {status === 'running' && <span className="size-1.5 animate-pulse rounded-full bg-current" />}
      {label}
    </Badge>
  );
}
