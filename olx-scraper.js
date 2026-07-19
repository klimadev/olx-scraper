// == OLX Scraper v9 — Multi-page, Minimal Mode & Limit ==
// Paste on any OLX search results page.
//
// Quick start:
//   OlxScraper.extract()                                          — 10 pages
//   OlxScraper.extract({ limit: 5 })                              — max 5
//   OlxScraper.extract({ minimal: true })                         — compact view
//   OlxScraper.extract({ pages: 3, limit: 50, minimal: true })   — combined
//   OlxScraper.help()                                             — show usage
//
// Output: JSON array of classified ads.

class OlxScraper {
  /** Public version identifier */
  static version = '0.0.3';

  /**
   * Show usage instructions in the console.
   *
   * Call this after pasting the script to see all options, examples,
   * and the output schema at a glance.
   *
   * @example
   *   OlxScraper.help();
   *
   * @returns {void}
   */
  static help() {
    const { version } = OlxScraper;
    const examples = [
      `OlxScraper v${version} — Uso rápido`,
      '────────────────────────────────────────────────',
      '',
      '  OlxScraper.extract()',
      '    → 10 páginas, sem limite, todos os campos',
      '',
      '  OlxScraper.extract({ limit: 5 })',
      '    → máximo de 5 anúncios',
      '',
      '  OlxScraper.extract({ minimal: true })',
      '    → só campos essenciais (inclui preço)',
      '',
      '  OlxScraper.extract({ pages: 3, offset: 2, limit: 50 })',
      '    → páginas 3-5, máximo 50 anúncios',
      '',
      '  OlxScraper.help()',
      '    → mostra esta ajuda',
      '',
      'Opções:',
      '  pages   (number)  — qtd de páginas (default 10)',
      '  offset  (number)  — página inicial -1 (default 0)',
      '  limit   (number)  — max anúncios (default ilimitado)',
      '  minimal (boolean) — só campos essenciais (default false)',
      '  timeout (number)  — ms por requisição (default 15000)',
      '  batchSize (number)— detalhes em paralelo (default 5)',
      '',
      'Campos retornados:',
      '  title, price, url, seller, location, img,',
      '  description, adDetail, adProperties, adDate',
      '',
      'Modo minimal (minimal: true):',
      '  title, price, url, seller, location, description, adDate',
      '',
      'Dica: use console.table(resultado) para ver em tabela.',
      '      use copy(JSON.stringify(resultado)) p/ copiar.',
    ];
    console.log(examples.join('\n'));
  }

  // ── Public API ──────────────────────────────────────────────

   /**
    * Extract classified ads from OLX search results.
    * Scrapes multiple grid pages via XHR, then fetches each ad's detail page.
    *
    * @param {Object}  [options]               - Optional configuration.
    * @param {number}  [options.limit]         - Max listings to return.
    * @param {boolean} [options.minimal=false]  - Return only core fields.
    * @param {number}  [options.pages=10]       - Number of grid pages to scrape.
    * @param {number}  [options.offset=0]       - Starting page offset (0 = page 1).
    * @param {number}  [options.timeout=15000]  - Per-request timeout in ms.
    * @param {number}  [options.batchSize=5]    - Concurrent detail fetches.
    * @returns {Promise<Object[]>} Array of ad objects.
    */
  static async extract(options = {}) {
    const {
      limit = Infinity,
      minimal = true,
      timeout = 15000,
      batchSize = 5,
      pages = 30,
      offset = 0,
    } = options;

    console.log(`[OLX Scraper] Coletando anúncios de ${pages} página(s) (offset: ${offset})...`);

    const allCards = await OlxScraper.#collectCards({ pages, offset, timeout });

    if (allCards.length === 0) {
      console.warn('[OLX Scraper] Nenhum anúncio encontrado.');
      return [];
    }

    console.log(`[OLX Scraper] Total de anúncios encontrados: ${allCards.length}`);

    const sliced = Number.isFinite(limit)
      ? allCards.slice(0, limit)
      : allCards;

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

  // ── Multi-Page Collection ───────────────────────────────────

  /**
   * Build the URL for a given OLX search results page number.
   * Starts from the current page URL and sets the `o` parameter.
   * @param {number} pageNum - Page number (1-based).
   * @returns {string} Absolute URL for that page.
   */
  static #buildPageUrl(pageNum) {
    const url = new URL(window.location.href);
    url.searchParams.set('o', String(pageNum));
    url.searchParams.delete('utm_source');
    url.searchParams.delete('utm_campaign');
    url.searchParams.delete('xtra');
    return url.toString();
  }

