import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { pickAdapter } from '../adapters/index.js';
import {
  cheapestIndex, datePill, parseRupees, prepare, showTimeLabel, standUrl,
} from '../adapters/district.js';

describe('adapter selection', () => {
  it('routes events to the most specific adapter', () => {
    assert.equal(pickAdapter({ source: 'demo', url: 'http://127.0.0.1:4100/events/x' }).id, 'demo');
    assert.equal(pickAdapter({ source: 'district', url: 'https://www.district.in/events/x-buy-tickets' }).id, 'district');
    assert.equal(pickAdapter({ source: 'bookmyshow', url: 'https://in.bookmyshow.com/events/x/ET1' }).id, 'generic');
    assert.equal(pickAdapter({ source: 'x' }), null);
  });
});

describe('District adapter helpers', () => {
  it('formats date pills and show times the way District does', () => {
    assert.deepEqual(datePill('2026-10-17'), { day: 17, weekday: 'Sat' });
    assert.equal(datePill(null), null);
    assert.equal(showTimeLabel('22:00:00'), '10PM');
    assert.equal(showTimeLabel('19:30:00'), '7:30PM');
    assert.equal(showTimeLabel('00:15:00'), '12:15AM');
  });

  it('parses rupee amounts and finds the cheapest', () => {
    assert.equal(parseRupees('₹1,099'), 1099);
    assert.equal(parseRupees('Phase 3 | Gold\n₹1,499\nADD'), 1499);
    assert.equal(parseRupees('ADD'), null);
    assert.equal(cheapestIndex([2499, null, 1099, 1499]), 2);
    assert.equal(cheapestIndex([null]), -1);
    assert.equal(
      standUrl('https://www.district.in/events/x/buy-page/shows/abc?y=1', 'Gold Stand'),
      'https://www.district.in/events/x/buy-page/shows/abc/Gold%20Stand',
    );
  });

  /**
   * A fake of District's booking pages, recording what the adapter does.
   * `standTickets` are the stand page's available ticket cards (sold-out ones
   * have no ADD button); `maxQty` is the site's per-order limit.
   */
  function fakeDistrict({ standTickets = ['Phase 3 | Gold\n₹1,099'], maxQty = 10, hasMap = true } = {}) {
    const actions = [];
    let url = 'about:blank';
    let qty = 0;
    let filtered = false;
    const SHOW = 'https://www.district.in/events/kirtidaan-gadhvi-2026/buy-page/shows/s1';
    const visible = (ok) => async () => { if (!ok()) throw new Error('timeout'); };
    const locators = {
      'button[aria-label="Book tickets"]': {
        first: () => ({ click: async () => { actions.push('click Book tickets'); url = `${SHOW.slice(0, -3)}`; } }),
      },
      li: { filter: () => ({ count: async () => 1, first: () => ({ click: async () => actions.push('click date pill') }) }) },
      'g.section-seatmap': {
        first: () => ({ waitFor: visible(() => hasMap) }),
        evaluateAll: async () => (filtered ? ['Gold'] : ['Diamond', 'Gold', 'Fanpit']),
      },
      'div:has(> span:first-child + p + span:last-child)': {
        first: () => ({
          waitFor: visible(() => qty > 0),
          locator: (sel) => (sel === ':scope > p'
            ? { innerText: async () => String(qty) }
            : { last: () => ({ click: async () => { actions.push('click +'); qty = Math.min(qty + 1, maxQty); } }) }),
        }),
      },
    };
    const roles = {
      '/^book$/i': {
        first: () => ({ waitFor: async () => {} }),
        count: async () => 2,
        evaluateAll: async () => ['October 17 | 7PM - 9PM', 'October 17 | 10PM - October 18 | 2AM'],
        nth: (i) => ({ click: async () => { actions.push(`click BOOK #${i}`); url = SHOW; } }),
      },
      '/^₹\\s?[\\d,]+$/': {
        allInnerTexts: async () => ['₹1499', '₹1099', '₹2499'],
        nth: (i) => ({ click: async () => { actions.push(`click price filter #${i}`); filtered = true; } }),
      },
      '/^add$/i': {
        first: () => ({ waitFor: async () => {} }),
        evaluateAll: async () => standTickets,
        nth: (i) => ({ click: async () => { actions.push(`click ADD #${i}`); qty = 1; } }),
      },
    };
    const page = {
      url: () => url,
      goto: async (to) => { actions.push(`goto ${to}`); url = to; },
      waitForURL: async (re) => actions.push(`wait ${re.source}`),
      waitForTimeout: async () => {},
      locator: (sel) => locators[sel],
      getByRole: (_role, { name }) => roles[String(name)],
    };
    return { page, actions };
  }

  const event = {
    url: 'https://www.district.in/events/kirtidaan-gadhvi-2026-buy-tickets',
    start: { localDate: '2026-10-17', localTime: '22:00:00' },
  };
  const ctx = (logs = []) => ({ step: async (_id, _label, fn) => fn(), log: (m) => logs.push(m) });

  it('books the cheapest stand and ticket type for the quantity, then stops before Add to cart', async () => {
    const { page, actions } = fakeDistrict({
      standTickets: ['Phase 3 | Gold\n₹1,099', 'Phase 4 | Gold\n₹1,199'],
    });
    await prepare(page, { event, qty: 3 }, ctx());
    assert.deepEqual(actions, [
      'goto https://www.district.in/events/kirtidaan-gadhvi-2026-buy-tickets',
      'click Book tickets',
      'wait \\/buy-page\\/',
      'click date pill',
      'click BOOK #1', // the 10PM show, not the 7PM one
      'wait \\/buy-page\\/shows\\/[^/]+',
      'click price filter #1', // ₹1099
      'goto https://www.district.in/events/kirtidaan-gadhvi-2026/buy-page/shows/s1/Gold',
      'click ADD #0',
      'click +',
      'click +',
    ]);
  });

  it('stops at the site limit and respects the max price', async () => {
    const limited = fakeDistrict({ maxQty: 2 });
    const logs = [];
    await prepare(limited.page, { event, qty: 5 }, ctx(logs));
    assert.equal(limited.actions.filter((a) => a === 'click +').length, 2); // 1→2, then no change
    assert.match(logs.at(-1), /at most 2/);

    const pricey = fakeDistrict();
    const priceyLogs = [];
    await prepare(pricey.page, { event, qty: 2, filters: { maxPrice: 1000 } }, ctx(priceyLogs));
    assert.ok(!pricey.actions.some((a) => a.startsWith('click ADD')));
    assert.match(priceyLogs.at(-1), /above your ₹1000 limit/);
  });

  it('hands over at the show page when there is no stand map', async () => {
    const { page, actions } = fakeDistrict({ hasMap: false });
    await prepare(page, { event, qty: 2 }, ctx());
    assert.equal(actions.at(-1), 'wait \\/buy-page\\/shows\\/[^/]+');
  });
});
