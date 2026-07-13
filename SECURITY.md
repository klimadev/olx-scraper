# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.0.x   | :white_check_mark: |

## Reporting a Vulnerability

This project runs entirely in the browser console and does not communicate with any external server except the OLX website itself.

If you discover a security concern:

1. **Do not** open a public issue.
2. Email the maintainers directly or open a [private advisory](https://github.com/YOUR_USER/olx-scraper/security/advisories/new).

We will respond within 48 hours and work with you to resolve the issue promptly.

## Scope

The following are **in scope**:
- Script behavior that could leak sensitive user data to third parties
- XSS or injection vulnerabilities in the scraper output
- Unintended data exfiltration

The following are **out of scope**:
- Vulnerabilities in the OLX website itself (report those to OLX)
- Rate limiting or anti-bot measures (these are expected)
- General browser security issues

## Safe Usage

- Run this script only on pages you own or have permission to scrape.
- Do not use the script at extremely high volume — respect OLX's infrastructure.
- Review OLX's Terms of Service for your jurisdiction before large-scale use.
