import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FEE_MODELS } from '../src/pricing/feeModels.js';
import { normalizePrice, sortByTotal } from '../src/pricing/normalizer.js';

describe('normalizePrice', () => {
  it('sums fully reported components with high confidence', () => {
    const q = normalizePrice(
      { currency: 'usd', base: 50, fees: 12.5, orderFees: 4, taxes: 3.1 },
      { qty: 2 },
    );
    assert.equal(q.currency, 'USD');
    assert.equal(q.base, 100);
    assert.equal(q.fees, 29); // 12.50 × 2 + 4.00
    assert.equal(q.taxes, 6.2);
    assert.equal(q.total, 135.2);
    assert.equal(q.perTicket, 67.6);
    assert.equal(q.totalMinor, 13520);
    assert.equal(q.confidence, 'high');
    assert.equal(q.isEstimated, false);
    assert.deepEqual(q.components, { base: 'reported', fees: 'reported', taxes: 'reported' });
    assert.deepEqual(q.notes, []);
  });

  it('estimates fees from the fee model when not reported, with low confidence', () => {
    const q = normalizePrice({ currency: 'USD', base: 65 }, { qty: 2, feeModel: FEE_MODELS.ticketmaster });
    // per ticket: 65 × 18% = 11.70 + 2.50 fixed = 14.20; × 2 + 3.50 order fee = 31.90
    assert.equal(q.fees, 31.9);
    assert.equal(q.total, 161.9);
    assert.equal(q.confidence, 'low');
    assert.equal(q.isEstimated, true);
    assert.equal(q.components.fees, 'estimated');
    assert.equal(q.components.taxes, 'unknown');
    assert.ok(q.notes.some((n) => n.includes('Fees estimated')));
    assert.ok(q.notes.some((n) => n.includes('Excludes taxes')));
  });

  it('treats an all-in price as fees included, medium confidence when taxes are unknown', () => {
    const q = normalizePrice({ currency: 'USD', base: 89.5, includesFees: true }, { qty: 2 });
    assert.equal(q.total, 179);
    assert.equal(q.fees, 0);
    assert.equal(q.components.fees, 'included');
    assert.equal(q.confidence, 'medium');
    assert.equal(q.isEstimated, true);
  });

  it('caps range-minimum prices at medium confidence', () => {
    const q = normalizePrice({
      currency: 'USD', base: 40, includesFees: true, includesTaxes: true, priceKind: 'range-min',
    });
    assert.equal(q.total, 40);
    assert.equal(q.confidence, 'medium');
    assert.ok(q.notes.some((n) => n.includes('Lowest price')));
  });

  it('estimates taxes when the fee model has a tax rate', () => {
    const model = { label: 'test', perTicketPct: 0.1, perTicketFixed: 0, perOrderFixed: 2, taxPct: 0.08, taxAppliesToFees: true };
    const withFeesTaxed = normalizePrice({ currency: 'USD', base: 100 }, { feeModel: model });
    // fees 10 + 2 = 12; tax 8% of 112 = 8.96
    assert.equal(withFeesTaxed.taxes, 8.96);
    assert.equal(withFeesTaxed.total, 120.96);
    assert.equal(withFeesTaxed.components.taxes, 'estimated');

    const baseOnlyTaxed = normalizePrice({ currency: 'USD', base: 100 }, { feeModel: { ...model, taxAppliesToFees: false } });
    assert.equal(baseOnlyTaxed.taxes, 8);
    assert.equal(baseOnlyTaxed.total, 120);
  });

  it('avoids floating-point drift', () => {
    const q = normalizePrice({ currency: 'USD', base: 0.1, fees: 0.2, includesTaxes: true }, { qty: 3 });
    assert.equal(q.total, 0.9); // naive float math gives 0.9000000000000001
    assert.equal(q.totalMinor, 90);
  });

  it('respects zero-decimal currencies', () => {
    const q = normalizePrice({ currency: 'JPY', base: 8800 }, { feeModel: FEE_MODELS.default });
    assert.equal(q.fees, 1760);
    assert.equal(q.total, 10560);
    assert.equal(q.totalMinor, 10560);
  });

  it('returns an unpriced quote when base is missing or invalid', () => {
    for (const input of [null, undefined, { currency: 'USD' }, { currency: 'USD', base: -5 }, { currency: 'USD', base: NaN }]) {
      const q = normalizePrice(input, { qty: 2 });
      assert.equal(q.total, null);
      assert.equal(q.totalMinor, null);
      assert.equal(q.confidence, 'none');
      assert.equal(q.isEstimated, true);
      assert.equal(q.qty, 2);
    }
  });

  it('prices multi-admit tiers per unit and reports per-person cost', () => {
    const q = normalizePrice({ currency: 'INR', base: 899, admits: 2, includesFees: true, includesTaxes: true }, { qty: 3 });
    assert.equal(q.units, 2); // 3 people need two "Entry for 2" units
    assert.equal(q.total, 1798);
    assert.equal(q.perTicket, 599.33);
  });

  it('uses reported fee percentages and tax rates', () => {
    const q = normalizePrice({ currency: 'INR', base: 1000, feePct: 0.05, taxRate: 0.18, feeTaxRate: 0.18 }, { qty: 2 });
    assert.equal(q.fees, 100);
    assert.equal(q.taxes, 378); // 18% of 2000 + 18% of 100
    assert.equal(q.total, 2478);
    assert.equal(q.confidence, 'high');
  });

  it('prepends provider notes', () => {
    const q = normalizePrice({ currency: 'INR', base: 10, includesFees: true, includesTaxes: true, notes: ['From tier X.'] });
    assert.deepEqual(q.notes, ['From tier X.']);
  });

  it('rejects invalid quantities', () => {
    for (const qty of [0, -1, 1.5, NaN]) {
      assert.throws(() => normalizePrice({ currency: 'USD', base: 10 }, { qty }), RangeError);
    }
  });
});

describe('sortByTotal', () => {
  const item = (id, currency, base, extra = {}) => ({
    id,
    price: normalizePrice(base == null ? null : { currency, base, includesFees: true, includesTaxes: true, ...extra }),
  });

  it('orders cheapest first and puts unpriced items last', () => {
    const sorted = sortByTotal([item('a', 'USD', 50), item('none', 'USD', null), item('b', 'USD', 20), item('c', 'USD', 35)]);
    assert.deepEqual(sorted.map((i) => i.id), ['b', 'c', 'a', 'none']);
  });

  it('groups the preferred currency ahead of others', () => {
    const sorted = sortByTotal(
      [item('eur', 'EUR', 10), item('usd-hi', 'USD', 90), item('gbp', 'GBP', 5), item('usd-lo', 'USD', 30)],
      { preferredCurrency: 'usd' },
    );
    assert.deepEqual(sorted.map((i) => i.id), ['usd-lo', 'usd-hi', 'eur', 'gbp']);
  });

  it('breaks ties in favour of higher confidence', () => {
    const exact = item('exact', 'USD', 40);
    const floor = item('floor', 'USD', 40, { priceKind: 'range-min' });
    assert.deepEqual(sortByTotal([floor, exact]).map((i) => i.id), ['exact', 'floor']);
  });

  it('does not mutate the input', () => {
    const input = [item('a', 'USD', 50), item('b', 'USD', 20)];
    sortByTotal(input);
    assert.deepEqual(input.map((i) => i.id), ['a', 'b']);
  });
});
