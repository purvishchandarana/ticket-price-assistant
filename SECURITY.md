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

Keep these in mind when running or contributing:

- **The API binds to `127.0.0.1`.** It will control your browser from step 3
  onward, so don't expose it on a network interface or behind a public proxy.
- **Chrome remote debugging (port 9222) grants full control of that browser.**
  Use a dedicated `--user-data-dir`, keep the port on localhost, and close
  that Chrome when you're done.
- **Secrets stay in `.env`**, which is git-ignored. API keys are redacted from
  logged and returned URLs.
- **No payment data** is ever entered, stored or read by this software.
