# Ticket Price Assistant

[![CI](https://github.com/purvishchandarana/ticket-price-assistant/actions/workflows/ci.yml/badge.svg)](https://github.com/purvishchandarana/ticket-price-assistant/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Node](https://img.shields.io/badge/node-%3E%3D22.13-339933)

A personal, **human-in-the-loop** assistant for the Indian live-events market.
It finds the cheapest **total** price for an event (ticket + convenience fee +
GST) across sources, watches events for on-sale and price changes, and can
pre-fill the booking flow in **your own Chrome**. **You** solve any CAPTCHA
or queue, choose your seats, and pay.

> [!IMPORTANT]
> This is a personal-use tool, not a ticket bot. It never solves CAPTCHAs,
> never selects seats, never touches payment details, and runs one session at
> a time. You are responsible for complying with the terms of service of any
> site you use it with. See [Disclaimer](#disclaimer).

## Contents

- [Features](#features)
- [Guardrails](#guardrails)
- [Quick start](#quick-start)
- [Using it](#using-it)
- [Launching Chrome for booking assist](#launching-chrome-for-booking-assist)
- [Data sources](#data-sources)
- [How prices are normalized](#how-prices-are-normalized)
- [India: GST and fees](#india-gst-and-fees)
- [Configuration](#configuration)
- [API](#api)
- [Docker](#docker)
- [Project structure](#project-structure)
- [Extending](#extending)
- [Contributing](#contributing) · [License](#license) · [Disclaimer](#disclaimer)

## Features

| | |
|---|---|
| **Search** | One search box: type an event, artist or team (e.g. *Parampara Navratri*), optionally a city and ticket count. No categories needed; results are tagged Music / Comedy / Sports / Theatre. |
| **Price comparison** | Results from District, BookMyShow, Ticketmaster and the demo site, normalized to a total for your quantity. Best matches first, then related events, each cheapest first. Each price shows a breakdown, an *estimated* flag and a confidence tag. |
| **Smart tiers** | Handles tiers like "Entry for 2" and per-tier GST, so it can tell you when two singles beat one couple ticket. |
| **Watchlist & alerts** | Watched events are re-checked on a schedule. Status changes (e.g. *Sale scheduled → On sale*) and price drops raise in-app alerts, plus optional email/SMS. |
| **Booking assist** | Attaches to your Chrome over CDP, opens the event and pre-fills quantity/filters at human pace (600–1800 ms between actions). |
| **Challenge handoff** | Detects CAPTCHA iframes, queues/waiting rooms and "verify you are human" pages, then **pauses** and shows *Action needed: your turn*. Resumes automatically when the check is gone, or when you click Continue. |
| **Live view** | Streams the assisted tab into the app (CDP screencast) with a step timeline and Pause / Continue / Stop controls. |
| **Payment handoff** | On a checkout/payment page all automation and the live view stop immediately and the tab is brought to the front: *Complete payment yourself*. |
| **Resumable** | Session state (event, quantity, filters, completed steps) is stored in SQLite; after a server restart you can re-attach and continue. |

## Guardrails

These are design constraints, not settings:

- **No CAPTCHA solving** and no CAPTCHA-solving services. Challenges pause automation for you.
- **No stealth**: no anti-detection plugins, fingerprint spoofing or proxy rotation. It drives your real, unmodified Chrome.
- **No automatic seat selection.** Adapters stop before the seat map; you pick seats.
- **No payment handling.** Payment pages are never automated, read, or streamed.
- **One account, normal limits**: max 8 tickets, one active session at a time.
- **Polite data access**: official APIs where they exist; otherwise only what robots.txt allows: one site search plus a few event pages per query, ≥1.5 s apart, cached. Sites that only serve real browsers are read in **your** Chrome, and any check they show is yours to complete. If a site blocks access, the assistant stops and says so.

## Quick start

Requires **Node.js 22.13+** (uses built-in `node:sqlite`).

```bash
git clone https://github.com/purvishchandarana/ticket-price-assistant.git
cd ticket-price-assistant
npm install
cp .env.example .env        # Windows: copy .env.example .env
npm run dev
```

`npm run dev` starts three things:

| | URL |
|---|---|
| App (UI) | http://127.0.0.1:5173 |
| API | http://127.0.0.1:3001 |
| DemoTix demo site | http://127.0.0.1:4100 |

**Start Chrome with remote debugging (below) before searching**: BookMyShow and
District's full search run in a helper tab in that Chrome. Without it, District
falls back to its sitemap (which misses some events) and BookMyShow is skipped.
Add `TICKETMASTER_API_KEY` to `.env` for international events. For a single-port setup, run `npm run build` then
`npm start` and open http://127.0.0.1:3001.

Run the tests with `npm test`.

## Using it

1. **Search**: type a name (e.g. *Parampara Navratri*, *Vivek Samtani*), optionally a city, and the number of tickets. A helper tab opens in your Chrome while searching; if a site shows a check there, complete it and the search continues.
2. **Compare**: best matches come first, then related events, each sorted by cheapest total. Open **Breakdown** to see base, fees, GST and how sure the estimate is.
3. **Watch**: click **Watch** to get alerts when it goes on sale or gets cheaper. The **Watchlist** page shows status, last check and alerts.
4. **Assist**: start Chrome as shown below, then click **Start assist**. Follow the banner: when it says *Action needed* or *Your turn*, act in Chrome.

**Try it safely first:** search *midnight*, *laugh* or *derby* to get DemoTix events. They walk through a waiting room, a "verify you are human" check, a seat map and a payment step, all local and fictional. Use http://127.0.0.1:4100/admin to put a show on sale or drop prices, then **Check now** on the Watchlist to see alerts.

## Launching Chrome for booking assist

The assistant attaches to a Chrome **you** start, with remote debugging on port
9222. It is used for BookMyShow and District search and for booking assist. **Chrome 136+ ignores `--remote-debugging-port` for your default
profile**, so a dedicated `--user-data-dir` is required. This keeps the
assistant away from your everyday profile. Sign in to ticket sites once in it.

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

## Data sources

| Source | Access | Booking assist |
|---|---|---|
| **District** (district.in) | No public API. Discovery: District's own site search, run in your Chrome (falls back to the published sitemap without Chrome). Prices: public event pages (robots.txt-allowed) fetched by the server; schema.org event data plus each tier's convenience-fee % and GST from the page. | Pre-fill: date, show, cheapest stand & ticket type, quantity |
| **BookMyShow** | No public API, and it only serves real browsers, so it is read in your Chrome: one call to its own search, then a few event pages' schema.org data. Listed prices include GST; the convenience fee is estimated. If BookMyShow blocks the browser, the source reports it and stops. | Open & watch |
| **Ticketmaster** | Official Discovery API (key required). Little Indian inventory. | Open & watch |
| **DemoTix** (local) | Bundled demo site | Full pre-fill demo |

**Open & watch** opens the event in your Chrome and watches for queues,
checks and checkout without clicking or typing anything on the site. Full
pre-fill needs a site adapter with known selectors; see [Extending](#extending).
District's adapter picks the cheapest available stand and ticket type (within
your max price) and sets the quantity, then hands over: you review it, click
**Add to cart** and continue. It never adds to the cart or touches payment.

## How prices are normalized

Every result carries a quote for your quantity:

```jsonc
{
  "currency": "INR", "qty": 2, "units": 2,
  "base": 998, "fees": 39.92, "taxes": 7.19, "total": 1045.11, "perTicket": 522.56,
  "isEstimated": true,
  "confidence": "medium",
  "components": { "base": "reported", "fees": "reported", "taxes": "estimated" },
  "notes": ["Cheapest option: \"Entry for 1\".", "Convenience fee and GST rates from District's ticket data; …"]
}
```

| Confidence | Meaning |
|---|---|
| `high` | Base, fees and taxes all reported by the source (or included) |
| `medium` | Fees known; some taxes estimated, or it's a "from ₹X" price |
| `low` | Fees not published; estimated from a fee model |
| `none` | No price published |

All arithmetic is in paise (integer minor units). Prices in different
currencies are never ranked against each other.

## India: GST and fees

Where a source doesn't say, GST is estimated with the GST 2.0 rates effective
**22 September 2025**:

| Ticket type | GST on ticket |
|---|---|
| Concerts, comedy, theatre and other entertainment | Exempt up to ₹500 per ticket, 18% above |
| Recognised sporting events | Exempt up to ₹500 per ticket, 18% above |
| IPL and similar leagues | 40% |
| Convenience / booking fee | 18% on the fee |

For District, the per-tier convenience-fee percentage and GST rates come from
the event page itself; only GST on the convenience fee is estimated. Rules live
in [`gst.js`](server/src/pricing/gst.js) and [`feeModels.js`](server/src/pricing/feeModels.js).

> [!NOTE]
> These are best-effort estimates for comparison, not tax advice. The checkout
> total is always the source of truth.

## Configuration

All settings live in `.env`; see [`.env.example`](.env.example) for the full list.

| Variable | Default | Purpose |
|---|---|---|
| `PORT` / `HOST` | `3001` / `127.0.0.1` | API address. Keep it on loopback. |
| `PREFERRED_CURRENCY` | `INR` | Sorted first |
| `DISTRICT_ENABLED` | `true` | District source on/off |
| `DISTRICT_MIN_INTERVAL_MS` | `1500` | Gap between District page requests (min 1000) |
| `DISTRICT_MAX_PAGES` | `5` | Event pages fetched per search |
| `BOOKMYSHOW_ENABLED` / `BOOKMYSHOW_MAX_PAGES` | `true` / `4` | BookMyShow source (needs Chrome) |
| `BROWSER_MIN_INTERVAL_MS` | `1500` | Gap between requests to one site from your Chrome (min 1000) |
| `TICKETMASTER_API_KEY` | – | Discovery API Consumer Key |
| `DEMO_SITE_URL` | – | Enables the DemoTix source |
| `CDP_URL` | `http://localhost:9222` | Your Chrome's DevTools endpoint |
| `WATCH_INTERVAL_MIN` | `15` | Watcher interval (min 5) |
| `SMTP_URL`, `ALERT_EMAIL_*` | – | Optional email alerts |
| `TWILIO_*`, `ALERT_SMS_TO` | – | Optional SMS alerts |

## API

REST under `/api` and a WebSocket at `/ws`.

| Method | Path | |
|---|---|---|
| `GET` | `/api/search?q=<name>&qty=2&city=Mumbai` | Best matches first, then cheapest (`category` optional) |
| `GET` | `/api/categories`, `/api/providers`, `/api/browser`, `/api/health` | |
| `GET` / `POST` / `DELETE` | `/api/watchlist`, `/api/watchlist/:eventId` | Watch / unwatch |
| `POST` | `/api/watchlist/check` | Re-check all watched events now |
| `GET` / `POST` | `/api/alerts`, `/api/alerts/read` | Alerts and read state |
| `GET` / `POST` | `/api/sessions/current`, `/api/sessions` | Current / start booking session |
| `POST` | `/api/sessions/current/pause` · `continue` · `stop` | Session controls |

WebSocket messages: `hello`, `session:update`, `bot:paused` (reason
`challenge` or `your_turn`), `bot:resumed`, `bot:payment`, `alert`,
`watchlist:update`, `frame` (JPEG screencast), `source:attention` / `source:cleared`
(a site showed a check in the search helper tab).

The API only answers requests addressed to a loopback host, and rejects
state-changing requests and WebSocket connections from other websites'
origins. See [SECURITY.md](SECURITY.md).

## Docker

```bash
docker compose up --build
```

This serves the UI and API on http://127.0.0.1:3001 with SQLite stored in
`./data`. District sitemap search, Ticketmaster, the watcher and alerts work in Docker. **Booking assist, BookMyShow and
District site search do not** on Windows/macOS, because Chrome's debugging port only accepts local
connections. Run with `npm start` for booking assist. On Linux you can use
`network_mode: host`.

## Project structure

```
.
├── server/
│   ├── adapters/          per-site booking adapters: demo.js, generic.js (+ contract in common.js)
│   ├── src/
│   │   ├── automation/    CDP connection, browser agent (search helper tab), session state machine, challenge detector, pacing, screencast
│   │   ├── db/            SQLite store (watchlist, history, alerts, sessions)
│   │   ├── lib/           polite HTTP client, robots.txt, sitemap/JSON-LD helpers, security
│   │   ├── pricing/       normalizer, fee models, GST rules
│   │   ├── providers/     Provider interface, District, BookMyShow, Ticketmaster, DemoTix, shared JSON-LD mapping
│   │   ├── search/        query validation, fan-out search
│   │   ├── watcher/       on-sale watcher, email/SMS notifiers
│   │   └── ws/            WebSocket hub
│   └── test/              node:test suites (no network)
├── client/                React + Vite + Tailwind UI (Search, Results, Watchlist, Session)
├── demo-site/             DemoTix: fictional local ticket site
└── scripts/dev.mjs        runs everything for development
```

## Extending

**Add a data provider:** create `server/src/providers/<name>.js` extending
`Provider` (`isConfigured`, `search`, `getEvent`), build prices with
`normalizePrice()`, register it in [`registry.js`](server/src/providers/registry.js),
and add tests with a recorded or synthetic fixture.

**Add a site adapter:** create `server/adapters/<site>.js` exporting `id`,
`label`, `matches(event)`, `prepare(page, {event, qty, filters}, ctx)`,
`isAtPayment(page)` and optionally `isPaymentUrl(url)` and `handoffMessage`.
Wrap every action in `ctx.step(id, label, fn)` (resumable, paced,
challenge-checked) and waits in `ctx.waitFor(...)`. Stop before seat
selection. Register it in [`adapters/index.js`](server/adapters/index.js).
Use selectors you have verified on the real site.

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) and
the [Code of Conduct](CODE_OF_CONDUCT.md). Changes that weaken the
[guardrails](#guardrails) will not be accepted. Report vulnerabilities
privately as described in [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) © 2026 Purvish Chandarana

## Disclaimer

This project is not affiliated with, endorsed by, or connected to District,
Zomato, Ticketmaster, BookMyShow or any other ticketing platform. All
trademarks belong to their owners. Many ticketing sites restrict automated
access in their terms of service; you are solely responsible for how you use
this software and for complying with those terms and applicable law. The
software is provided "as is", without warranty of any kind.
