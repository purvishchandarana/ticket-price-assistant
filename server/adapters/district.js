// District (district.in) booking adapter.
//
// Verified on the live site (Oct 2026), up to the zone map:
//   1. Event page: "Book tickets" button (accessible name) → /buy-page/shows
//   2. Shows page: date pills (<li> "17 Sat") and one "BOOK" button per show
//      time → /buy-page/shows/<showId>
//   3. Zone map / ticket selection: NOT automated yet (selectors not verified).
//      The session hands over here; the user picks zone, tickets and continues.
// Checkout/payment pages always stop automation (generic URL check).

import { looksLikeCheckoutUrl } from './common.js';

export const id = 'district';
export const label = 'District (date & show pre-fill)';
export const handoffMessage =
  'Your turn: pick your stand / ticket type and quantity in Chrome, then continue to checkout. I will stop at payment.';

export const matches = (event) => event?.source === 'district' && /^https:\/\/www\.district\.in\/events\//.test(event.url ?? '');

export const isPaymentUrl = (url) => looksLikeCheckoutUrl(url);

export async function isAtPayment(page) {
  return isPaymentUrl(page.url());
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "2026-10-17" → { day: 17, weekday: "Sat" } (calendar date, no timezone shift). */
export function datePill(localDate) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDate ?? '');
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return { day: d.getUTCDate(), weekday: WEEKDAYS[d.getUTCDay()] };
}

/** "22:00:00" → "10PM", "19:30:00" → "7:30PM" (District's show-row format). */
export function showTimeLabel(localTime) {
  const m = /^(\d{2}):(\d{2})/.exec(localTime ?? '');
  if (!m) return null;
  const h = Number(m[1]);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${m[2] === '00' ? '' : `:${m[2]}`}${suffix}`;
}

export async function prepare(page, { event }, ctx) {
  await ctx.step('open-event', 'Open the event page', () =>
    page.goto(event.url, { waitUntil: 'domcontentloaded' }));

  await ctx.step('book', 'Click "Book tickets"', async () => {
    await page.locator('button[aria-label="Book tickets"]').first().click();
    await page.waitForURL(/\/buy-page\//, { timeout: 20_000 });
  });

  // Multi-date events show date pills; single-show events may skip them.
  const pill = datePill(event.start?.localDate);
  if (pill) {
    await ctx.step('pick-date', `Pick ${pill.weekday} ${pill.day}`, async () => {
      const pills = page.locator('li').filter({ hasText: new RegExp(`^\\s*${pill.day}\\s*${pill.weekday}\\s*$`) });
      if (await pills.count() > 0) await pills.first().click();
    });
  }

  const timeLabel = showTimeLabel(event.start?.localTime);
  await ctx.step('pick-show', `Choose the ${timeLabel ?? ''} show`.replace('  ', ' '), async () => {
    const buttons = page.getByRole('button', { name: /^book$/i });
    await buttons.first().waitFor({ state: 'visible', timeout: 20_000 });
    let index = 0;
    if (timeLabel && await buttons.count() > 1) {
      // Pick the BOOK button whose show row mentions the event's start time.
      const rows = await buttons.evaluateAll((els) => els.map((b) => {
        let row = b.parentElement;
        for (let i = 0; i < 4 && row && !/\d(AM|PM)/i.test(row.innerText); i++) row = row.parentElement;
        return row?.innerText ?? '';
      }));
      const found = rows.findIndex((text) => text.replace(/\s+/g, '').toUpperCase().includes(timeLabel));
      if (found >= 0) index = found;
    }
    await buttons.nth(index).click();
    await page.waitForURL(/\/buy-page\/shows\/[^/]+/, { timeout: 20_000 });
  });
}
