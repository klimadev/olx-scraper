// == OLX Scraper — Popup ==

// ── State ────────────────────────────────────────────────
const STATE = { IDLE: 'idle', SCRAPING: 'scraping', COMPLETE: 'complete', ERROR: 'error' };
let currentState = STATE.IDLE;
let port = null;
let lastResults = null;

// ── DOM refs ─────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const show = (el) => el.classList.remove('hidden');
const hide = (el) => el.classList.add('hidden');

const form = $('scrape-form');
const btnExtract = $('btn-extract');
const formError = $('form-error');

const notOlx = $('not-olx');
const stateIdle = $('state-idle');
const stateScraping = $('state-scraping');
const stateComplete = $('state-complete');
const stateError = $('state-error');

const progressBar = $('progress-bar');
const progressCount = $('progress-count');

const resultCount = $('result-count');
const previewBody = $('preview-body');
const copyFeedback = $('copy-feedback');

const errorMessage = $('error-message');
const btnRetry = $('btn-retry');
const btnDownload = $('btn-download');
const btnCopy = $('btn-copy');
const btnNew = $('btn-new');

// ── Save / Load settings ─────────────────────────────────
const SETTINGS_KEYS = ['goal', 'offset', 'minimal', 'batchSize', 'timeout'];

function loadSettings() {
  chrome.storage.sync.get(SETTINGS_KEYS, (saved) => {
    SETTINGS_KEYS.forEach(key => {
      const el = $(key);
      if (!el) return;
      if (el.type === 'checkbox') {
        el.checked = saved[key] !== undefined ? saved[key] : true;
      } else {
        el.value = saved[key] !== undefined ? saved[key] : el.dataset.default ?? el.value;
      }
    });
  });
}

function saveSettings() {
  const data = {};
  SETTINGS_KEYS.forEach(key => {
    const el = $(key);
    if (!el) return;
    data[key] = el.type === 'checkbox' ? el.checked : Number(el.value) || '';
  });
  chrome.storage.sync.set(data);
}

// Auto-save on change
SETTINGS_KEYS.forEach(key => {
  const el = $(key);
  if (el) el.addEventListener('input', saveSettings);
});

// ── Validate form ────────────────────────────────────────
function validateForm() {
  const goal = parseInt($('goal').value);
  const batchSize = parseInt($('batchSize').value);
  const timeout = parseInt($('timeout').value);

  if (goal && goal < 1) { showFormError('Objetivo deve ser ≥ 1'); return false; }
  if (!batchSize || batchSize < 1) { showFormError('Lote deve ser ≥ 1'); return false; }
  if (!timeout || timeout < 1000) { showFormError('Timeout mínimo é 1000ms'); return false; }
  if (timeout > 120000) { showFormError('Timeout máximo é 120000ms'); return false; }

  hideFormError();
  return true;
}

function showFormError(msg) {
  formError.textContent = msg;
  show(formError);
}

function hideFormError() {
  hide(formError);
}

// ── State switching ──────────────────────────────────────
function setUIState(state) {
  currentState = state;
  [notOlx, stateIdle, stateScraping, stateComplete, stateError].forEach(hide);

  switch (state) {
    case STATE.IDLE:
      show(stateIdle);
      btnExtract.disabled = false;
      btnExtract.textContent = 'Extrair';
      break;
    case STATE.SCRAPING:
      show(stateScraping);
      btnExtract.disabled = true;
      btnExtract.textContent = 'Extraindo...';
      break;
    case STATE.COMPLETE:
      show(stateComplete);
      break;
    case STATE.ERROR:
      show(stateError);
      btnExtract.disabled = false;
      btnExtract.textContent = 'Extrair';
      break;
  }
}

