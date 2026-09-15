# Indicators of compromise / Indicadores de compromiso

Extension `{2dcb0f8a-f9de-4b46-899b-e11f8efc92f4}` version 2.1.9.

## Network

| Type | Value |
|---|---|
| Redirector | `https://bit.ly/release_note_for_claude` |
| C2 / configuration host | `https://stable-channel.zeabur.app/?j=release_note` |
| C2 DNS (2026-09-15) | `170.106.136.109` |
| Exfiltration endpoint | `https://kmn6d3go6kuodubmfoiawcstl40ukbqb.lambda-url.us-west-2.on.aws/` |
| Poll interval | 480 s |

Domains only:

```
bit.ly
stable-channel.zeabur.app
kmn6d3go6kuodubmfoiawcstl40ukbqb.lambda-url.us-west-2.on.aws
```

## Request markers

| Parameter | Value | Meaning |
|---|---|---|
| `r` | `searchContextWarmup` | fixed request marker |
| `i` | `MGNsYXU=` | campaign identifier, base64 of `0clau` |
| `u` | base64 | origin being reported |

Full request shape:

```
https://kmn6d3go6kuodubmfoiawcstl40ukbqb.lambda-url.us-west-2.on.aws/?r=searchContextWarmup&i=MGNsYXU=&u=<base64(origin)>
```

## Host artefacts

| Type | Value |
|---|---|
| Extension ID | `{2dcb0f8a-f9de-4b46-899b-e11f8efc92f4}` |
| Package filename | `default_claude_ai-2.1.9.xpi` |
| AMO file id | `4946688` |
| `declarativeNetRequest` dynamic rule id | `17391` |
| storage.local key (config) | `claudeSearchRemoteCfg` |
| storage.local key (visit stats) | `claudeSearchVisitStats` |

Cookies deposited (values are per-installation identifiers and are intentionally omitted):

```
.bit.ly                     _bit
stable-channel.zeabur.app   v
stable-channel.zeabur.app   ts
```

`ts` holds a server-side unix timestamp rewritten on every poll; it doubles as a last-seen marker.

## Hashes

| File | SHA-256 |
|---|---|
| `default_claude_ai-2.1.9.xpi` | `dffd082ebeed92bf05a17cd05061198d5e6822b2179eb8c5d8fc1612eb526946` |
| `background.js` | `007ba7ff2444cab8355bf08877460d4f4892de1b53d1074d682cc27976061f08` |
| `content.js` | `d0ee71e3c12c905a8109829fbe4068def4a99704b57eaf00ac3e5b7b6470dde8` |
| `manifest.json` | `a585c3328c13c2fa3645ae96ad0b08d6b507f2456df3c28dde8f7b00b205f6a8` |

## Configuration values observed

Shipped decoy:

```json
{"engineLabel":"Claude","omniboxToken":"claude","preferDefault":true,
 "h":["x-claude-omnibox-hint","etag-search-claude"],"u":"https://claude.ai/"}
```

Received from C2:

```json
{"h":["content-security-policy","x-frame-options"],
 "u":"https://kmn6d3go6kuodubmfoiawcstl40ukbqb.lambda-url.us-west-2.on.aws/"}
```

## Detection

Profile check:

```sh
grep -rl '2dcb0f8a-f9de-4b46-899b-e11f8efc92f4' \
  ~/.mozilla/firefox/*/extensions.json \
  ~/.config/mozilla/firefox/*/extensions.json 2>/dev/null
```

Residual cookies, with Firefox closed:

```sh
sqlite3 <profile>/cookies.sqlite \
  "SELECT host,name FROM moz_cookies
   WHERE host LIKE '%zeabur%' OR host LIKE '%bit.ly%' OR host LIKE '%lambda-url%';"
```

Leftover network rules — this directory must be empty after removal:

```sh
ls <profile>/extension-dnr/
```

Network-side, alert on any request carrying `r=searchContextWarmup` or `i=MGNsYXU=`, and on traffic to
the three domains listed above.
