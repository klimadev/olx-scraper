// == OLX Scraper v8 — Class-based with Minimal Mode & Limit ==
// Paste on any OLX search results page.
//
// Usage:
//   OlxScraper.extract()                                    — full output, no limit
//   OlxScraper.extract({ limit: 10 })                       — max 10 listings
//   OlxScraper.extract({ minimal: true })                   — only seller, location, date, title, url, description
//   OlxScraper.extract({ limit: 5, minimal: true })         — combined
//
// Output: JSON array of classified ads.

class OlxScraper {
  /** Public version identifier */
  static version = '0.2.0';

  // ── Public API ──────────────────────────────────────────────

  /**
   * Extract classified ads from the current OLX search results page.
   *
   * @param {Object}  [options]              - Optional configuration.
   * @param {number}  [options.limit]        - Max listings to return (default: no limit).
   * @param {boolean} [options.minimal=false] - Return only core fields.
   * @param {number}  [options.timeout=15000] - Per-request timeout in ms.
   * @param {number}  [options.batchSize=5]   - Concurrent detail fetches.
   * @returns {Promise<Object[]>} Array of ad objects.
   */
  static async extract(options = {}) {
    const {
      limit = Infinity,
      minimal = false,
      timeout = 15000,
      batchSize = 5,
    } = options;

    const cards = OlxScraper.#parseCards();

    if (cards.length === 0) {
      console.warn('[OLX Scraper] Nenhum anúncio encontrado na página.');
      return [];
    }

    console.log(`[OLX Scraper] Anúncios encontrados: ${cards.length}`);

    // Apply limit
    const sliced = Number.isFinite(limit)
      ? cards.slice(0, limit)
      : cards;

    const results = await OlxScraper.#fetchDetails(sliced, {
      timeout,
      batchSize,
      minimal,
    });

    console.log('=== RESULTADO FINAL ===');
    console.log(JSON.stringify(results, null, 2));
    return results;
  }

  // ── Grid Parsing ────────────────────────────────────────────

  /**
   * Parse every ad card from the OLX search-results grid.
   * @returns {Object[]}
   */
  static #parseCards() {
    const cards = document.querySelectorAll('section.olx-adcard');
    return Array.from(cards, OlxScraper.#parseCard).filter(Boolean);
  }

  /**
   * Parse a single OLX ad card element into structured data.
   * @param {Element} el - An `olx-adcard` section element.
   * @returns {Object|null} Card data, or null when the card is invalid.
   */
  static #parseCard(el) {
    const title =
      el.querySelector('h2.olx-adcard__title')?.textContent?.trim() ?? '';
    const price =
      el.querySelector('h3.olx-adcard__price')?.textContent?.trim() ?? '';
    const rawUrl =
      el.querySelector('a.olx-adcard__link')?.href ?? '';
    const seller =
      el.querySelector(
        'span[class*="TransactionalSellerRating_transactionalSellerName"]'
      )?.textContent?.trim() ?? '';
    const location =
      el.querySelector('p.olx-adcard__location')?.textContent?.trim() ?? '';
    const rawImg =
      el.querySelector('.olx-adcard__media img')?.src ?? '';

    const url = rawUrl.split('?')[0];
    const img = rawImg.split('?')[0];

    // Skip entries without a valid URL
    if (!url) return null;

    return { title, price, url, seller, location, img };
  }

  // ── Detail Page Parsing ─────────────────────────────────────

  /**
   * Walk through text character-by-character to find where a top-level
   * JSON object/array closes.  Handles escaped strings correctly.
   *
   * @param {string} text  - Raw HTML containing JSON.
   * @param {number} start - Index of the opening `{` or `[`.
   * @returns {number} Index one past the closing `}` or `]`.
   */
  static #balanceJSON(text, start) {
    let depth = 0;
    let bracketDepth = 0;
    let inStr = false;
    let esc = false;

    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (esc) {
        esc = false;
        continue;
      }
      if (ch === '\\' && inStr) {
        esc = true;
        continue;
      }
      if (ch === '"' && !esc) {
        inStr = !inStr;
        continue;
      }
      if (inStr) continue;

      if (ch === '{') depth++;
      if (ch === '}') {
        depth--;
        if (depth === 0 && bracketDepth === 0) return i + 1;
      }
      if (ch === '[') bracketDepth++;
      if (ch === ']') {
        bracketDepth--;
        if (bracketDepth === 0 && depth === 0) return i + 1;
      }
    }
    return text.length;
  }

  /**
   * Extract structured data from an ad detail page's HTML.
   *
   * Sources:
   *  - `application/ld+json` script → description
   *  - `window.dataLayer`          → adDetail, adProperties, adDate (corrected)
   *
   * @param {string} html - Full HTML of the detail page.
   * @returns {{ adDetail: Object|null, description: string|null, adProperties: Array|null, adDate: string|null }}
   */
  static #extractAll(html) {
    const result = {
      adDetail: null,
      description: null,
      adProperties: null,
      adDate: null,
    };

    // 1. Description from ld+json
    const ldMatch = html.match(
      /<script\s+type="application\/ld\+json">(.+?)<\/script>/s
    );
    if (ldMatch) {
      try {
        result.description = JSON.parse(ldMatch[1]).description ?? null;
      } catch {
        // Malformed JSON — skip.
      }
    }

    // 2. adDetail / adProperties / adDate from dataLayer
    const dlIdx = html.indexOf('window.dataLayer');
    if (dlIdx >= 0) {
      const bracketPos = html.indexOf('[', dlIdx);
      if (bracketPos >= 0) {
        const end = OlxScraper.#balanceJSON(html, bracketPos);
        try {
          const dl = JSON.parse(html.substring(bracketPos, end));
          if (Array.isArray(dl) && dl.length > 0) {
            const page = dl[0].page ?? {};
            result.adDetail = page.adDetail ?? null;
            result.adProperties = page.adProperties ?? null;

            // OLX serialises adDate with the wrong epoch multiplier.
            // Override it with the correct Unix-second value from
            // page.detail.adDate.
            const correctDate = page.detail?.adDate;
            if (correctDate && result.adDetail) {
              const d = new Date(correctDate * 1000);
              result.adDate = d
                .toISOString()
                .replace('T', ' ')
                .substring(0, 19);
              result.adDetail.adDate = result.adDate;
            }
          }
        } catch {
          // Malformed JSON — skip.
        }
      }
    }

    return result;
  }

  // ── Entry Assembly ──────────────────────────────────────────

  /**
   * Merge card-level grid data with detail-page data.
   *
   * In **minimal** mode only the core fields (seller, location, adDate,
   * title, url, description) are returned — `price`, `img`, `adDetail`,
   * and `adProperties` are omitted.
   *
   * @param {Object}  ad      - Card data from #parseCard.
   * @param {Object}  detail  - Detail data from #extractAll.
   * @param {boolean} minimal - When true, return only essential fields.
   * @returns {Object} Merged entry.
   */
  static #assembleEntry(ad, detail, minimal) {
    if (minimal) {
      return {
        seller: ad.seller,
        location: ad.location,
        adDate: detail.adDate,
        title: ad.title,
        url: ad.url,
        description: detail.description,
      };
    }

    return {
      title: ad.title,
      price: ad.price,
      url: ad.url,
      seller: ad.seller,
      location: ad.location,
      img: ad.img,
      adDetail: detail.adDetail,
      description: detail.description,
      adProperties: detail.adProperties,
      adDate: detail.adDate,
    };
  }

  // ── HTTP Fetch ──────────────────────────────────────────────

  /**
   * Fetch a URL via XMLHttpRequest with timeout.
   * Uses XHR (not fetch) for broader cross-origin compatibility.
   *
   * @param {string} url - The URL to fetch.
   * @param {number} ms  - Timeout in milliseconds.
   * @returns {Promise<string>} Response text.
   */
  static #fetchWithTimeout(url, ms) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.timeout = ms;
      xhr.onload = () => resolve(xhr.responseText);
      xhr.onerror = () => reject(new Error('Network error'));
      xhr.ontimeout = () => reject(new Error('Timeout'));
      xhr.open('GET', url, true);
      xhr.send();
    });
  }

  // ── Batch Processing ────────────────────────────────────────

  /**
   * Fetch detail pages for every ad in parallel batches.
   *
   * Errors are isolated per ad — one timeout does not lose the batch.
   *
   * @param {Object[]} ads    - Array of card-data objects.
   * @param {Object}   config - { timeout, batchSize, minimal }.
   * @returns {Promise<Object[]>} Processed entries.
   */
  static async #fetchDetails(ads, config) {
    const { timeout, batchSize, minimal } = config;
    const results = [];

    for (let i = 0; i < ads.length; i += batchSize) {
      const batch = ads.slice(i, i + batchSize);

      const fetched = await Promise.all(
        batch.map((ad) =>
          OlxScraper.#fetchWithTimeout(ad.url, timeout)
            .then((html) => {
              const detail = OlxScraper.#extractAll(html);
              return OlxScraper.#assembleEntry(ad, detail, minimal);
            })
            .catch((err) => {
              if (minimal) {
                return {
                  seller: ad.seller,
                  location: ad.location,
                  title: ad.title,
                  url: ad.url,
                  _error: err.message,
                };
              }
              return { ...ad, adDetail: { _error: err.message } };
            })
        )
      );

      results.push(...fetched);

      const done = Math.min(i + batchSize, ads.length);
      console.log(`[OLX Scraper] Progresso: ${done}/${ads.length}`);
    }

    return results;
  }
}

// ── Export (browser global) ───────────────────────────────────
globalThis.OlxScraper = OlxScraper;

// Auto-execute for paste-and-run backward compatibility.
// Call OlxScraper.extract() manually for custom options.
(async () => {
  try {
    await OlxScraper.extract();
  } catch (err) {
    console.error('[OLX Scraper] Fatal error:', err);
  }
})();
