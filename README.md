# Ticket Price Assistant

[![CI](https://github.com/purvishchandarana/ticket-price-assistant/actions/workflows/ci.yml/badge.svg)](https://github.com/purvishchandarana/ticket-price-assistant/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Node](https://img.shields.io/badge/node-%3E%3D22.9-339933)

A personal, **human-in-the-loop** assistant for the Indian live-events market.
It finds the cheapest **total** price for an event (base + convenience fees +
GST) across ticketing sources, and can pre-fill the booking flow in your own
Chrome. **You** solve any CAPTCHA or queue, choose your seats, and complete
payment yourself.

> [!IMPORTANT]
> This is a personal-use tool, not a ticket bot. It never solves CAPTCHAs,
> never selects seats, never touches payment details, and never runs parallel
> sessions. You are responsible for complying with the terms of service of
> any site you use it with. See [Disclaimer](#disclaimer).

## Contents

- [Status](#status)
- [Guardrails](#guardrails)
- [Quick start](#quick-start)
- [Configuration](#configuration)
- [API](#api)
- [How prices are normalized](#how-prices-are-normalized)
- [India: GST and fees](#india-gst-and-fees)
- [Data sources](#data-sources)
- [Project structure](#project-structure)
- [Adding a provider](#adding-a-provider)
- [Launching Chrome for the booking assistant](#launching-chrome-for-the-booking-assistant)
- [Contributing](#contributing)
- [License](#license)
- [Disclaimer](#disclaimer)

## Status

Early development. The backend search and pricing core works; the UI and
browser assistant are next.

| Step | Scope | Status |
|---|---|---|
| 1 | Provider interface, search, price normalizer (INR + GST) | ✅ Done |
| 2 | Results UI with price-comparison table (React + Vite + Tailwind) | ⏳ Next |
| 3 | Chrome over CDP, navigation, challenge pause/resume | Planned |
| 4 | WebSocket status + live screencast panel | Planned |
| 5 | On-sale watcher + alerts (SQLite) | Planned |
| 6 | Payment handoff + polish | Planned |

## Guardrails

These are design constraints, not settings:

- **No CAPTCHA solving**, and no CAPTCHA-solving services. On a challenge or
  waiting room, automation pauses and hands control to you.
- **No stealth**: no anti-detection plugins, fingerprint spoofing or proxy rotation.
- **No automatic seat selection.** You pick seats.
- **No payment handling.** Automation stops at the payment page; payment
  details are never entered, stored or read.
- **One account, normal purchase limits** (max 8 tickets), no parallel
  sessions for the same event.
- **Low request rates**: per-host throttling, response caching, `Retry-After`
  honoured, robots.txt respected. Official APIs are preferred over pages.

## Quick start

Requires **Node.js 22.9+**.

```bash
git clone https://github.com/purvishchandarana/ticket-price-assistant.git
cd ticket-price-assistant
npm install
cp .env.example .env        # Windows: copy .env.example .env
npm run dev:server          # API on http://127.0.0.1:3001
```

Run the tests:

```bash
npm test
```

## Configuration

All settings live in `.env` (see [`.env.example`](.env.example)).

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3001` | API port |
| `HOST` | `127.0.0.1` | Bind address. Keep it on loopback. |
| `PREFERRED_CURRENCY` | `INR` | Results in this currency sort first |
| `HTTP_MIN_INTERVAL_MS` | `500` | Minimum gap between requests to one host |
| `TICKETMASTER_API_KEY` | – | [Ticketmaster Discovery API](https://developer.ticketmaster.com/) key |
| `TICKETMASTER_COUNTRY_CODE` | `IN` | Country filter for Ticketmaster |
| `CDP_URL` | `http://localhost:9222` | Chrome DevTools endpoint (step 3+) |

## API

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/health` | Liveness check |
| `GET` | `/api/categories` | `concerts`, `sports`, `theatre` |
| `GET` | `/api/providers` | Each provider and whether it is configured |
| `GET` | `/api/search?category=concerts&q=<name>&qty=2` | Merged results, cheapest total first |

A search response contains `results` (normalized events), `sources` (per-provider
success/error) and `warnings`. One failing provider never fails the whole search.

## How prices are normalized

Every result carries a `price` quote for the requested quantity:

```jsonc
{
  "currency": "INR", "qty": 2,
  "base": 3000, "fees": 300, "taxes": 594, "total": 3894, "perTicket": 1947,
  "isEstimated": true,
  "confidence": "low",            // high | medium | low | none
  "components": { "base": "reported", "fees": "estimated", "taxes": "estimated" },
  "notes": ["Fees estimated (…)", "Taxes estimated (GST at 22 Sep 2025 rates)."]
}
```

| Confidence | Meaning |
|---|---|
| `high` | Base, fees and taxes are all reported by the source (or included in the price) |
| `medium` | Fees known, taxes estimated or unknown; also the cap for "from ₹X" range minimums |
| `low` | Fees not published, estimated from a fee model |
| `none` | The source published no price |

All arithmetic uses integer minor units (paise), so totals never drift.
Prices in different currencies are never ranked against each other.

## India: GST and fees

When a source's price excludes GST, it is estimated using the GST 2.0 rates
effective **22 September 2025**:

| Ticket type | GST on ticket |
|---|---|
| Concerts, theatre and other entertainment | Exempt up to ₹500 per ticket, 18% above |
| Recognised sporting events | Exempt up to ₹500 per ticket, 18% above |
| IPL and similar leagues | 40% |
| Convenience / booking fee | 18% on the fee |

The tax class is inferred from the category and event name (e.g. "IPL" → 40%).
Rules live in [`server/src/pricing/gst.js`](server/src/pricing/gst.js); fee
models in [`feeModels.js`](server/src/pricing/feeModels.js).

> [!NOTE]
> These are best-effort estimates for comparison, not tax advice. The
> checkout total is always the source of truth. The default 10% convenience-fee
> figure is a placeholder; tune it from real checkouts.

## Data sources

| Source | Access | Status |
|---|---|---|
| Ticketmaster Discovery API | Official API | ✅ Implemented (limited Indian inventory) |
| District (Zomato) | No public API | Under evaluation |
| BookMyShow | No public API; blocks non-browser clients | Under evaluation, browser-assist only |

Major Indian platforms publish no public APIs. Any page-based source must
respect robots.txt and low request rates, and must never work around bot
protection.

## Project structure

```
.
├── server/
│   ├── src/
│   │   ├── app.js, index.js, config.js, categories.js
│   │   ├── lib/          http.js (throttle, retry, secret redaction), cache.js, money.js
│   │   ├── providers/    Provider.js (interface), registry.js, ticketmaster.js
│   │   ├── pricing/      normalizer.js, feeModels.js, gst.js
│   │   └── search/       query.js (validation), searchService.js
│   └── test/             node:test suites + fixtures
├── client/               (step 2) React + Vite + Tailwind UI
└── .github/              CI workflow, issue and PR templates
```

## Adding a provider

1. Create `server/src/providers/<name>.js` extending `Provider`; implement
   `isConfigured()`, `search(query)` and `getEvent(id)`, returning
   `NormalizedEvent`s (typedefs in [`Provider.js`](server/src/providers/Provider.js)).
2. Build prices with `normalizePrice()`, passing a `taxClass` for INR events.
3. Register it in [`registry.js`](server/src/providers/registry.js) and add its
   keys to `.env.example`.
4. Add tests with a recorded fixture; tests must not hit the network.

## Launching Chrome for the booking assistant

*(Used from step 3.)* The assistant attaches to a Chrome you start yourself.
**Chrome 136+ ignores `--remote-debugging-port` on the default profile**, so a
dedicated `--user-data-dir` is required. This also keeps the assistant away
from your everyday profile.

**Windows (PowerShell)**
```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="$env:LOCALAPPDATA\ChromeTicketAssist"
```

**macOS**
```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --remote-debugging-port=9222 --user-data-dir="$HOME/.chrome-ticket-assist"
```

**Linux**
```bash
google-chrome --remote-debugging-port=9222 --user-data-dir="$HOME/.chrome-ticket-assist"
```

> [!WARNING]
> Anything that can reach port 9222 has full control of that browser. Keep it
> on localhost and close that Chrome when you are done.

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) and
the [Code of Conduct](CODE_OF_CONDUCT.md). Changes that weaken the
[guardrails](#guardrails) will not be accepted. Report vulnerabilities
privately as described in [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) © 2026 Purvish Chandarana

## Disclaimer

This project is not affiliated with, endorsed by, or connected to
Ticketmaster, BookMyShow, District, Zomato or any other ticketing platform.
All trademarks belong to their owners. Many ticketing sites restrict automated
access in their terms of service; you are solely responsible for how you use
this software and for complying with those terms and applicable law. The
software is provided "as is", without warranty of any kind.
