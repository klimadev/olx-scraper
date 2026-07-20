// == OLX Scraper — Content Script (Manifest V3) ==
// Roda em páginas olx.com.br, expõe listener para extração via popup.

class OlxScraper {
  static version = '0.1.0';

  // ── Parse de cards da página atual ──────────────────────
  static #parseCards() {
    const cards = document.querySelectorAll('section.olx-adcard');
    return Array.from(cards, this.#parseCard).filter(Boolean);
  }

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

    if (!url) return null;

    return { title, price, url, seller, location, img };
  }

  // ── Parse de cards a partir de HTML (páginas 2+) ───────
  static #parseCardsFromHtml(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const cards = doc.querySelectorAll('section.olx-adcard');
    return Array.from(cards, this.#parseCard).filter(Boolean);
  }

  // ── URL builder ────────────────────────────────────────
  static #buildPageUrl(pageNum) {
    const url = new URL(window.location.href);
    url.searchParams.set('o', pageNum);
    return url.toString();
  }

  // ── Fetch com timeout (usando fetch + AbortController) ──
  static async #fetchWithTimeout(url, ms) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), ms);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } finally {
      clearTimeout(id);
    }
  }

  // ── Coleta cards de múltiplas páginas ───────────────────
  static async #collectCards(config) {
    const allCards = [];

    // Página 1: DOM atual
    const page1 = this.#parseCards();
    allCards.push(...page1);
    console.log(`[OLX Scraper] Página 1: ${page1.length} cards`);

    // Páginas 2+
    for (let p = 2; p <= config.pages; p++) {
      const url = this.#buildPageUrl(p + config.offset);
      try {
        const html = await this.#fetchWithTimeout(url, config.timeout);
        const cards = this.#parseCardsFromHtml(html);
        allCards.push(...cards);
        console.log(`[OLX Scraper] Página ${p}: ${cards.length} cards`);
      } catch (err) {
        console.warn(`[OLX Scraper] Página ${p} falhou: ${err.message}`);
        break;
      }
    }

    return allCards;
  }

  // ── Extrai dados do anúncio (página de detalhes) ───────
  static #balanceJSON(text, start) {
    let i = start;
    let depth = 0;
    do {
      if (text[i] === '{') depth++;
      else if (text[i] === '}') depth--;
      i++;
    } while (depth > 0 && i < text.length);
    return text.slice(start, i);
  }

  static #extractAll(html) {
    let description = '';
    const ldMatch = html.match(/<script\s+type="application\/ld\+json">([\s\S]*?)<\/script>/i);
    if (ldMatch) {
      try {
        const parsed = JSON.parse(ldMatch[1].trim());
        description = parsed.description ?? '';
      } catch { /* ignore */ }
    }

    let adDetail = {};
    let adDate = '';
    let adProperties = [];

    const dlMatch = html.match(/window\.dataLayer\s*=\s*window\.dataLayer\s*\|\|\s*\[\];?\s*window\.dataLayer\.push\(/);
    if (dlMatch) {
      const start = dlMatch.index + dlMatch[0].length;
      const jsonStr = this.#balanceJSON(html, start);
      try {
        const parsed = JSON.parse(jsonStr);
        if (parsed.adDetail) {
          adDetail = parsed.adDetail;
          adDate = parsed.adDate ?? parsed.adDetail.adDate ?? '';
          adProperties = parsed.adProperties ?? [];
        } else if (Array.isArray(parsed)) {
          for (const item of parsed) {
            if (item.adDetail) {
              adDetail = item.adDetail;
              adDate = item.adDate ?? item.adDetail.adDate ?? '';
              adProperties = item.adProperties ?? [];
              break;
            }
          }
        }
      } catch { /* ignore */ }
    }

    return { description, adDetail, adDate, adProperties };
  }

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
      ...ad,
      description: detail.description,
      adDate: detail.adDate,
      adDetail: detail.adDetail,
      adProperties: detail.adProperties,
    };
  }

  // ── Fetch detalhes em lotes ────────────────────────────
  static async #fetchDetails(ads, config) {
    const results = [];
    const { batchSize, timeout, minimal } = config;

    for (let i = 0; i < ads.length; i += batchSize) {
      const batch = ads.slice(i, i + batchSize);

      const fetched = await Promise.all(
        batch.map(async (ad) => {
          if (!ad.url) return ad;
          try {
            const html = await this.#fetchWithTimeout(ad.url, timeout);
            const detail = this.#extractAll(html);
            return this.#assembleEntry(ad, detail, minimal);
          } catch (err) {
            console.warn(`[OLX Scraper] Erro no detalhe: ${ad.url} — ${err.message}`);
            if (minimal) {
              return {
                title: ad.title,
                price: ad.price,
                url: ad.url,
                seller: ad.seller,
                location: ad.location,
                description: '',
                adDate: '',
                _error: err.message,
              };
            }
            return { ...ad, adDetail: { _error: err.message } };
          }
        })
      );

      results.push(...fetched);

      const done = Math.min(i + batchSize, ads.length);
      this.#sendProgress(done, ads.length);
    }

    return results;
  }

  // ── Envio de progresso ─────────────────────────────────
  static #sendProgress(done, total) {
    chrome.runtime.sendMessage({ type: 'progress', done, total });
  }

  // ── Help ────────────────────────────────────────────────
  static help() {
    console.log(`OLX Scraper v${this.version}
Uso:
  OlxScraper.extract({ pages: 10, minimal: true, batchSize: 5 })

Opções:
  pages     Número de páginas da grid (default 30)
  offset    Offset inicial (default 0)
  limit     Máximo de anúncios (default ilimitado)
  minimal   Apenas campos principais (default true)
  timeout   Timeout por requisição ms (default 15000)
  batchSize Lote de detalhes simultâneos (default 5)`);
  }

  // ── Extract principal ──────────────────────────────────
  static async extract(options = {}) {
    const config = {
      pages: options.pages ?? 30,
      offset: options.offset ?? 0,
      limit: options.limit ?? Infinity,
      minimal: options.minimal ?? true,
      timeout: options.timeout ?? 15000,
      batchSize: options.batchSize ?? 5,
    };

    console.log(`[OLX Scraper] Iniciando extração — páginas: ${config.pages}, limite: ${config.limit > 1e8 ? 'ilimitado' : config.limit}, minimal: ${config.minimal}`);

    // 1. Coletar cards
    const cards = await this.#collectCards(config);

    if (!cards.length) {
      console.warn('[OLX Scraper] Nenhum card encontrado. Verifique se está numa página de resultados do OLX.');
      return [];
    }

    // 2. Aplicar limit
    const limited = config.limit < Infinity ? cards.slice(0, config.limit) : cards;

    console.log(`[OLX Scraper] Total cards coletados: ${limited.length}`);

    // 3. Buscar detalhes
    const results = await this.#fetchDetails(limited, config);

    console.log(`[OLX Scraper] Extração concluída — ${results.length} anúncios`);

    // Aplicar limit novamente (já foi aplicado, mas por segurança)
    return results.slice(0, config.limit);
  }
}

// ── Message Listener ─────────────────────────────────────
// Guarda contra re-injeção (chrome.scripting pode injetar múltiplas vezes).
if (!globalThis.__olxScraperListenerRegistered) {
  globalThis.__olxScraperListenerRegistered = true;

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'start') {
      OlxScraper.extract(msg.options)
        .then(results => {
          chrome.runtime.sendMessage({
            type: 'complete',
            results,
            count: results.length,
          });
        })
        .catch(err => {
          chrome.runtime.sendMessage({
            type: 'error',
            message: err.message || 'Erro desconhecido durante extração',
          });
        });
      sendResponse({ ok: true }); // confirma que o listener está vivo
      return true; // keep channel open for async
    }
  });

  console.log('[OLX Scraper] Content script carregado v' + OlxScraper.version);
}

