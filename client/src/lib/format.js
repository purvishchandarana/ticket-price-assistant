export function formatMoney(amount, currency = 'INR') {
  if (amount == null) return '—';
  try {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency,
      maximumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount}`;
  }
}

export function formatMinor(minor, currency = 'INR') {
  if (minor == null) return '—';
  const digits = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits;
  return formatMoney(minor / 10 ** digits, currency);
}

/** Event start in its own timezone, e.g. "Sat, 12 Dec 2026, 7:30 pm". */
export function formatEventDate(start) {
  if (!start) return 'Date TBA';
  if (start.dateTime) {
    return new Intl.DateTimeFormat('en-IN', {
      weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit',
      timeZone: start.timezone || 'Asia/Kolkata',
    }).format(new Date(start.dateTime));
  }
  if (start.localDate) {
    const [y, m, d] = start.localDate.split('-').map(Number);
    const date = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
      .format(new Date(Date.UTC(y, m - 1, d)));
    return start.localTime ? `${date}, ${start.localTime.slice(0, 5)}` : date;
  }
  return 'Date TBA';
}

export function formatRelative(iso) {
  if (!iso) return 'never';
  const seconds = Math.round((Date.now() - Date.parse(iso)) / 1000);
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  if (Math.abs(seconds) < 60) return rtf.format(-seconds, 'second');
  if (Math.abs(seconds) < 3600) return rtf.format(-Math.round(seconds / 60), 'minute');
  if (Math.abs(seconds) < 86400) return rtf.format(-Math.round(seconds / 3600), 'hour');
  return rtf.format(-Math.round(seconds / 86400), 'day');
}

export const venueLine = (venue) => [venue?.name, venue?.city].filter(Boolean).join(', ');
