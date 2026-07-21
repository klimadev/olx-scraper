// == OLX Scraper — Content Script (Manifest V3) ==
// Roda em páginas olx.com.br, expõe listener para extração via popup.

class OlxScraper {
  static version = '0.1.0';

  // ── Aguardar cards aparecerem no DOM (SPA) ─────────────
  // OLX renderiza os cards via JS. Se dispararmos a extração antes da
  // renderização, achamos 0 cards. Fazemos poll do DOM até aparecerem.
  static #waitForCards(timeout = 15000) {
    return new Promise((resolve) => {
      const t0 = Date.now();
      const check = () => {
        const found = document.querySelectorAll('section.olx-adcard');
        if (found.length) return resolve(found.length);
        if (Date.now() - t0 > timeout) return resolve(0);
        requestAnimationFrame(check);
      };
      check();
    });
  }

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

  // ── Coleta cards de múltiplas páginas (até atingir objetivo) ──
  static async #collectCards(config) {
    const allCards = [];

    // Página 1: DOM atual (sempre carregado no SPA)
    const pageCards = this.#parseCards();
    allCards.push(...pageCards);
    this.#sendCollectProgress(allCards.length, config.goal);
    console.log(`[OLX Scraper] Página 1: ${pageCards.length} cards (total ${allCards.length}/${this.#goalLabel(config.goal)})`);

    // Páginas 2+ até atingir goal ou esgotar resultados
    let p = 2;
    while (config.goal === Infinity || allCards.length < config.goal) {
      const url = this.#buildPageUrl(p + config.offset);
      let cards;
      try {
        const html = await this.#fetchWithTimeout(url, config.timeout);
        cards = this.#parseCardsFromHtml(html);
      } catch (err) {
        console.warn(`[OLX Scraper] Página ${p} falhou: ${err.message}`);
        break; // erro de rede: resultado parcial já é válido
      }
      if (!cards.length) {
        console.log(`[OLX Scraper] Página ${p} vazia — fim dos resultados.`);
        break; // fim natural da busca
      }
      allCards.push(...cards);
      this.#sendCollectProgress(allCards.length, config.goal);
      console.log(`[OLX Scraper] Página ${p}: ${cards.length} cards (total ${allCards.length}/${this.#goalLabel(config.goal)})`);
      p++;
    }

    return config.goal < Infinity ? allCards.slice(0, config.goal) : allCards;
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

  // ── Envio de progresso da fase de coleta ───────────────
  static #sendCollectProgress(found, goal) {
    // total = goal fixo quando finito; = found (barra "cheia") quando ilimitado
    const total = goal === Infinity ? found : goal;
    chrome.runtime.sendMessage({ type: 'collectprogress', done: found, total });
  }

  static #goalLabel(goal) {
    return goal === Infinity ? 'ilimitado' : goal;
  }

  // ── Help ────────────────────────────────────────────────
  static help() {
    console.log(`OLX Scraper v${this.version}
Uso:
  OlxScraper.extract({ goal: 1500, minimal: true, batchSize: 5 })

Opções:
  goal      Número alvo de anúncios (default ilimitado)
  offset    Offset inicial (default 0)
  minimal   Apenas campos principais (default true)
  timeout   Timeout por requisição ms (default 15000)
  batchSize Lote de detalhes simultâneos (default 5)`);
  }

  // ── Extract principal ──────────────────────────────────
  static async extract(options = {}) {
    const config = {
      goal: options.goal ?? Infinity,
      offset: options.offset ?? 0,
      minimal: options.minimal ?? true,
      timeout: options.timeout ?? 15000,
      batchSize: options.batchSize ?? 5,
    };

    console.log(`[OLX Scraper] Iniciando extração — objetivo: ${this.#goalLabel(config.goal)}, minimal: ${config.minimal}`);

    // 0. Aguardar os cards renderizarem (OLX é SPA)
    const waited = await this.#waitForCards(config.timeout);
    console.log(`[OLX Scraper] Cards aguardados: ${waited}`);

    // 1. Coletar cards
    const cards = await this.#collectCards(config);

    if (!cards.length) {
      console.warn('[OLX Scraper] Nenhum card encontrado. Verifique se está numa página de resultados do OLX.');
      return [];
    }

    // 2. Buscar detalhes (cards já cortados em goal no #collectCards)
    const results = await this.#fetchDetails(cards, config);

    console.log(`[OLX Scraper] Extração concluída — ${results.length} anúncios`);

    return results;
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

