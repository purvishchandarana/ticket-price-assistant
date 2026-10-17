import * as demo from './demo.js';
import * as district from './district.js';
import * as generic from './generic.js';

// Most specific first; `generic` is the fallback for any event with a URL.
export const ADAPTERS = [demo, district, generic];

export function pickAdapter(event) {
  return ADAPTERS.find((adapter) => adapter.matches(event)) ?? null;
}
