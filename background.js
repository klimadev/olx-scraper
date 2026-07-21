// == OLX Scraper — Background Service Worker (MV3) ==
// O estado do scraping vive AQUI (no service worker), não no popup.
// O popup é apenas um viewer: abre, vê o progresso, fecha — o scraping
// continua rodando mesmo com o popup fechado.

// ── Estado global do scraping ────────────────────────────
// status: 'idle' | 'scraping' | 'complete' | 'error'
const state = {
  status: 'idle',
  phase: null, // null | 'collect' | 'details'
  goal: Infinity,
  minimal: true,
  done: 0,
  total: 0,
  results: null,
  error: null,
  activeTabId: null,
};

/** Portas conectadas do popup (para broadcast de updates). */
const popupPorts = new Set();

function broadcastUpdate() {
  const snapshot = { type: 'update', state: { ...state, results: undefined } };
  // Não enviamos results no update (pode ser grande). Popup pede via getState.
  for (const port of popupPorts) {
    try { port.postMessage(snapshot); } catch {}
  }
}

function setState(patch) {
  Object.assign(state, patch);
  broadcastUpdate();
}

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
function sendStartWithRetry(tabId, options, attempts = 3) {
  return new Promise((resolve) => {
    const trySend = (left) => {
      chrome.tabs.sendMessage(tabId, { type: 'start', options }, () => {
        if (chrome.runtime.lastError) {
          console.warn('[OLX Scraper] sendMessage falhou:', chrome.runtime.lastError.message);
          if (left > 0) {
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

// ── Descobrir aba ativa (janela do navegador, não do popup) ──
async function getActiveTab() {
  let tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tabs.length) tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

// ── Conexão do popup ─────────────────────────────────────
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'scrape') return;
  popupPorts.add(port);

  // Envia o estado atual assim que o popup abre (re-conexão).
  port.postMessage({ type: 'update', state: { ...state, results: undefined } });

  // Se já completou, manda os results também.
  if (state.status === 'complete' && state.results) {
    port.postMessage({ type: 'complete', results: state.results, count: state.results.length });
  }

  port.onMessage.addListener(async (msg) => {
    if (msg.type === 'start') {
      const tab = await getActiveTab();
      if (!tab?.id) {
        setState({ status: 'error', error: 'Nenhuma aba ativa encontrada.' });
        return;
      }

      // Reset do estado
      setState({
        status: 'scraping',
        phase: 'collect',
        goal: msg.options?.goal ?? Infinity,
        minimal: msg.options?.minimal ?? true,
        done: 0,
        total: 0,
        results: null,
        error: null,
        activeTabId: tab.id,
      });

      const injected = await ensureContentScript(tab.id);
      if (!injected) {
        setState({ status: 'error', error: 'Não foi possível injetar o script. Navegue para uma página do OLX.' });
        return;
      }
      const sent = await sendStartWithRetry(tab.id, msg.options);
      if (!sent) {
        setState({ status: 'error', error: 'Content script não respondeu. Recarregue a página do OLX.' });
      }
    }

    if (msg.type === 'download') {
      try {
        const blob = new Blob([JSON.stringify(msg.results, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const filename = `olx-scraper-${Date.now()}.json`;
        await chrome.downloads.download({ url, filename, conflictAction: 'uniquify' });
        setTimeout(() => URL.revokeObjectURL(url), 10000);
      } catch (err) {
        port.postMessage({ type: 'error', message: `Falha ao baixar: ${err.message}` });
      }
    }

    if (msg.type === 'getState') {
      // Popup pede results completos (ex: para download/copy após reconexão)
      port.postMessage({
        type: 'stateSnapshot',
        state: { ...state },
      });
    }

    if (msg.type === 'getHistory') {
      chrome.storage.local.get(HISTORY_KEY, (d) => {
        port.postMessage({ type: 'historyList', list: d[HISTORY_KEY] || [] });
      });
    }

    if (msg.type === 'deleteHistory') {
      chrome.storage.local.get(HISTORY_KEY, async (d) => {
        const list = (d[HISTORY_KEY] || []).filter((e) => e.id !== msg.id);
        await chrome.storage.local.set({ [HISTORY_KEY]: list });
        port.postMessage({ type: 'historyList', list });
      });
    }
  });

  port.onDisconnect.addListener(() => {
    popupPorts.delete(port);
  });
});

// ── Histórico de extrações (persistido em chrome.storage.local) ──
const HISTORY_KEY = 'olxHistory';
const HISTORY_CAP = 50;

async function saveHistoryEntry(count, goal, results) {
  const { [HISTORY_KEY]: list = [] } = await chrome.storage.local.get(HISTORY_KEY);
  list.unshift({
    id: Date.now().toString(),
    ts: Date.now(),
    goal,
    count,
    minimal: state.minimal,
    results,
  });
  while (list.length > HISTORY_CAP) list.pop();
  await chrome.storage.local.set({ [HISTORY_KEY]: list });
}

// ── Mensagens do content script ──────────────────────────
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!sender.tab) return;

  if (msg.type === 'collectprogress') {
    setState({ phase: 'collect', done: msg.done, total: msg.total });
  } else if (msg.type === 'progress') {
    setState({ phase: 'details', done: msg.done, total: msg.total });
  } else if (msg.type === 'complete') {
    setState({
      status: 'complete',
      phase: null,
      results: msg.results,
      done: msg.count,
      total: msg.count,
    });
    saveHistoryEntry(msg.count, state.goal, msg.results);
  } else if (msg.type === 'error') {
    setState({ status: 'error', error: msg.message });
  }
});
