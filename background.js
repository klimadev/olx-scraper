// == OLX Scraper — Background Service Worker (MV3) ==

/** Mapa de portas do popup conectadas: tabId → chrome.runtime.Port */
const popupPorts = new Map();

// ── Helper: injetar content.js sob demanda ──
async function ensureContentScript(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js'],
    });
    return true;
  } catch (err) {
    console.warn('[OLX Scraper] Falha ao injetar content script:', err.message);
    return false;
  }
}

// ── Helper: enviar 'start' com retry ──
// Injeta o content script (se necessário) e envia a mensagem. Se o
// content script não responder (lastError), re-injeta e tenta de novo.
function sendStartWithRetry(tabId, options, attempts = 3) {
  return new Promise((resolve) => {
    const trySend = async (left) => {
      // Garante que o content script está injetado antes de cada tentativa
      // que seja um retry. A 1ª tentativa assume que já injetamos antes.
      chrome.tabs.sendMessage(tabId, { type: 'start', options }, (response) => {
        if (chrome.runtime.lastError) {
          console.warn('[OLX Scraper] sendMessage falhou:', chrome.runtime.lastError.message);
          if (left > 0) {
            // Re-injeta e tenta de novo após pequeno delay
            ensureContentScript(tabId).then(() =>
              setTimeout(() => trySend(left - 1), 150)
            );
          } else {
            resolve(false);
          }
        } else {
          resolve(true);
        }
      });
    };
    trySend(attempts);
  });
}

// ── Conexão do popup ─────────────────────────────────────
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'scrape') return;

  const portState = { tabId: null };

  const resolveTabId = async () => {
    if (portState.tabId) return portState.tabId;
    // lastFocusedWindow: janela focada ANTES do popup abrir (a janela do
    // navegador, não a janela do popup). Em alguns navegadores o popup não
    // conta como janela separada, então caímos de volta para currentWindow.
    let tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tabs.length) tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs[0]) {
      portState.tabId = tabs[0].id;
      popupPorts.set(portState.tabId, port);
    }
    return portState.tabId;
  };

  port.onMessage.addListener(async (msg) => {
    const tabId = await resolveTabId();
    if (!tabId) {
      port.postMessage({ type: 'error', message: 'Nenhuma aba ativa encontrada.' });
      return;
    }

    if (msg.type === 'start') {
      // Injeta o content script sob demanda e tenta enviar a mensagem
      // com retry. Garante funcionamento em páginas já abertas.
      const injected = await ensureContentScript(tabId);
      if (!injected) {
        port.postMessage({
          type: 'error',
          message: 'Não foi possível injetar o script. Navegue para uma página do OLX e tente novamente.',
        });
        return;
      }
      const sent = await sendStartWithRetry(tabId, msg.options);
      if (!sent) {
        port.postMessage({
          type: 'error',
          message: 'Content script não respondeu. Recarregue a página do OLX e tente novamente.',
        });
      }
    }

    if (msg.type === 'download') {
      try {
        const blob = new Blob([JSON.stringify(msg.results, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const filename = `olx-scraper-${Date.now()}.json`;

        await chrome.downloads.download({
          url,
          filename,
          conflictAction: 'uniquify',
        });

        setTimeout(() => URL.revokeObjectURL(url), 10000);
      } catch (err) {
        port.postMessage({ type: 'error', message: `Falha ao baixar: ${err.message}` });
      }
    }
  });

  port.onDisconnect.addListener(() => {
    if (portState.tabId) popupPorts.delete(portState.tabId);
  });
});

// ── Mensagens do content script ──────────────────────────
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!sender.tab) return;

  const port = popupPorts.get(sender.tab.id);

  if (msg.type === 'progress') {
    if (port) port.postMessage({ type: 'progress', done: msg.done, total: msg.total });
  } else if (msg.type === 'complete') {
    if (port) port.postMessage({ type: 'complete', results: msg.results, count: msg.count });
  } else if (msg.type === 'error') {
    if (port) port.postMessage({ type: 'error', message: msg.message });
  }
});
