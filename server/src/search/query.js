import { CATEGORIES, isCategory } from '../categories.js';

// Normal per-order purchase limit. The assistant never goes above it.
export const MAX_QTY = 8;
const MAX_KEYWORD_LENGTH = 100;

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
    this.status = 400;
    this.expose = true;
  }
}

/** Validate raw query-string params into a SearchQuery. */
export function parseSearchQuery(params) {
  const category = String(params.category ?? '');
  if (!isCategory(category)) {
    throw new ValidationError(`category must be one of: ${CATEGORIES.map((c) => c.id).join(', ')}`);
  }

  const keyword = String(params.q ?? '').trim();
  if (!keyword) throw new ValidationError('q (event name) is required');
  if (keyword.length > MAX_KEYWORD_LENGTH) {
    throw new ValidationError(`q must be at most ${MAX_KEYWORD_LENGTH} characters`);
  }

  const qty = params.qty === undefined || params.qty === '' ? 1 : Number(params.qty);
  if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) {
    throw new ValidationError(`qty must be a whole number from 1 to ${MAX_QTY}`);
  }

  return { category, keyword, qty };
}
