// Indian GST on event admission, as revised by GST 2.0 (effective 22 Sep 2025).
// Best-effort estimate for price comparison, not tax advice. The platform's
// checkout is the source of truth.
//
//   entertainment (concerts, theatre, comedy…)  ≤ ₹500/ticket exempt, else 18%
//   sport (recognised sporting events)           ≤ ₹500/ticket exempt, else 18%
//   premium-league (IPL and similar)             40%, no exemption
//   convenience / booking fees (a service)       18%

export const GST_EXEMPT_UP_TO_INR = 500;
export const GST_STANDARD_RATE = 0.18;
export const GST_PREMIUM_LEAGUE_RATE = 0.4;
export const GST_ON_FEES_RATE = 0.18;

// Leagues treated as "sporting events like IPL". Extend if the rules or
// your reading of them change.
const PREMIUM_LEAGUE_PATTERN = /\b(IPL|Indian Premier League)\b/i;

/** @typedef {'entertainment'|'sport'|'premium-league'} TaxClass */

/** Best-guess tax class from our category and the event name. */
export function inferTaxClass({ category, name = '' }) {
  if (category === 'sports') {
    return PREMIUM_LEAGUE_PATTERN.test(name) ? 'premium-league' : 'sport';
  }
  if (category === 'concerts' || category === 'theatre' || category === 'comedy') return 'entertainment';
  return null;
}

/**
 * GST rate on the admission (ticket) price, or null if it can't be determined.
 * @param {{taxClass: TaxClass|null, perTicketBase: number, currency: string}} ctx
 */
export function gstAdmissionRate({ taxClass, perTicketBase, currency }) {
  if (currency !== 'INR' || !taxClass) return null;
  if (taxClass === 'premium-league') return GST_PREMIUM_LEAGUE_RATE;
  return perTicketBase <= GST_EXEMPT_UP_TO_INR ? 0 : GST_STANDARD_RATE;
}
