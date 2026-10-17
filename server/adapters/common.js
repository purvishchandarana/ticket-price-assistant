// Shared helpers for site adapters.
//
// Adapter contract (one file per site in this folder):
//   id, label                      identifiers shown in the UI
//   matches(event) -> boolean      can this adapter handle the event?
//   prepare(page, {event, qty, filters}, ctx)
//       Navigate and pre-fill using ctx.step(id, label, fn) and
//       ctx.waitFor(id, label, predicate). Steps are skipped on resume once done.
//       MUST stop before seat selection and never touch payment fields.
//   isAtPayment(page) -> Promise<boolean>
//   isPaymentUrl(url) -> boolean   optional fast check used to stop instantly
//   handoffMessage                 optional text shown when it's the user's turn

/** Path segments that indicate checkout or payment. Stopping early is the safe side. */
export const CHECKOUT_PATH_PATTERN = /(^|[/._-])(checkout|payment|payments|pay|billing)([/._-]|$)/i;

export function looksLikeCheckoutUrl(url) {
  try {
    return CHECKOUT_PATH_PATTERN.test(new URL(url).pathname);
  } catch {
    return false;
  }
}