  /**
   * Collect ad cards from multiple grid pages.
   * Page 1 (when offset is 0) uses the live DOM; all others use XHR.
   * @param {{ pages: number, offset: number, timeout: number }} config
   * @returns {Promise<Object[]>} Flattened array of card objects.
   */
  static async #collectCards({ pages, offset, timeout }) {
    const allCards = [];
    const startPage = offset + 1;

    for (let i = 0; i < pages; i++) {
      const pageNum = startPage + i;
      let cards;

      if (pageNum === 1 && offset === 0) {
        cards = OlxScraper.#parseCards();
      } else {
        const url = OlxScraper.#buildPageUrl(pageNum);
        try {
          cards = await OlxScraper.#fetchGridPage(url, timeout);
        } catch (err) {
          console.warn(`[OLX Scraper] Erro ao buscar página ${pageNum}: ${err.message}`);
          break;
        }
      }

      if (cards.length === 0) break;
      allCards.push(...cards);
      console.log(`[OLX Scraper] Página ${pageNum}: ${cards.length} anúncios`);
    }

    return allCards;
  }

  /**
   * Fetch a grid/search results page via XHR and parse its cards.
   * @param {string} url - Grid page URL.
   * @param {number} ms  - Timeout in milliseconds.
   * @returns {Promise<Object[]>} Parsed card objects.
   */
  static async #fetchGridPage(url, ms) {
    const html = await OlxScraper.#fetchWithTimeout(url, ms);
    return OlxScraper.#parseCardsFromHtml(html);
  }

  /**
   * Parse ad cards from an HTML string (XHR response).
   * @param {string} html - Raw HTML of a grid page.
   * @returns {Object[]} Array of card data objects.
   */
  static #parseCardsFromHtml(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const cards = doc.querySelectorAll('section.olx-adcard');
    return Array.from(cards, OlxScraper.#parseCard).filter(Boolean);
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
   * In **minimal** mode the heavier fields (`img`, `adDetail`,
   * `adProperties`) are omitted, but `price` is always included.
   *
   * @param {Object}  ad      - Card data from #parseCard.
   *   @param {string}  ad.title
   *   @param {string}  ad.price
   *   @param {string}  ad.url
   *   @param {string}  ad.seller
   *   @param {string}  ad.location
   *   @param {string}  ad.img
   * @param {Object}  detail  - Detail data from #extractAll.
   *   @param {Object|null}  detail.adDetail
   *   @param {string|null}  detail.description
   *   @param {Array|null}   detail.adProperties
   *   @param {string|null}  detail.adDate
   * @param {boolean} minimal - When true, omit img / adDetail / adProperties.
   * @returns {Object} Merged entry.
   */
  static #assembleEntry(ad, detail, minimal) {
    if (minimal) {
      return {
        title: ad.title,
        price: ad.price,
        url: ad.url,
        seller: ad.seller,
        location: ad.location,
        description: detail.description,
        adDate: detail.adDate,
      };
    }

    return {
      title: ad.title,
      price: ad.price,
      url: ad.url,
      seller: ad.seller,
      location: ad.location,
      img: ad.img,
      description: detail.description,
      adDate: detail.adDate,
      adDetail: detail.adDetail,
      adProperties: detail.adProperties,
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
                  title: ad.title,
                  price: ad.price,
                  url: ad.url,
                  seller: ad.seller,
                  location: ad.location,
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

