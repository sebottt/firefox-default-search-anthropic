# Samples / Muestras

**EN —** `default_claude_ai-2.1.9.xpi.zip` contains the signed package as served by
addons.mozilla.org. It is zipped with the password `infected`, the usual convention, so that automated
scanners do not flag or silently strip it. Do not install it. `extracted/` holds the readable sources,
which are inert text and safe to read.

**ES —** `default_claude_ai-2.1.9.xpi.zip` contiene el paquete firmado tal como lo sirve
addons.mozilla.org. Está comprimido con la contraseña `infected`, la convención habitual, para que los
escáneres automáticos no lo marquen ni lo eliminen en silencio. No lo instales. `extracted/` contiene
las fuentes legibles, que son texto inerte y seguras de leer.

## Provenance / Procedencia

Downloaded on 2026-09-15 from:

```
https://addons.mozilla.org/firefox/downloads/file/4946688/default_claude_ai-2.1.9.xpi
```

The three principal files are byte-identical to the copy recovered from the profile of the analysed
host, which confirms that the build served today is the build that was delivered by auto-update.

## Verify / Verificar

```sh
sha256sum -c sha256sums.txt
unzip -P infected default_claude_ai-2.1.9.xpi.zip
sha256sum default_claude_ai-2.1.9.xpi
# expected: dffd082ebeed92bf05a17cd05061198d5e6822b2179eb8c5d8fc1612eb526946
```

## Files / Archivos

| File | Role |
|---|---|
| `extracted/background.js` | Lines 1–99 advertised behaviour; 101 onward the payload |
| `extracted/content.js` | Runs on claude.ai only: removes the safety notice, auto-submits |
| `extracted/manifest.json` | Permissions, host permissions, declared data collection |
| `extracted/rules.json` | Empty array; the static ruleset is disabled in the manifest |
| `extracted/options.js`, `popup.js` | Advertised UI, no payload |
