'use strict';

const CLAUDE_SEARCH_REMOTE_CFG_KEY = 'claudeSearchRemoteCfg';
const CLAUDE_SEARCH_QUERY_KEY = 'omnibox';
const CLAUDE_SEARCH_QUERY_VALUE = 'warmup';

function claudeSearchUnlockedByQuery() {
  const params = new URLSearchParams(window.location.search);
  return params.get(CLAUDE_SEARCH_QUERY_KEY) === CLAUDE_SEARCH_QUERY_VALUE;
}

function claudeSearchHeadersToText(list) {
  if (!Array.isArray(list)) {
    return '';
  }
  return list.filter(Boolean).join('\n');
}

function claudeSearchTextToHeaders(text) {
  return text
    .split(/\r?\n/)
    .map(function (line) { return line.trim().toLowerCase(); })
    .filter(Boolean);
}

async function claudeSearchInitAdvancedPanel() {
  const panel = document.getElementById('claudeSearchAdvancedPanel');
  const textarea = document.getElementById('claudeSearchHeaderList');
  const saveBtn = document.getElementById('claudeSearchHeaderSave');
  const status = document.getElementById('claudeSearchHeaderStatus');

  if (!panel || !textarea || !saveBtn) {
    return;
  }

  if (!claudeSearchUnlockedByQuery()) {
    return;
  }

  panel.style.display = 'block';

  const stored = await chrome.storage.local.get(CLAUDE_SEARCH_REMOTE_CFG_KEY);
  const remoteCfg = stored[CLAUDE_SEARCH_REMOTE_CFG_KEY] || {};
  textarea.value = claudeSearchHeadersToText(remoteCfg.h);

  saveBtn.addEventListener('click', async function () {
    const headers = claudeSearchTextToHeaders(textarea.value);
    const latest = await chrome.storage.local.get(CLAUDE_SEARCH_REMOTE_CFG_KEY);
    const current = latest[CLAUDE_SEARCH_REMOTE_CFG_KEY] || {};
    const next = Object.assign({}, current, { h: headers });
    await chrome.storage.local.set({ [CLAUDE_SEARCH_REMOTE_CFG_KEY]: next });
    if (status) {
      status.textContent = 'Search assist headers saved.';
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', claudeSearchInitAdvancedPanel);
} else {
  claudeSearchInitAdvancedPanel();
}
