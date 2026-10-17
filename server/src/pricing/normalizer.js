import { fromMinor, isAmount, toMinor } from '../lib/money.js';
import { FEE_MODELS } from './feeModels.js';

/**
 * @typedef {object} PriceInput  What a provider knows about a price (per ticket).
 * @property {string}  currency        ISO 4217 code
 * @property {number}  base            per-ticket base/face price
 * @property {number}  [fees]          per-ticket fees, if the source reports them
 * @property {number}  [orderFees]     per-order fees, if the source reports them
 * @property {number}  [taxes]         per-ticket taxes, if the source reports them
 * @property {boolean} [includesFees]  `base` is already fee-inclusive ("all-in")
 * @property {boolean} [includesTaxes] `base` already includes taxes
 * @property {'exact'|'range-min'} [priceKind]  'range-min' = lowest of a published
 *           range ("from $X"), not a specific seat that is known to be available
 * @property {import('./gst.js').TaxClass|null} [taxClass]  for slab-based tax models (GST)
 *
 * @typedef {'reported'|'included'|'estimated'|'unknown'} ComponentSource
 * @typedef {'high'|'medium'|'low'|'none'} Confidence
 *
 * @typedef {object} PriceQuote  Normalized total for `qty` tickets.
 * @property {string|null} currency
 * @property {number} qty
 * @property {number|null} base        base total for qty tickets
 * @property {number|null} fees        all fees (per-ticket × qty + per-order)
 * @property {number|null} taxes
 * @property {number|null} total
 * @property {number|null} perTicket   total / qty
 * @property {number|null} totalMinor  total in minor units, for exact sorting
 * @property {boolean} isEstimated     true unless every component is known
 * @property {Confidence} confidence
 * @property {{base: ComponentSource, fees: ComponentSource, taxes: ComponentSource}} components
 * @property {string[]} notes          human-readable caveats for the UI
 */

export const CONFIDENCE_LEVELS = ['none', 'low', 'medium', 'high'];

function emptyQuote(currency, qty) {
  return {
    currency: currency ? String(currency).toUpperCase() : null,
    qty,
    base: null,
    fees: null,
    taxes: null,
    total: null,
    perTicket: null,
    totalMinor: null,
    isEstimated: true,
    confidence: 'none',
    components: { base: 'unknown', fees: 'unknown', taxes: 'unknown' },
    notes: ['No price published by this source. Check the site for prices.'],
  };
}

/**
 * Convert a provider's partial price info into a total for `qty` tickets.
 *
 * Confidence:
 *   high   base, fees and taxes are all reported (or included in base)
 *   medium fees known, but taxes estimated or unknown; also the cap for 'range-min'
 *   low    fees had to be estimated from a fee model
 *   none   no usable base price
 *
 * @param {PriceInput|null} input
 * @param {{qty?: number, feeModel?: object}} [options]
 * @returns {PriceQuote}
 */
export function normalizePrice(input, { qty = 1, feeModel = FEE_MODELS.default } = {}) {
  if (!Number.isInteger(qty) || qty < 1) {
    throw new RangeError(`qty must be a positive integer, got ${qty}`);
  }
  if (!input || !isAmount(input.base)) return emptyQuote(input?.currency, qty);

  const currency = String(input.currency || 'USD').toUpperCase();
  const m = (amount) => toMinor(amount, currency);
  const notes = [];

  const baseEach = m(input.base);
  const baseTotal = baseEach * qty;

  // --- Fees ---
  let feesSource;
  let feeEach = 0;
  let orderFee = 0;
  if (input.includesFees) {
    feesSource = 'included';
  } else if (isAmount(input.fees)) {
    feesSource = 'reported';
    feeEach = m(input.fees);
    orderFee = isAmount(input.orderFees) ? m(input.orderFees) : 0;
  } else {
    feesSource = 'estimated';
    feeEach = Math.round(baseEach * (feeModel.perTicketPct ?? 0)) + m(feeModel.perTicketFixed ?? 0);
    orderFee = m(feeModel.perOrderFixed ?? 0);
    notes.push(`Fees estimated (${feeModel.label}). Actual fees are shown at checkout.`);
  }
  const feesTotal = feeEach * qty + orderFee;

  // --- Taxes ---
  const taxContext = { taxClass: input.taxClass ?? null, perTicketBase: input.base, currency };
  const taxRate = typeof feeModel.taxPct === 'function' ? feeModel.taxPct(taxContext) : feeModel.taxPct;
  let taxesSource;
  let taxesTotal = 0;
  if (input.includesTaxes) {
    taxesSource = 'included';
  } else if (isAmount(input.taxes)) {
    taxesSource = 'reported';
    taxesTotal = m(input.taxes) * qty;
  } else if (isAmount(taxRate)) {
    taxesSource = 'estimated';
    const feeTaxRate = isAmount(feeModel.feeTaxPct)
      ? feeModel.feeTaxPct
      : (feeModel.taxAppliesToFees ? taxRate : 0);
    taxesTotal = Math.round(baseTotal * taxRate) + Math.round(feesTotal * feeTaxRate);
    notes.push(feeModel.taxLabel ? `Taxes estimated (${feeModel.taxLabel}).` : 'Taxes estimated.');
  } else {
    taxesSource = 'unknown';
    notes.push('Excludes taxes, which are calculated at checkout.');
  }

  // --- Confidence ---
  let confidence;
  if (feesSource === 'estimated') confidence = 'low';
  else if (taxesSource === 'estimated' || taxesSource === 'unknown') confidence = 'medium';
  else confidence = 'high';

  if (input.priceKind === 'range-min') {
    if (confidence === 'high') confidence = 'medium';
    notes.push('Lowest price in the published range. Seats at this price may be sold out.');
  }

  const total = baseTotal + feesTotal + taxesTotal;
  return {
    currency,
    qty,
    base: fromMinor(baseTotal, currency),
    fees: fromMinor(feesTotal, currency),
    taxes: fromMinor(taxesTotal, currency),
    total: fromMinor(total, currency),
    perTicket: fromMinor(Math.round(total / qty), currency),
    totalMinor: total,
    isEstimated: confidence !== 'high',
    confidence,
    components: { base: 'reported', fees: feesSource, taxes: taxesSource },
    notes,
  };
}

/**
 * Sort cheapest total first. Prices can't be compared across currencies without
 * FX rates, so items are grouped: preferred currency first, then other currencies
 * (alphabetical), then unpriced items. Ties go to the higher-confidence quote.
 */
export function sortByTotal(items, { preferredCurrency, getQuote = (item) => item.price } = {}) {
  const pref = preferredCurrency?.toUpperCase();
  const group = (q) => {
    if (!q || q.totalMinor == null) return 2;
    return pref && q.currency !== pref ? 1 : 0;
  };

  return [...items].sort((a, b) => {
    const qa = getQuote(a);
    const qb = getQuote(b);
    const byGroup = group(qa) - group(qb);
    if (byGroup !== 0) return byGroup;
    if (group(qa) === 2) return 0;
    if (qa.currency !== qb.currency) return qa.currency.localeCompare(qb.currency);
    if (qa.totalMinor !== qb.totalMinor) return qa.totalMinor - qb.totalMinor;
    return CONFIDENCE_LEVELS.indexOf(qb.confidence) - CONFIDENCE_LEVELS.indexOf(qa.confidence);
  });
}
