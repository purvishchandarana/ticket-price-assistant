import { CATEGORIES, isCategory } from '../categories.js';

// Normal per-order purchase limit. The assistant never goes above it.
export const MAX_QTY = 8;
const MAX_KEYWORD_LENGTH = 100;
const MAX_CITY_LENGTH = 50;

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
    this.status = 400;
    this.expose = true;
  }
}

/** Validate a ticket quantity (1..MAX_QTY). */
export function parseQty(value, { fallback = 1 } = {}) {
  const qty = value === undefined || value === '' ? fallback : Number(value);
  if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) {
    throw new ValidationError(`qty must be a whole number from 1 to ${MAX_QTY}`);
  }
  return qty;
}

/** Validate raw query-string params into a SearchQuery. */
export function parseSearchQuery(params) {
  // Category is optional: without it every source searches everything.
  const category = String(params.category ?? '').trim();
  if (category && !isCategory(category)) {
    throw new ValidationError(`category must be one of: ${CATEGORIES.map((c) => c.id).join(', ')}`);
  }

  const keyword = String(params.q ?? '').trim();
  if (!keyword) throw new ValidationError('q (event name) is required');
  if (keyword.length > MAX_KEYWORD_LENGTH) {
    throw new ValidationError(`q must be at most ${MAX_KEYWORD_LENGTH} characters`);
  }

  const city = String(params.city ?? '').trim();
  if (city.length > MAX_CITY_LENGTH) {
    throw new ValidationError(`city must be at most ${MAX_CITY_LENGTH} characters`);
  }

  const query = { keyword, qty: parseQty(params.qty) };
  if (category) query.category = category;
  if (city) query.city = city;
  return query;
}
