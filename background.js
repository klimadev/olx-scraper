// == OLX Scraper — Background Service Worker (MV3) ==

/** Mapa de portas do popup conectadas: tabId → chrome.runtime.Port */
const popupPorts = new Map();

// ── Helper: injetar content.js sob demanda (com retry) ──
async function ensureContentScript(tabId) {
  // Tenta injetar o content script. Se já estiver presente, a reexecução
  // apenas rebinda os listeners无害mente. Isso garante funcionamento em
  // abas abertas antes da instalação da extensão.
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

// ── Conexão do popup ─────────────────────────────────────
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'scrape') return;

  const portState = { tabId: null };

  const resolveTabId = async () => {
    if (portState.tabId) return portState.tabId;
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
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
      // Injeta o content script sob demanda (garante funcionamento em
      // páginas já abertas antes da instalação da extensão).
      const injected = await ensureContentScript(tabId);
      if (!injected) {
        port.postMessage({
          type: 'error',
          message: 'Não foi possível injetar o script. Navegue para uma página do OLX e tente novamente.',
        });
        return;
      }

      // Pequeno delay para garantir que os listeners do content script
      // estejam registrados antes de enviar a mensagem.
      await new Promise(r => setTimeout(r, 100));

      try {
        chrome.tabs.sendMessage(tabId, { type: 'start', options: msg.options }, () => {
          if (chrome.runtime.lastError) {
            port.postMessage({
              type: 'error',
              message: 'Content script não respondeu. Recarregue a página do OLX e tente novamente.',
            });
          }
        });
      } catch (err) {
        port.postMessage({
          type: 'error',
          message: 'Content script não disponível. Navegue para uma página do OLX e tente novamente.',
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
