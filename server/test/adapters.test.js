import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { pickAdapter } from '../adapters/index.js';
import { datePill, prepare, showTimeLabel } from '../adapters/district.js';

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

  it('runs open → Book tickets → date → show, then stops for the user', async () => {
    const actions = [];
    const locatorFor = (name) => ({
      first: () => ({ click: async () => actions.push(`click ${name}`), waitFor: async () => {} }),
      filter: () => ({ count: async () => 1, first: () => ({ click: async () => actions.push(`click ${name} pill`) }) }),
      count: async () => 2,
      nth: (i) => ({ click: async () => actions.push(`click ${name} #${i}`) }),
      evaluateAll: async () => ['October 17 | 7PM - 9PM', 'October 17 | 10PM - October 18 | 2AM'],
    });
    const page = {
      goto: async (url) => actions.push(`goto ${url}`),
      waitForURL: async (re) => actions.push(`wait ${re.source}`),
      locator: (sel) => locatorFor(sel),
      getByRole: (_role, { name }) => locatorFor(String(name)),
    };
    const ctx = { step: async (_id, _label, fn) => fn() };
    const event = {
      url: 'https://www.district.in/events/kirtidaan-gadhvi-2026-buy-tickets',
      start: { localDate: '2026-10-17', localTime: '22:00:00' },
    };
    await prepare(page, { event }, ctx);
    assert.deepEqual(actions, [
      'goto https://www.district.in/events/kirtidaan-gadhvi-2026-buy-tickets',
      'click button[aria-label="Book tickets"]',
      'wait \\/buy-page\\/',
      'click li pill',
      'click /^book$/i #1', // the 10PM show, not the 7PM one
      'wait \\/buy-page\\/shows\\/[^/]+',
    ]);
  });
});
