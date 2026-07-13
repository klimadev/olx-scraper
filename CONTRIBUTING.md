# Contributing to OLX Scraper

Thank you for your interest in contributing! We welcome contributions of all kinds — bug reports, feature requests, documentation improvements, and code changes.

## Code of Conduct

This project follows a [Code of Conduct](CODE_OF_CONDUCT.md). By participating, you agree to uphold its principles.

## How to Contribute

### Reporting Bugs

1. Check the [existing issues](https://github.com/YOUR_USER/olx-scraper/issues) to avoid duplicates.
2. Open a new issue with a clear title and description.
3. Include:
   - Browser version and OS
   - OLX URL where the bug occurs
   - Expected vs actual output
   - Console output (screenshots or text)

### Suggesting Features

1. Open a [feature request](https://github.com/YOUR_USER/olx-scraper/issues/new) with a clear title.
2. Explain **why** the feature would be useful and **how** it should work.
3. If possible, include example use cases or mock output.

### Submitting Code

1. Fork the repository.
2. Create a new branch: `git checkout -b feature/my-feature`.
3. Make your changes — keep them focused and atomic.
4. Test your changes on a live OLX page.
5. Commit with a clear, descriptive message:
   ```
   feat: add pagination support for multi-page scraping
   ```
   We follow [Conventional Commits](https://www.conventionalcommits.org/).
6. Push your branch and open a Pull Request.

### Pull Request Guidelines

- Keep PRs small and focused on a single concern.
- Update the README if your change introduces new behavior.
- Ensure the script remains **zero-dependency** and **self-contained**.
- Do not introduce build steps, transpilers, or package managers.
- Verify the output schema does not break existing consumers.

## Development Setup

No setup required! The script runs directly in a browser console. To test:

1. Navigate to any OLX search results page.
2. Open the browser console (`F12`).
3. Paste the script and press `Enter`.
4. Verify the output JSON is correct and complete.

## Style Guide

- **ES5/ES6 compatible** — avoid modern syntax that isn't supported in older browsers (Chrome 60+, Firefox 60+).
- **No external dependencies** — the script must work without any imports or downloads.
- **Descriptive variable names** — prefer `cards` over `c`, `adDetail` over `d`.
- **Comments** — comment non-obvious parsing logic (brace balancing, epoch correction).
- **Error tolerance** — gracefully handle missing fields or malformed pages.

## Project Structure

```
olx-scraper.js    — the entire scraper, single file
README.md         — documentation and usage guide
LICENSE           — MIT license
```

There are no build tools, config files, or package managers. The entire project is a single JavaScript file.

## Questions?

Open a [discussion](https://github.com/YOUR_USER/olx-scraper/discussions) or reach out via issues. We're happy to guide you through your first contribution.
