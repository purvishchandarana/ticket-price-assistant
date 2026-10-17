// "Open & watch": works for any event URL (District, Ticketmaster, …) without
// site-specific selectors. It only opens the event page in your Chrome, then
// watches for queues/challenges (pausing for you) and for checkout/payment
// pages (stopping immediately). It never clicks or types anything on the site.

import { looksLikeCheckoutUrl } from './common.js';

export const id = 'generic';
export const label = 'Open & watch (no auto-fill)';
export const handoffMessage =
  'The event page is open in Chrome. Choose tickets and seats yourself. I will flag queues and stop at checkout.';

export const matches = (event) => /^https?:\/\//i.test(event?.url ?? '');

export const isPaymentUrl = (url) => looksLikeCheckoutUrl(url);

export async function isAtPayment(page) {
  return isPaymentUrl(page.url());
}

export async function prepare(page, { event }, ctx) {
  await ctx.step('open-event', 'Open the event page', () => page.goto(event.url, { waitUntil: 'domcontentloaded' }));
}
