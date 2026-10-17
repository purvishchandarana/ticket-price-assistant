// Adapter for the bundled demo site (demo-site/). Its markup is ours, so the
// selectors below are known, stable `data-testid` hooks.
//
// Flow: open event → set quantity → (optional) max-price filter → Find tickets
// → [queue / human check: session pauses for you] → seat map → YOUR TURN.
// Seats are always picked by you; the payment page stops everything.

export const id = 'demo';
export const label = 'DemoTix (local demo site)';
export const handoffMessage =
  'Your turn: pick your seats on the seat map in Chrome, then continue to checkout.';

export const matches = (event) => event?.source === 'demo';

export const isPaymentUrl = (url) => {
  try {
    return new URL(url).pathname.startsWith('/checkout/payment');
  } catch {
    return false;
  }
};

export async function isAtPayment(page) {
  if (isPaymentUrl(page.url())) return true;
  return (await page.locator('[data-testid="payment-step"]').count()) > 0;
}

export async function prepare(page, { event, qty, filters = {} }, ctx) {
  await ctx.step('open-event', 'Open the event page', () =>
    page.goto(event.url, { waitUntil: 'domcontentloaded' }));

  await ctx.step('set-quantity', `Set quantity to ${qty}`, () =>
    page.selectOption('[data-testid="qty"]', String(qty)));

  if (filters.maxPrice) {
    await ctx.step('filter-max-price', `Set max price to ₹${filters.maxPrice}`, () =>
      page.fill('[data-testid="max-price"]', String(filters.maxPrice)));
  }

  await ctx.step('find-tickets', 'Search for tickets', () =>
    page.click('[data-testid="find-tickets"]'));

  // Queues or human checks may appear here; the session pauses until they clear.
  await ctx.waitFor('seat-map', 'Wait for the seat map', async () =>
    (await page.locator('[data-testid="seat-map"]').count()) > 0);
}
