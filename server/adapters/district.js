// District (district.in) booking adapter.
//
// Verified on the live site (Oct 2026), up to the ticket quantity:
//   1. Event page: "Book tickets" button (accessible name) → /buy-page/shows
//   2. Shows page: date pills (<li> "17 Sat") and one "BOOK" button per show
//      time → /buy-page/shows/<showId>
//   3. Zone map: SVG `g.section-seatmap` per stand (data-id "Gold"), plus
//      "Filter stands by" price buttons ("₹1099") listing available prices.
//      A filter leaves the class only on the stands at that price. Each stand
//      has its own page: /buy-page/shows/<showId>/<standId>.
//   4. Stand page ("Choose tickets"): one card per ticket type. Available ones
//      have a <button> "ADD"; sold-out ones don't. ADD turns into a stepper
//      <div><span>−</span><p>1</p><span>+</span></div>.
// We pick the cheapest stand and ticket type, set the quantity and hand over
// before "Add to cart". Checkout/payment pages always stop automation.

import { looksLikeCheckoutUrl } from './common.js';

export const id = 'district';
export const label = 'District (date & show pre-fill)';
export const handoffMessage =
  'Your turn: check the stand, ticket type and quantity in Chrome (change them if you like), then click "Add to cart" and continue. I will stop at payment.';

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

const STAND_PAGE = /\/buy-page\/shows\/[^/]+\/[^/?#]+/;
const STEPPER = 'div:has(> span:first-child + p + span:last-child)';

/** "₹1,099" → 1099; null when there is no rupee amount. */
export function parseRupees(text) {
  const m = /₹\s*([\d,]+(?:\.\d+)?)/.exec(text ?? '');
  return m ? Number(m[1].replace(/,/g, '')) : null;
}

/** Index of the lowest price (nulls ignored), or -1. */
export function cheapestIndex(prices) {
  let best = -1;
  prices.forEach((price, i) => {
    if (price !== null && (best < 0 || price < prices[best])) best = i;
  });
  return best;
}

/** /buy-page/shows/<showId>[?…] + stand → /buy-page/shows/<showId>/<stand>. */
export function standUrl(showUrl, standId) {
  const url = new URL(showUrl);
  url.search = '';
  url.hash = '';
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/${encodeURIComponent(standId)}`;
  return url.toString();
}

export async function prepare(page, { event, qty, filters = {} }, ctx) {
  const { maxPrice } = filters;
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

  // Steps below read the page instead of local flags, so a resumed session
  // (earlier steps skipped) still knows where it is.
  await ctx.step('pick-stand', 'Choose the cheapest stand', async () => {
    const hasMap = await page.locator('g.section-seatmap').first()
      .waitFor({ state: 'attached', timeout: 15_000 }).then(() => true, () => false);
    if (!hasMap) return ctx.log?.('No stand map on this show; leaving the ticket choice to you.');

    const priceFilters = page.getByRole('button', { name: /^₹\s?[\d,]+$/ });
    const cheapest = cheapestIndex((await priceFilters.allInnerTexts()).map(parseRupees));
    if (cheapest >= 0) {
      await priceFilters.nth(cheapest).click();
      await page.waitForTimeout(500); // let the map re-render with the filter
    }
    const stands = await page.locator('g.section-seatmap')
      .evaluateAll((els) => els.map((g) => g.getAttribute('data-id') || g.id).filter(Boolean));
    // Without a price filter we can't tell stands apart by price.
    if (stands.length === 0 || (cheapest < 0 && stands.length > 1)) {
      return ctx.log?.('Could not tell which stand is cheapest; leaving the choice to you.');
    }
    await page.goto(standUrl(page.url(), stands[0]), { waitUntil: 'domcontentloaded' });
  });
  if (!STAND_PAGE.test(page.url())) return;

  await ctx.step('pick-ticket', 'Add the cheapest available ticket type', async () => {
    // Only available ticket types have a real "ADD" button.
    const addButtons = page.getByRole('button', { name: /^add$/i });
    await addButtons.first().waitFor({ state: 'visible', timeout: 20_000 }).catch(() => {});
    const cards = await addButtons.evaluateAll((els) => els.map((b) => {
      let card = b.parentElement;
      for (let i = 0; i < 4 && card && !/₹/.test(card.innerText); i++) card = card.parentElement;
      return card?.innerText ?? '';
    }));
    const best = cheapestIndex(cards.map(parseRupees));
    if (best < 0) return ctx.log?.('No ticket type is available in this stand; leaving the choice to you.');
    const price = parseRupees(cards[best]);
    if (maxPrice && price > maxPrice) {
      return ctx.log?.(`The cheapest ticket here is ₹${price}, above your ₹${maxPrice} limit; leaving the choice to you.`);
    }
    await addButtons.nth(best).click();
  });

  // ADD turns into a "− 1 +" stepper.
  const stepper = page.locator(STEPPER).first();
  if (!await stepper.waitFor({ state: 'visible', timeout: 10_000 }).then(() => true, () => false)) return;

  const wanted = Math.max(1, Math.floor(Number(qty)) || 1);
  if (wanted > 1) {
    await ctx.step('set-quantity', `Set quantity to ${wanted}`, async () => {
      const count = async () => Number(await stepper.locator(':scope > p').innerText()) || 0;
      for (let current = await count(); current < wanted;) {
        await stepper.locator(':scope > span').last().click();
        const next = await count();
        if (next <= current) { // the site's per-order limit
          ctx.log?.(`District allows at most ${current} ticket(s) here.`);
          break;
        }
        current = next;
      }
    });
  }
}
