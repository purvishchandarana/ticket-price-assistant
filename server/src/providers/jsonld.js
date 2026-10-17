// Shared mapping from schema.org Event JSON-LD (used by District, BookMyShow
// and many other ticket sites) to a NormalizedEvent.

import { inferTaxClass } from '../pricing/gst.js';
import { normalizePrice } from '../pricing/normalizer.js';

export const TIMEZONE_IN = 'Asia/Kolkata';

/** schema.org Event or any subtype (MusicEvent, ComedyEvent, SportsEvent, …). */
export function isEventLd(item) {
  const types = Array.isArray(item?.['@type']) ? item['@type'] : [item?.['@type']];
  return types.some((t) => typeof t === 'string' && /Event$/.test(t));
}

const LD_TYPE_CATEGORY = [
  [/ComedyEvent/, 'comedy'],
  [/MusicEvent|Festival/, 'concerts'],
  [/SportsEvent/, 'sports'],
  [/TheaterEvent|DanceEvent/, 'theatre'],
];

export function categoryFromLdType(item) {
  const types = (Array.isArray(item?.['@type']) ? item['@type'] : [item?.['@type']]).join(' ');
  return LD_TYPE_CATEGORY.find(([pattern]) => pattern.test(types))?.[1] ?? null;
}

const schemaEnum = (value) => String(value ?? '').replace(/^https?:\/\/schema\.org\//i, '');

export function localParts(iso, timeZone = TIMEZONE_IN) {
  if (!iso || Number.isNaN(Date.parse(iso))) return { localDate: null, localTime: null };
  const d = new Date(iso);
  const date = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  const time = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(d);
  return { localDate: date, localTime: time };
}

export function mapVenue(location) {
  if (!location || typeof location !== 'object') return null;
  const address = location.address;
  if (address && typeof address === 'object') {
    return {
      name: location.name ?? null,
      city: address.addressLocality ?? null,
      region: address.addressRegion ?? null,
      country: address.addressCountry?.name ?? address.addressCountry ?? null,
      address: address.streetAddress ?? null,
    };
  }
  // "…, Malviya Nagar, Jaipur, Rajasthan 302017, India" or "…, Sector 62, Noida 201301"
  const parts = String(address ?? '').split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.at(-1)?.toLowerCase() === 'india') parts.pop();
  const cleaned = parts.map((p) => p.replace(/\s*\b\d{3}\s?\d{3}\b\s*$/, '').trim()).filter(Boolean);
  let region = null;
  if (cleaned.length && INDIAN_STATES.has(cleaned.at(-1).toLowerCase())) region = cleaned.pop();
  const city = cleaned.length ? cleaned.pop() : null;
  return { name: location.name ?? null, city, region, country: 'IN', address: String(address ?? '') || null };
}

const INDIAN_STATES = new Set([
  'andhra pradesh', 'arunachal pradesh', 'assam', 'bihar', 'chhattisgarh', 'goa', 'gujarat', 'haryana',
  'himachal pradesh', 'jharkhand', 'karnataka', 'kerala', 'madhya pradesh', 'maharashtra', 'manipur',
  'meghalaya', 'mizoram', 'nagaland', 'odisha', 'punjab', 'rajasthan', 'sikkim', 'tamil nadu', 'telangana',
  'tripura', 'uttar pradesh', 'uttarakhand', 'west bengal', 'andaman and nicobar islands', 'chandigarh',
  'dadra and nagar haveli and daman and diu', 'delhi', 'jammu and kashmir', 'ladakh', 'lakshadweep', 'puducherry',
]);

/** Flatten an Offer / AggregateOffer into priced tiers. */
export function ldTiers(offers) {
  if (!offers) return [];
  const list = Array.isArray(offers) ? offers : (offers.offers ?? (schemaEnum(offers['@type']) === 'Offer' ? [offers] : []));
  const currency = Array.isArray(offers) ? undefined : offers.priceCurrency;
  const tiers = list
    .map((t) => ({ ...t, price: Number(t.price), priceCurrency: t.priceCurrency ?? currency ?? 'INR' }))
    .filter((t) => Number.isFinite(t.price) && t.price > 0);
  if (tiers.length === 0 && Number(offers.lowPrice) > 0) {
    return [{ name: null, price: Number(offers.lowPrice), priceCurrency: currency ?? 'INR', availability: offers.availability, rangeOnly: true }];
  }
  return tiers;
}

