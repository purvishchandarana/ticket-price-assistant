# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **BookMyShow** source, read through a helper tab in the user's own Chrome
  (BookMyShow only serves real browsers): its own search plus event-page
  schema.org data; GST-inclusive prices with an estimated convenience fee.
- **Browser agent**: serialized, rate-limited, robots.txt-checked requests in
  the user's Chrome; pauses for the human on CAPTCHAs/bot checks
  (`source:attention` WebSocket event) and reports hard blocks instead of
  working around them.
- District discovery via District's own site search (finds events whose URL
  slug doesn't contain their name, e.g. "Parampara Navratri"), with sitemap
  fallback when Chrome isn't available.
- Results ranked as **best matches** then **related events**, each cheapest
  first; identical in-flight searches are coalesced.

### Changed

- Search no longer requires a category: one search box, results tagged by category.
- Indian address parsing understands states and PIN codes (better city filtering).

### Added earlier

- **District provider**: sitemap-based discovery, robots.txt checks, slow
  dedicated throttle and caching; prices from schema.org JSON-LD refined with
  each tier's convenience-fee % and GST rates; show dates, venues, IST times,
  sold-out/scheduled/cancelled status; city filter with Indian city aliases.
- **Comedy** category and optional **city** search filter.
- Normalizer support for multi-admit tiers ("Entry for 2"), reported fee
  percentages and reported tax rates.
- **Results UI** (React + Vite + Tailwind): category picker, search, price
  comparison table with breakdown, confidence and estimated tags.
- **Booking assist** over CDP in the user's own Chrome: session state machine,
  human-paced steps, challenge detection with pause / auto-resume / Continue,
  one session at a time, resumable after restart.
- Site adapters: `demo` (full pre-fill for the local demo site) and `generic`
  ("open & watch", no site-specific selectors).
- **Live view**: CDP screencast over WebSocket with status chips, step timeline
  and Pause/Continue/Stop. Frames are never sent for payment pages.
- **Payment handoff**: automation and live view stop on checkout/payment pages
  and the tab is brought to the front.
- **Watchlist and on-sale watcher** with SQLite (`node:sqlite`) price history,
  in-app alerts and optional email (SMTP) / SMS (Twilio) alerts.
- **DemoTix** fictional demo site with waiting room, human-check stand-in,
  seat map, checkout and an admin page for simulating changes.
- Host/Origin protection for the API and WebSocket.
- `npm run dev` runner, Dockerfile and docker-compose.
- Tests for District parsing, robots.txt, challenge detection, sessions,
  watcher, store and API security.

### Earlier in Unreleased

- `Provider` interface and registry; Ticketmaster Discovery API provider.
- Price normalizer with confidence tags and cheapest-total sorting.
- Indian GST estimation (GST 2.0 rates effective 22 Sep 2025); INR default.
- Polite HTTP client: throttling, retries honouring `Retry-After`, timeouts,
  secret redaction.
