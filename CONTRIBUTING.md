# Contributing

Thanks for your interest in improving Ticket Price Assistant!

## Ground rules

- **Guardrails are non-negotiable.** Pull requests that add CAPTCHA solving,
  stealth/anti-detection, fingerprint spoofing, proxy rotation, automatic seat
  selection, payment handling, or that raise request rates will be closed.
- Prefer official APIs. Page-based sources must respect robots.txt, keep
  request rates low, and never work around bot protection.
- Never commit secrets. Keys belong in `.env`, which is git-ignored.
- Follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Development setup

```bash
npm install
cp .env.example .env
npm run dev:server
npm test
```

Requires Node.js 22.9 or newer.

## Making a change

1. Open an issue first for anything non-trivial, so we can agree on the approach.
2. Fork the repo and create a branch from `main`: `feat/<short-name>` or `fix/<short-name>`.
3. Keep changes focused. Match the existing style: ES modules, small modules,
   JSDoc types, comments only where the *why* isn't obvious.
4. Add or update tests. Tests use `node:test` and must not hit the network.
   Use recorded fixtures in `server/test/fixtures/` instead.
5. Update `README.md` and `CHANGELOG.md` (under **Unreleased**) when behaviour changes.
6. Make sure `npm test` passes, then open a pull request using the template.

## Commit messages

Use short, imperative subjects, ideally following
[Conventional Commits](https://www.conventionalcommits.org/):

```
feat(pricing): add District fee model
fix(http): honour Retry-After dates
docs: clarify Chrome 136 launch flags
```

## Adding a data provider

See [Adding a provider](README.md#adding-a-provider). Include in your PR:

- how the source is accessed (official API or public pages) and its rate limits,
- the relevant robots.txt rules, if page-based,
- a recorded fixture and tests for the mapping and price normalization.

## Reporting bugs and security issues

- Bugs and feature requests: [open an issue](../../issues/new/choose).
- Security vulnerabilities: **do not** open a public issue; see [SECURITY.md](SECURITY.md).

By contributing, you agree that your contributions are licensed under the
[MIT License](LICENSE).