const AVAILABLE = new Set(['InStock', 'LimitedAvailability', 'OnlineOnly', 'InStoreOnly']);
const SOLD_OUT = new Set(['SoldOut', 'OutOfStock', 'Discontinued']);

export function tierState(tier, nowMs, { soldOut = false } = {}) {
  const starts = Date.parse(tier.availabilityStarts ?? tier.validFrom ?? '');
  const ends = Date.parse(tier.availabilityEnds ?? tier.validThrough ?? '');
  const availability = schemaEnum(tier.availability);
  if (Number.isFinite(ends) && ends < nowMs) return { state: 'ended' };
  if (Number.isFinite(starts) && starts > nowMs) return { state: 'scheduled', startsAt: new Date(starts).toISOString() };
  if (availability === 'PreOrder' || availability === 'PreSale') return { state: 'scheduled', startsAt: null };
  if (SOLD_OUT.has(availability) || soldOut) return { state: 'soldout' };
  if (AVAILABLE.has(availability) || !availability) return { state: 'available' };
  return { state: 'unknown' };
}

/** People admitted by one unit of a tier, from its name ("Entry for 2", "Couple"). */
export function admitsFromTierName(name) {
  const n = String(name ?? '').toLowerCase();
  const explicit = n.match(/\b(?:for|pack of|group of)\s*(\d{1,2})\b/) ?? n.match(/\b(\d{1,2})\s*(?:pax|people|persons)\b/);
  if (explicit) return Math.min(Math.max(Number(explicit[1]), 1), 20);
  if (/\b(couple|pair|duo)\b/.test(n)) return 2;
  return 1;
}

/**
 * Build a NormalizedEvent from one Event JSON-LD object.
 *
 * @param {object} ld
 * @param {object} options
 * @param {(tier: object) => {item?: object, price?: object}} [options.tierDetails]
 *        per-tier extras: `price` merges into the PriceInput (fees/taxes known
 *        by the site), `item` provides availability/seat hints
 */
