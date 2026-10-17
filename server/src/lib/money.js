// All price arithmetic is done in integer minor units (cents, pence, yen...)
// so totals never pick up floating-point drift.

const digitsCache = new Map();

/** Number of minor-unit digits for an ISO 4217 currency (USD → 2, JPY → 0). */
export function minorDigits(currency) {
  const code = String(currency || 'USD').toUpperCase();
  if (!digitsCache.has(code)) {
    let digits = 2;
    try {
      digits = new Intl.NumberFormat('en', { style: 'currency', currency: code })
        .resolvedOptions().maximumFractionDigits;
    } catch {
      // Unknown currency code: fall back to 2 decimals.
    }
    digitsCache.set(code, digits);
  }
  return digitsCache.get(code);
}

export function toMinor(amount, currency) {
  const scaled = amount * 10 ** minorDigits(currency);
  // toFixed first so values like 1.005 * 100 = 100.49999… round correctly.
  return Math.round(Number(scaled.toFixed(6)));
}

export function fromMinor(minor, currency) {
  return minor / 10 ** minorDigits(currency);
}

export function isAmount(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}
