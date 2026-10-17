# Security Policy

## Supported versions

The project is pre-1.0; only the latest commit on `main` receives fixes.

## Reporting a vulnerability

Please **do not** open a public issue for security problems.

Report privately through GitHub:
**Security → Report a vulnerability** on this repository
([private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)).

Include steps to reproduce, the affected version or commit, and the impact.
You can expect an acknowledgement within 7 days.

## Security model

The server can drive your browser, so it is locked to your machine:

- **Loopback only.** The API binds to `127.0.0.1` and rejects requests whose
  `Host` header isn't a loopback name, which blocks DNS-rebinding attacks.
- **Same-app origins only.** State-changing requests and WebSocket
  connections from other websites' origins are rejected, so a page you visit
  can't start sessions or read the live view through your browser.
- **Chrome remote debugging (port 9222) grants full control of that browser.**
  Use a dedicated `--user-data-dir`, keep the port on localhost, and close
  that Chrome when you're done.
- **No payment data.** Payment and checkout pages stop all automation; their
  content is never read, stored, or streamed to the live view.
- **Secrets stay in `.env`**, which is git-ignored. API keys are redacted from
  logged and returned URLs.
