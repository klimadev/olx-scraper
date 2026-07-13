<div align="center">

# OLX Scraper

**Self-contained, zero-dependency classifieds scraper for OLX**

Paste into your browser console — no npm, no build, no setup.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![JavaScript](https://img.shields.io/badge/JavaScript-ES6+-yellow)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)
[![Platform](https://img.shields.io/badge/Platform-Browser-4caf50)](https://developer.mozilla.org/en-US/docs/Web/API/Window)
[![OLX](https://img.shields.io/badge/OLX-Compatible-blueviolet)](https://www.olx.com.br)
[![Dependencies](https://img.shields.io/badge/Dependencies-0-success)](package.json)
[![Version](https://img.shields.io/badge/Version-1.0.0-informational)](https://github.com/YOUR_USER/olx-scraper/releases)
[![Made in](https://img.shields.io/badge/Made%20in-Brazil-green)](https://www.google.com/maps/place/Brazil)

</div>

---

## Overview

**OLX Scraper** is a lightweight, single-file script that extracts every listing from any [OLX](https://www.olx.com.br) search results page — including the **full ad detail JSON**, **description text**, and **structured property specs** — without a single external dependency.

Unlike traditional web scrapers that require Node.js, Puppeteer, or Playwright, this script runs directly in your browser console. It works across all OLX subdomains (`www.olx.com.br`, `sp.olx.com.br`, `rj.olx.com.br`, etc.) by leveraging OLX's own internal APIs.

> **Why this exists:** There was no open-source, reliable way to extract structured data from OLX. Existing solutions break on OLX's front-end changes, require heavy tooling, or miss critical fields like `adDate`, `description`, and the complete `adDetail` payload. This scraper was built from the ground up by reverse-engineering OLX's client-side data layer.

---

## Features

- **Zero dependencies** — no npm, no Docker, no Puppeteer. Just copy and paste.
- **Works on any OLX category** — cars, real estate, computers, jobs, anything.
- **Full data extraction** — captures title, price, URL, seller, location, image, plus the **complete `adDetail` JSON object**.
- **Correct adDate** — OLX serializes dates incorrectly; this scraper fixes the epoch offset using the accurate timestamp from `dataLayer[0].page.detail.adDate`.
- **Description parsing** — extracts descriptions from the schema.org `application/ld+json` block.
- **Structured specs** — extracts the `adProperties` array, giving you every labeled attribute OLX stores for a listing.
- **Batch processing** — fetches detail pages 5 at a time to avoid overwhelming the browser.
- **Cross-subdomain** — works seamlessly across all regional OLX subdomains thanks to OLX's permissive CORS policy.
- **Human-readable output** — prints a formatted JSON array to the console, ready for copy-paste or further processing.

---

## Quick Start

1. Open your browser and navigate to any OLX search results page (e.g., [computers in São Paulo](https://sp.olx.com.br/grande-sp/sao-paulo/informatica/computadores)).
2. Open the **developer console**:
   - Chrome: `Ctrl + Shift + J` (Windows/Linux) or `Cmd + Option + J` (macOS)
   - Firefox: `Ctrl + Shift + K` (Windows/Linux) or `Cmd + Option + K` (macOS)
3. Copy the entire script from [`olx-scraper.js`](olx-scraper.js) and paste it into the console.
4. Press `Enter`.

The script will:
1. Scrape all listing cards visible on the current grid page.
2. Fetch each listing's detail page via XHR (5 at a time).
3. Parse the embedded `dataLayer` JSON, `ld+json` description, and `adProperties`.
4. Print the complete result as a JSON array.

```

=== RESULTADO FINAL ===
[
  {
    "title": "Computador i5-10400f, 16GB RAM, HD 1TB (sem placa de video)",
    "price": "R$ 1.400",
    "url": "https://sp.olx.com.br/sao-paulo/computador-i5-10400f-16gb-ram-hd-1tb-sem-placa-de-video-123456789",
    "seller": "João Silva",
    "location": "São Paulo - SP",
    "img": "https://img.olx.com.br/images/...",
    "adDetail": { "subject": "Computador i5-10400f...", "price": 1400, ... },
    "description": "Computador com processador Intel Core i5-10400F...",
    "adProperties": [
      { "label": "Processador", "value": "Intel Core i5-10400F" },
      { "label": "Memória RAM", "value": "16 GB" },
      ...
    ]
  },
  ...
]

```

> **Tip:** To save the output as a file, type `copy(JSON.stringify(results))` after the script finishes — this copies the full JSON array to your clipboard.

---

## How It Works

```
┌─────────────────┐     ┌──────────────────┐     ┌──────────────────────┐
│  OLX Grid Page  │────▶│  Extract Cards    │────▶│  Fetch Each Detail   │
│  (results list)  │     │  (title, price,   │     │  via XHR (5 batches) │
└─────────────────┘     │  url, seller, ...) │     └──────────┬───────────┘
                        └──────────────────┘                │
                                                             ▼
┌─────────────────┐     ┌──────────────────┐     ┌──────────────────────┐
│  Final JSON      │◀────│  Parse & Fix      │◀────│  Receive HTML +      │
│  Output          │     │  • ld+json desc   │     │  Extract dataLayer   │
└─────────────────┘     │  • adDetail JSON   │     └──────────────────────┘
                        │  • adDate fix      │
                        │  • adProperties    │
                        └──────────────────┘
```

### Under the Hood

OLX embeds a full `dataLayer` object in every listing page that contains `page.adDetail` (the complete ad metadata), `page.adProperties` (structured specs like processor, RAM, mileage, etc.), and `page.detail.adDate` (the accurate Unix timestamp). The script:

1. **Balances braces** — uses a character-by-character depth counter to extract the complete JSON array from `window.dataLayer = [...]` without a JSON parser.
2. **Parses `ld+json`** — locates the `<script type="application/ld+json">` tag and parses `description` from the schema.org `Product` object.
3. **Fixes `adDate`** — replaces the broken serialized `adDate` (which OLX miscalculates, resulting in dates like `1970-01-21`) with the correct value from `page.detail.adDate` (Unix seconds).
4. **Structures output** — assembles everything into a clean JSON array with both grid-level and detail-level data.

---

## Output Schema

Each entry in the result array has this structure:

| Field | Type | Source | Description |
|---|---|---|---|
| `title` | `string` | Grid card | Listing title |
| `price` | `string` | Grid card | Formatted price (e.g., "R$ 1.400") |
| `url` | `string` | Grid card | Canonical listing URL |
| `seller` | `string` | Grid card | Seller name |
| `location` | `string` | Grid card | City / state |
| `img` | `string` | Grid card | Main image URL |
| `adDetail` | `object` | `dataLayer[0].page.adDetail` | **Complete listing payload** — subject, price (number), category, region, phone, etc. |
| `description` | `string` | `ld+json` | Long-form description text |
| `adProperties` | `array` | `dataLayer[0].page.adProperties` | Structured spec list `[{label, value}]` |

### `adDetail` Fields

The `adDetail` object is OLX's internal representation of a listing and may contain (depending on category):

```
subject         — listing title
price           — numeric price
description     — short description (often truncated)
category        — category path
region          — geographic region
city            — city name
adDate          — correct publication date (YYYY-MM-DD HH:mm:ss)
phone           — contact phone number
images          — array of image URLs
lat/lng         — coordinates
info_*          — category-specific fields (info_computer_processor, info_car_mileage, etc.)
```

Since the script dynamically extracts the **entire** `adDetail` object, it captures every field OLX sends — even ones not documented here.

---

## Use Cases

- **Price monitoring** — track price changes on specific categories or search terms.
- **Market research** — aggregate listing data for supply/demand analysis.
- **Inventory backup** — save your own listings' data for offline records.
- **Data portability** — extract your data from OLX in a structured, machine-readable format.
- **Academic research** — study classifieds market trends in Brazil and other OLX markets.

---

## Tests

This script has been tested end-to-end on **live OLX listings** covering multiple categories and regional subdomains. Every major data field (`title`, `price`, `description`, `adDetail`, `adProperties`, `adDate`) has been verified against actual page content.

---

## Limitations

- **One page at a time** — the script scrapes only the currently loaded grid page. Multi-page scraping is not yet implemented.
- **No pagination** (yet) — you must manually navigate to subsequent pages and re-run the script.
- **JavaScript required** — OLX is a single-page application; the script requires a browser environment with JavaScript enabled.
- **Rate limiting** — OLX may throttle or block excessive requests. The 5-at-a-time batch processing helps, but use responsibly.
- **Terms of Service** — review OLX's ToS before performing large-scale scraping. This tool is intended for personal, non-commercial use.

---

## FAQ

**Q: Will this work for non-Brazilian OLX sites?**  
A: Yes! OLX operates in dozens of countries (India, Portugal, Poland, etc.). The script targets OLX's core data layer, which is consistent across all regional instances.

**Q: Can I export to CSV or Excel?**  
A: After the script runs, use `console.table(results)` for a tabular view, or pipe the JSON through a converter like `jq` or an online CSV transformer.

**Q: Does it work on mobile?**  
A: The script is designed for desktop browsers. Mobile browser consoles are limited, but it may work with a mobile bookmarklet.

**Q: Why does `adDate` show 1970 without the fix?**  
A: OLX serializes `adDate` in `adDetail` using a wrong epoch multiplier. The script corrects this by reading the accurate Unix-second timestamp from `dataLayer[0].page.detail.adDate`.

---

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

---

## License

Distributed under the **MIT License**. See [LICENSE](LICENSE) for more information.

---

<div align="center">

**Made with ❤️ in Brazil** 🇧🇷

[Report Bug](https://github.com/YOUR_USER/olx-scraper/issues) · [Request Feature](https://github.com/YOUR_USER/olx-scraper/issues)

</div>