// ── Check if on OLX ──────────────────────────────────────
async function checkIsOlx() {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = tabs[0]?.url || '';
    if (!url.includes('olx.com.br')) {
      show(notOlx);
      hide(stateIdle);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

// ── Connect & sync state with background ───────────────
// O scraping vive no background; o popup apenas se conecta como viewer.
// Se o popup fechar e reabrir, ele reconecta e vê o progresso atual.
function connectPort() {
  port = chrome.runtime.connect({ name: 'scrape' });

  port.onMessage.addListener((msg) => {
    switch (msg.type) {
      case 'update':
        // Snapshot do estado (sem results). Sincroniza a UI.
        syncUIFromState(msg.state);
        break;
      case 'complete':
        // Background envia results completos quando completa (ou ao reconectar).
        lastResults = msg.results;
        showComplete(msg.count);
        loadHistory();
        break;
      case 'stateSnapshot':
        // Popup pediu snapshot completo (ex: após reconectar para download).
        if (msg.state.results) {
          lastResults = msg.state.results;
          showComplete(msg.state.results.length);
        }
        syncUIFromState(msg.state);
        break;
      case 'historyList':
        renderHistory(msg.list);
        break;
      case 'error':
        onError(msg.message);
        break;
    }
  });

  port.onDisconnect.addListener(() => { port = null; });
}

function syncUIFromState(s) {
  if (!s) return;
  if (s.status === 'scraping') {
    updateProgress(s.done, s.total, s.phase);
    setUIState(STATE.SCRAPING);
  } else if (s.status === 'complete') {
    if (s.done) updateProgress(s.done, s.total || s.done, s.phase);
    // results não vêm no update; se já temos lastResults, mostra.
    if (lastResults) showComplete(lastResults.length);
    else setUIState(STATE.COMPLETE);
  } else if (s.status === 'error') {
    onError(s.error);
  }
}

function startScraping(options) {
  if (!port) connectPort();
  port.postMessage({ type: 'start', options });
  setUIState(STATE.SCRAPING);
}

// ── Progress ─────────────────────────────────────────────
function updateProgress(done, total, phase) {
  // clamp evita barra >100% quando coleta estoura goal antes do cutoff
  const pct = total > 0 ? Math.round((Math.min(done, total) / total) * 100) : 0;
  progressBar.style.width = `${pct}%`;
  progressCount.textContent = `${done} / ${total}`;

  const label = document.querySelector('.progress-text');
  if (label) {
    label.textContent = phase === 'collect'
      ? 'Coletando anúncios...'
      : 'Buscando detalhes...';
  }
}

// ── Complete ─────────────────────────────────────────────
function showComplete(count) {
  if (!lastResults) { setUIState(STATE.COMPLETE); return; }
  resultCount.textContent = `${count} anúncio${count !== 1 ? 's' : ''} extraído${count !== 1 ? 's' : ''}`;

  // Preview: primeiros 5
  previewBody.innerHTML = '';
  const preview = lastResults.slice(0, 5);
  preview.forEach(ad => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td title="${escapeHtml(ad.title)}">${escapeHtml(truncate(ad.title, 30))}</td>
      <td>${escapeHtml(ad.price)}</td>
      <td title="${escapeHtml(ad.location)}">${escapeHtml(truncate(ad.location, 20))}</td>
    `;
    previewBody.appendChild(tr);
  });

  setUIState(STATE.COMPLETE);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function truncate(str, max) {
  return str.length > max ? str.slice(0, max) + '…' : str;
}

// ── Error ────────────────────────────────────────────────
function onError(msg) {
  errorMessage.textContent = msg || 'Erro desconhecido durante extração.';
  setUIState(STATE.ERROR);
}

// ── Download ─────────────────────────────────────────────
function downloadResults() {
  if (!lastResults) return;
  if (!port) connectPort();
  port.postMessage({ type: 'download', results: lastResults });
}

// ── Copy to clipboard ────────────────────────────────────
async function copyResults() {
  if (!lastResults) return;
  try {
    await navigator.clipboard.writeText(JSON.stringify(lastResults, null, 2));
    copyFeedback.textContent = 'Copiado!';
    show(copyFeedback);
    setTimeout(() => hide(copyFeedback), 2000);
  } catch {
    copyFeedback.textContent = 'Falha ao copiar';
    show(copyFeedback);
  }
}

// ── Event listeners ──────────────────────────────────────
form.addEventListener('submit', (e) => {
  e.preventDefault();
  if (!validateForm()) return;

  const options = {
    goal: parseInt($('goal').value) || Infinity,
    offset: parseInt($('offset').value) || 0,
    minimal: $('minimal').checked,
    batchSize: parseInt($('batchSize').value),
    timeout: parseInt($('timeout').value),
  };

  startScraping(options);
});

btnRetry.addEventListener('click', () => {
  setUIState(STATE.IDLE);
});

btnNew.addEventListener('click', () => {
  setUIState(STATE.IDLE);
});

btnDownload.addEventListener('click', downloadResults);
btnCopy.addEventListener('click', copyResults);

// ── Histórico ────────────────────────────────────────────
function loadHistory() {
  if (!port) connectPort();
  port.postMessage({ type: 'getHistory' });
}

function renderHistory(list) {
  const el = $('history-list');
  if (!list.length) {
    el.innerHTML = '<p class="history-empty">Nenhuma extração ainda.</p>';
    return;
  }
  el.innerHTML = list.map(h => {
    const d = new Date(h.ts);
    const label = `${d.toLocaleDateString()} ${d.toLocaleTimeString()}`;
    const goalTxt = h.goal !== Infinity ? `<span class="hi-goal">objetivo ${h.goal}</span>` : '';
    return `
      <div class="history-item" data-id="${escapeHtml(h.id)}">
        <div class="hi-head">
          <span class="hi-meta">${escapeHtml(label)}</span>
          <button class="hi-del" data-id="${escapeHtml(h.id)}" data-act="del" title="Remover">✕</button>
        </div>
        <span class="hi-count">${h.count} anúncio${h.count !== 1 ? 's' : ''}</span>${goalTxt}
        <div class="hi-actions">
          <button class="btn-secondary" data-id="${escapeHtml(h.id)}" data-act="open">Abrir</button>
          <button class="btn-secondary" data-id="${escapeHtml(h.id)}" data-act="dl">Baixar</button>
        </div>
      </div>`;
  }).join('');
}

async function openHistoryItem(id) {
  if (!port) connectPort();
  const list = await new Promise(res =>
    chrome.storage.local.get('olxHistory', d => res(d.olxHistory || [])));
  const item = list.find(e => e.id === id);
  if (!item || !item.results) return;
  lastResults = item.results;
  showComplete(item.results.length);
}

// Delegação de cliques no histórico (Abrir / Baixar / Remover)
$('history-list').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const id = btn.dataset.id;
  const act = btn.dataset.act;
  if (act === 'del') {
    if (port) port.postMessage({ type: 'deleteHistory', id });
  } else if (act === 'open') {
    openHistoryItem(id);
  } else if (act === 'dl') {
    openHistoryItem(id).then(() => downloadResults());
  }
});

// ── Init ─────────────────────────────────────────────────
(async function init() {
  loadSettings();
  // Conecta ao background PRIMEIRO, para receber o estado atual do
  // scraping (pode estar rodando em background mesmo com popup fechado).
  connectPort();
  loadHistory();
  const onOlx = await checkIsOlx();
  if (onOlx) setUIState(STATE.IDLE);
})();
