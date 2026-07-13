// == OLX Scraper v7 - Description + Date Fix ==
// Rode na pagina de resultados do OLX.
// Extrai TODOS os anuncios + adDetail, description, adProperties.
// Conserta adDate (pegando do dataLayer.detail.adDate correto).
// Sai: JSON com {title, price, url, seller, location, img, adDetail, description, adProperties}

(async () => {
  var cards = document.querySelectorAll('section.olx-adcard');
  var ads = Array.from(cards).map(function(el) {
    return {
      title: (el.querySelector('h2.olx-adcard__title') || {}).textContent || '',
      price: (el.querySelector('h3.olx-adcard__price') || {}).textContent || '',
      url: ((el.querySelector('a.olx-adcard__link') || {}).href || '').split('?')[0],
      seller: (el.querySelector('span[class*="TransactionalSellerRating_transactionalSellerName"]') || {}).textContent || '',
      location: (el.querySelector('p.olx-adcard__location') || {}).textContent || '',
      img: ((el.querySelector('.olx-adcard__media img') || {}).src || '').split('?')[0]
    };
  }).filter(function(a) { return a.url; });

  console.log('Anuncios encontrados:', ads.length);

  function balanceJSON(text, start) {
    var depth = 0, bracketDepth = 0, inStr = false, esc = false;
    for (var i = start; i < text.length; i++) {
      var ch = text[i];
      if (esc) { esc = false; continue; }
      if (ch === '\\' && inStr) { esc = true; continue; }
      if (ch === '"' && !esc) { inStr = !inStr; continue; }
      if (inStr) continue;
      if (ch === '{') depth++;
      if (ch === '}') { depth--; if (depth === 0 && bracketDepth === 0) return i + 1; }
      if (ch === '[') bracketDepth++;
      if (ch === ']') { bracketDepth--; if (bracketDepth === 0 && depth === 0) return i + 1; }
    }
    return text.length;
  }

  function extractAll(html) {
    var result = { adDetail: null, description: null, adProperties: null };

    // 1. Parse application/ld+json for description
    var ldMatch = html.match(/<script\s+type="application\/ld\+json">(.+?)<\/script>/s);
    if (ldMatch) {
      try { result.description = JSON.parse(ldMatch[1]).description || null; } catch(e) {}
    }

    // 2. Find window.dataLayer = [ and parse full JSON
    var dlMarker = 'window.dataLayer';
    var dlIdx = html.indexOf(dlMarker);
    if (dlIdx >= 0) {
      var bracketPos = html.indexOf('[', dlIdx);
      if (bracketPos >= 0) {
        var end = balanceJSON(html, bracketPos);
        try {
          var dl = JSON.parse(html.substring(bracketPos, end));
          if (Array.isArray(dl) && dl.length > 0) {
            var page = dl[0].page || {};
            result.adDetail = page.adDetail || null;
            result.adProperties = page.adProperties || null;

            // Fix adDate: use page.detail.adDate (Unix seconds, correto)
            var correctDate = page.detail && page.detail.adDate;
            if (correctDate && result.adDetail) {
              var d = new Date(correctDate * 1000);
              result.adDetail.adDate = d.toISOString().replace('T', ' ').substring(0, 19);
            }
          }
        } catch(e) {}
      }
    }

    return result;
  }

  function fetchWithTimeout(url, ms) {
    return new Promise(function(resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.timeout = ms || 15000;
      xhr.onload = function() { resolve(xhr.responseText); };
      xhr.onerror = function() { reject(new Error('Network error')); };
      xhr.ontimeout = function() { reject(new Error('Timeout')); };
      xhr.open('GET', url, true);
      xhr.send();
    });
  }

  var results = [];
  var batchSize = 5;
  for (var i = 0; i < ads.length; i += batchSize) {
    var batch = ads.slice(i, i + batchSize);
    var fetched = await Promise.all(batch.map(function(ad) {
      return fetchWithTimeout(ad.url).then(function(html) {
        var detail = extractAll(html);
        var entry = { title: ad.title, price: ad.price, url: ad.url, seller: ad.seller, location: ad.location, img: ad.img };
        entry.adDetail = detail.adDetail;
        entry.description = detail.description;
        entry.adProperties = detail.adProperties;
        return entry;
      }).catch(function(err) {
        var entry = { title: ad.title, price: ad.price, url: ad.url, seller: ad.seller, location: ad.location, img: ad.img };
        entry.adDetail = { _error: err.message };
        return entry;
      });
    }));
    results = results.concat(fetched);
    console.log('Progresso:', Math.min(i + batchSize, ads.length), '/' + ads.length);
  }

  console.log('=== RESULTADO FINAL ===');
  console.log(JSON.stringify(results, null, 2));
  return JSON.stringify(results);
})();