export function eventFromLd(ld, {
  source, sourceName, sourceEventId, url, category = null, qty = 1, now = new Date(),
  feeModel, tierDetails = () => ({}), priceDefaults = {}, extraNotes = [],
}) {
  const name = String(ld.name ?? '').trim();
  const eventCategory = category ?? categoryFromLdType(ld);
  const taxClass = inferTaxClass({ category: eventCategory, name });
  const nowMs = now.getTime();

  const evaluated = ldTiers(ld.offers).map((tier) => {
    const details = tierDetails(tier) ?? {};
    const soldOut = details.item?.is_available === false || details.item?.item_state === 'sold_out';
    return { tier, details, ...tierState(tier, nowMs, { soldOut }) };
  });
  const available = evaluated.filter((t) => t.state === 'available');
  const pool = available.length > 0 ? available : evaluated;

  let price = normalizePrice(null, { qty });
  for (const { tier, details } of pool) {
    const admits = admitsFromTierName(tier.name);
    const units = Math.ceil(qty / admits);
    const notes = [];
    if (tier.name) {
      notes.push(admits > 1
        ? `Cheapest option: ${units} × "${tier.name}" (admits ${admits} each).`
        : `Cheapest option: "${tier.name}".`);
    }
    notes.push(...extraNotes);
    const input = {
      currency: tier.priceCurrency,
      base: tier.price,
      admits,
      taxClass,
      priceKind: tier.rangeOnly ? 'range-min' : 'exact',
      ...priceDefaults,
      ...(details.price ?? {}),
      notes: [...notes, ...(details.price?.notes ?? [])],
    };
    const quote = normalizePrice(input, { qty, feeModel });
    if (price.totalMinor == null || (quote.totalMinor != null && quote.totalMinor < price.totalMinor)) price = quote;
  }
  if (available.length === 0 && price.totalMinor != null) {
    price = { ...price, notes: [...price.notes, 'No tier is currently available to buy.'] };
  }

  const eventStatus = schemaEnum(ld.eventStatus);
  const upcomingStarts = evaluated.filter((t) => t.state === 'scheduled' && t.startsAt).map((t) => t.startsAt).sort();
  let status;
  if (/Cancelled/i.test(eventStatus)) status = 'cancelled';
  else if (/Postponed/i.test(eventStatus)) status = 'postponed';
  else if (/Rescheduled/i.test(eventStatus)) status = 'rescheduled';
  else if (available.length > 0) status = 'onsale';
  else if (evaluated.some((t) => t.state === 'scheduled')) status = 'scheduled';
  else if (evaluated.length > 0) status = 'soldout';
  else status = 'unknown';

  const startIso = ld.startDate ?? null;
  const image = Array.isArray(ld.image) ? ld.image[0] : ld.image;
  return {
    id: `${source}:${sourceEventId}`,
    source,
    sourceName,
    sourceEventId,
    name,
    category: eventCategory,
    url,
    imageUrl: typeof image === 'string' ? image : (image?.url ?? null),
    start: { ...localParts(startIso), dateTime: startIso, endDateTime: ld.endDate ?? null, timezone: TIMEZONE_IN, tba: !startIso },
    venue: mapVenue(ld.location),
    onSale: { status, rawStatus: eventStatus || null, publicStart: upcomingStarts[0] ?? null, publicEnd: null, presales: [] },
    tiers: evaluated.map(({ tier, details, state }) => ({
      name: tier.name ?? null,
      price: tier.price,
      currency: tier.priceCurrency,
      state,
      admits: admitsFromTierName(tier.name),
      ...(details.summary ?? {}),
    })),
    price,
  };
}

/** True if the event has ended (or, lacking an end, started) before `now`. */
export function isPast(event, now = new Date()) {
  const end = Date.parse(event.start?.endDateTime ?? event.start?.dateTime ?? '');
  return Number.isFinite(end) && end < now.getTime();
}

const CITY_ALIASES = [
  ['bengaluru', 'bangalore'],
  ['mumbai', 'bombay'],
  ['gurugram', 'gurgaon'],
  ['delhi', 'new delhi'],
  ['kolkata', 'calcutta'],
  ['chennai', 'madras'],
  ['puducherry', 'pondicherry'],
];

export function cityVariants(city) {
  const c = String(city ?? '').trim().toLowerCase();
  if (!c) return [];
  return CITY_ALIASES.find((names) => names.includes(c)) ?? [c];
}

export function matchesCity(event, city) {
  const variants = cityVariants(city);
  if (variants.length === 0) return true;
  const haystack = [event.venue?.city, event.venue?.address, event.venue?.name, event.name]
    .filter(Boolean).join(' ').toLowerCase();
  return variants.some((v) => haystack.includes(v));
}

const STOP_WORDS = new Set(['the', 'and', 'live', 'show', 'tickets', 'ticket', 'in', 'at', 'of', 'a', 'by', 'buy', 'ft', 'feat']);

export const keywordTokens = (s) =>
  String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/).filter((t) => t.length > 1 && !STOP_WORDS.has(t));

/**
 * Keep site-search hits that actually relate to the keyword: at least half of
 * the keyword tokens must appear in the hit's text. The site's top hit is always kept.
 */
export function relevantHits(hits, keyword, textOf) {
  const tokens = keywordTokens(keyword);
  if (tokens.length === 0) return hits;
  const needed = Math.ceil(tokens.length / 2);
  return hits.filter((hit, i) => {
    if (i === 0) return true;
    const text = textOf(hit).toLowerCase();
    return tokens.filter((t) => text.includes(t)).length >= needed;
  });
}
