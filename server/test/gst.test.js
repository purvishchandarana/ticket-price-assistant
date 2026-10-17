import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FEE_MODELS } from '../src/pricing/feeModels.js';
import { gstAdmissionRate, inferTaxClass } from '../src/pricing/gst.js';
import { normalizePrice } from '../src/pricing/normalizer.js';

describe('inferTaxClass', () => {
  it('maps categories and spots IPL fixtures', () => {
    assert.equal(inferTaxClass({ category: 'sports', name: 'TATA IPL 2026: MI vs CSK' }), 'premium-league');
    assert.equal(inferTaxClass({ category: 'sports', name: 'Indian Premier League Final' }), 'premium-league');
    assert.equal(inferTaxClass({ category: 'sports', name: 'India vs Australia, 2nd ODI' }), 'sport');
    assert.equal(inferTaxClass({ category: 'sports', name: 'Philippines Open' }), 'sport'); // "ipl" inside a word
    assert.equal(inferTaxClass({ category: 'concerts', name: 'Arijit Singh Live' }), 'entertainment');
    assert.equal(inferTaxClass({ category: 'theatre', name: 'Tumhari Amrita' }), 'entertainment');
    assert.equal(inferTaxClass({ category: 'other' }), null);
  });
});

describe('gstAdmissionRate', () => {
  it('exempts tickets up to ₹500 and charges 18% above', () => {
    assert.equal(gstAdmissionRate({ taxClass: 'entertainment', perTicketBase: 500, currency: 'INR' }), 0);
    assert.equal(gstAdmissionRate({ taxClass: 'entertainment', perTicketBase: 500.01, currency: 'INR' }), 0.18);
    assert.equal(gstAdmissionRate({ taxClass: 'sport', perTicketBase: 2500, currency: 'INR' }), 0.18);
  });

  it('charges 40% on IPL-type leagues regardless of price', () => {
    assert.equal(gstAdmissionRate({ taxClass: 'premium-league', perTicketBase: 300, currency: 'INR' }), 0.4);
  });

  it('returns null when GST does not apply or the class is unknown', () => {
    assert.equal(gstAdmissionRate({ taxClass: 'entertainment', perTicketBase: 900, currency: 'USD' }), null);
    assert.equal(gstAdmissionRate({ taxClass: null, perTicketBase: 900, currency: 'INR' }), null);
  });
});

describe('normalizePrice with the India fee model', () => {
  const india = { feeModel: FEE_MODELS.india };

  it('exempts a ≤ ₹500 ticket but still taxes the convenience fee', () => {
    const q = normalizePrice({ currency: 'INR', base: 499, taxClass: 'entertainment' }, { qty: 2, ...india });
    // fees: 10% of 499 = 49.90 × 2 = 99.80; GST: 0 on tickets + 18% of 99.80 = 17.96
    assert.equal(q.base, 998);
    assert.equal(q.fees, 99.8);
    assert.equal(q.taxes, 17.96);
    assert.equal(q.total, 1115.76);
    assert.equal(q.confidence, 'low');
    assert.ok(q.notes.some((n) => n.includes('GST')));
  });

  it('charges 18% on a concert ticket above ₹500 and on the fee', () => {
    const q = normalizePrice({ currency: 'INR', base: 1500, taxClass: 'entertainment' }, india);
    assert.equal(q.fees, 150);
    assert.equal(q.taxes, 297); // 270 + 27
    assert.equal(q.total, 1947);
  });

  it('charges 40% on IPL tickets; reported fees give medium confidence', () => {
    const q = normalizePrice({ currency: 'INR', base: 1000, fees: 100, taxClass: 'premium-league' }, { qty: 2, ...india });
    assert.equal(q.taxes, 836); // 40% of 2000 + 18% of 200
    assert.equal(q.total, 3036);
    assert.equal(q.components.taxes, 'estimated');
    assert.equal(q.confidence, 'medium');
  });

  it('leaves taxes unknown when the tax class is unknown', () => {
    const q = normalizePrice({ currency: 'INR', base: 1500 }, india);
    assert.equal(q.components.taxes, 'unknown');
    assert.equal(q.total, 1650);
  });

  it('adds nothing when the source says GST is already included', () => {
    const q = normalizePrice({ currency: 'INR', base: 1500, includesTaxes: true, taxClass: 'entertainment' }, india);
    assert.equal(q.taxes, 0);
    assert.equal(q.components.taxes, 'included');
  });
});
