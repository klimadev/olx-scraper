// == OLX Scraper — Background Service Worker (MV3) ==

/** Mapa de portas do popup conectadas: tabId → chrome.runtime.Port */
const popupPorts = new Map();

// ── Conexão do popup ─────────────────────────────────────
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'scrape') return;

  // Descobrir tabId da porta
  // A porta não tem tabId diretamente; usamos sender.tab ou
  // armazenamos quando recebemos a primeira mensagem.
  let tabId = null;

  const tryGetTabId = async () => {
    if (tabId) return tabId;
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs[0]) {
      tabId = tabs[0].id;
      popupPorts.set(tabId, port);
    }
    return tabId;
  };

  port.onMessage.addListener(async (msg) => {
    if (msg.type === 'start') {
      const id = await tryGetTabId();
      if (!id) {
        port.postMessage({ type: 'error', message: 'Nenhuma aba ativa encontrada.' });
        return;
      }

      try {
        await chrome.tabs.sendMessage(id, { type: 'start', options: msg.options });
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

        // Limpar URL após um tempo
        setTimeout(() => URL.revokeObjectURL(url), 10000);
      } catch (err) {
        port.postMessage({ type: 'error', message: `Falha ao baixar: ${err.message}` });
      }
    }
  });

  port.onDisconnect.addListener(() => {
    if (tabId) popupPorts.delete(tabId);
  });
});

// ── Mensagens do content script ──────────────────────────
chrome.runtime.onMessage.addListener((msg, sender) => {
  // Apenas mensagens de content scripts têm sender.tab
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
