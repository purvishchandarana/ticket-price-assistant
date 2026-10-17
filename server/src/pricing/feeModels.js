// Fee models are used ONLY when a source does not report fees up front.
// They are rough placeholders, not published rates. Real fees vary by venue,
// event and market. Tune them once you've seen a few real checkouts; the
// normalizer will still flag every price that uses them as "estimated".
//
// Fields (all amounts are in the event's own currency):
//   perTicketPct     service fee as a fraction of base price (0.18 = 18%)
//   perTicketFixed   flat per-ticket charge (e.g. facility fee)
//   perOrderFixed    flat per-order charge (e.g. order processing)
//   taxPct           tax fraction on the base price, or null if unknown (taxes
//                    then excluded). May be a function of
//                    { taxClass, perTicketBase, currency } for slab-based taxes.
//   taxLabel         shown in the "Taxes estimated (…)" note
//   taxAppliesToFees whether tax is charged on fees at the same rate as base
//   feeTaxPct        tax fraction on fees; overrides taxAppliesToFees if set

import { GST_ON_FEES_RATE, gstAdmissionRate } from './gst.js';

export const FEE_MODELS = {
  default: {
    label: 'generic marketplace estimate',
    perTicketPct: 0.2,
    perTicketFixed: 0,
    perOrderFixed: 0,
    taxPct: null,
    taxAppliesToFees: true,
  },
  ticketmaster: {
    label: 'typical Ticketmaster fees, rough estimate',
    perTicketPct: 0.18,
    perTicketFixed: 2.5,
    perOrderFixed: 3.5,
    taxPct: null,
    taxAppliesToFees: true,
  },
  // Indian platforms (BookMyShow, District…) add a "convenience fee" at checkout,
  // with 18% GST charged on that fee. The 10% here is a placeholder.
  india: {
    label: 'typical Indian platform convenience fee, rough estimate',
    perTicketPct: 0.1,
    perTicketFixed: 0,
    perOrderFixed: 0,
    taxPct: gstAdmissionRate,
    taxLabel: 'GST at 22 Sep 2025 rates',
    feeTaxPct: GST_ON_FEES_RATE,
  },
  // BookMyShow: listed ticket prices already include GST; the convenience fee
  // (plus 18% GST on it) is added at checkout. The 10% is a placeholder.
  bookmyshow: {
    label: 'typical BookMyShow convenience fee, rough estimate',
    perTicketPct: 0.1,
    perTicketFixed: 0,
    perOrderFixed: 0,
    taxPct: gstAdmissionRate,
    taxLabel: 'GST on the convenience fee',
    feeTaxPct: GST_ON_FEES_RATE,
  },
};

export function getFeeModel(source) {
  return FEE_MODELS[source] ?? FEE_MODELS.default;
}
