# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `Provider` interface and registry for pluggable event/price sources.
- Ticketmaster Discovery API provider with on-sale status and presale mapping.
- Price normalizer: totals for a ticket quantity (base + fees + taxes) in
  integer minor units, with `high`/`medium`/`low`/`none` confidence tags and
  cheapest-total sorting grouped by currency.
- Indian GST estimation (GST 2.0 rates effective 22 Sep 2025) and an
  India convenience-fee model. Default currency is INR.
- Polite HTTP client: per-host throttling, bounded retries honouring
  `Retry-After`, timeouts, and secret redaction.
- `GET /api/search`, `/api/providers`, `/api/categories`, `/api/health`,
  with input validation (quantity capped at 8).
- Test suites for the normalizer, GST rules, provider mapping, HTTP client and API.
