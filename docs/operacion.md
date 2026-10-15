# Operación: datos, barrido, despliegue, pruebas y modo ordenador

Cómo se ejecuta, de dónde salen los datos y cómo llega la app a GitHub Pages. Las cuentas están en `docs/calculo.md`; la interfaz, en `docs/interfaz.md`.

## 1. Cómo se ejecuta

Node 22, **sin dependencias**. No añadir paquetes de npm sin preguntar.

```
npm test                         # motor + pantallas (Playwright y Chromium; sin ellos, las de pantallas se saltan)
npm run test:motor               # solo el motor, en un segundo
npm run ejemplo                  # app con cadenas inventadas en http://localhost:8080
node scanner/scan.mjs --limit 20 # barrido real de 20 nombres, escribe en out/data
node scanner/scan.mjs --serve    # barrido real completo + app en http://localhost:8080
npm run ordenador:movil          # igual, abierto a la red local (para el móvil)
bash scripts/ejemplo-fondo.sh    # deja la app de ejemplo corriendo (solo si no lo está) y espera a que responda
node scripts/ver.mjs …           # mirar la app como un móvil: errores, desbordes, medidas y textos
```

El barrido real necesita salida a internet hacia `cdn.cboe.com`, `cdn-api.cboe.com`, `stockanalysis.com`, `raw.githubusercontent.com` y, para los avisos, `ntfy.sh`.

**Cómo probar sin esperar:** con la muestra y las pruebas, no con barridos reales: `npm test`, `npm run ejemplo` y `node scanner/scan.mjs --public --fixtures test/fixtures --out /tmp/x`. Agrupar los cambios en un solo envío.

## 2. Pruebas y entrega

- **Motor** (`test/engine.test.mjs`, menos de 1 s): las cuentas, las reglas, el servidor (`hostAllowed`, `originAllowed`).
- **Pantallas** (`test/ui.test.mjs`, ~50 s): abren la app con datos de ejemplo en 360 y 390 px (desbordes, errores de consola, orden de filtros, plegables, vacíos, recuentos en una línea, alturas, Reglas y Avisos, pestaña recordada y aviso sin conexión, barras de Hoy y del Buscador, privacidad: ninguna petición a otro sitio y fuentes propias; servidor: rechaza otros `Host` y `Origin`). Arrancan su propio servidor en otro puerto y dejan `config.json` y `config.local.json` como estaban.
- **GitHub:** `pruebas.yml` corre `npm test` (Playwright y Chromium instalados al vuelo; `PRUEBAS_EXIGENTES=1` para que no se salte ninguna) en cada PR, y `publicar.yml` la llama antes de publicar: si fallan, no se publica. Para publicar sin pruebas en una emergencia: ejecutar "Publicar" a mano con `sin_pruebas`. Las pruebas no usan secretos ni red.
- **Entregar un cambio:** `bash scripts/entrega.sh "mensaje"` (con `CLAUDE_SESSION_URL` para el trailer). Comprueba la sintaxis, elige las pruebas según lo cambiado (motor si tocas `scanner/` o `engine.js`; pantallas si tocas `web/`; ninguna si solo es texto), restaura `config.json`, hace el commit y sube refrescando la referencia remota (así el hook de git no da el falso "commits sin subir"). `TESTS=todo|motor|ui|nada` fuerza qué pruebas; `SIN_SUBIR=1` solo commit. Antes de subir a producción: `TESTS=todo`.
- **Mirar la app sin escribir un script cada vez:** `node scripts/ver.mjs --pestana Buscador --clic '[data-bs=filters-open]' --medir '.fi-f' --texto '#bs-bar' --ancho 360,390`. Imprime por cada ancho si desborda, los errores de consola y lo que se pida (`--medir` alto×ancho y texto, `--texto`, `--contar`; pasos `--clic`, `--escribir SEL=texto`, `--barra SEL=valor`, `--esperar ms`). Arranca la app de ejemplo si no está. Sale con código 1 si desborda o hay errores. `scripts/playwright.mjs` es lo que encuentra Playwright y Chromium (lo comparten las pruebas y `ver.mjs`).
- **A producción:** (1) `bash scripts/produccion.sh` (rebasa la rama sobre `main`, comprueba la sintaxis, corre el motor y sube con `--force-with-lease`; `COMPLETO=1` añade las pruebas de pantalla, que si no corre GitHub); (2) PR de la rama a `main` y fusión con rebase (herramientas de GitHub; `expectedHeadSha` = el SHA completo que imprimió); (3) `bash scripts/esperar-ci.sh pr <sha>` antes de fusionar y `bash scripts/esperar-ci.sh main <sha>` después, que esperan y dicen el resultado en una línea (un cambio que no toque `web/` no activa "Publicar" y lo dice); (4) `bash scripts/produccion.sh reiniciar` deja la rama igual que `main`. Rebasar es necesario: al fusionar con rebase, `main` tiene copias nuevas de los commits y la rama sigue con los viejos, y sin rebasar la PR sale con conflicto.

## 3. Estructura del repositorio

- `web/`: la app (ver `docs/interfaz.md` §2). Instalable: `manifest.webmanifest`, `sw.js`, `icons/`. Las fuentes (IBM Plex Sans y Newsreader, subconjunto latino, licencia OFL) están en `web/fonts/` y se cargan con `@font-face` desde `app.css`.
- `web/sw.js`: primero la red y, sin conexión, la última copia guardada. Pide siempre a la red con `cache: "no-cache"`: GitHub Pages sirve con 10 minutos de caché y, sin eso, una versión recién publicada no aparece al recargar.
- `scanner/scan.mjs`: lee CBOE, guarda `data/scan.json`, lleva el estado entre barridos y envía avisos por ntfy. `--serve` añade un servidor local con `/api/config`.
- `scanner/universe.json`: la lista base, genérica: 33 nombres con opciones líquidas, cada uno con su bloque. Es lo único que se barre y lo que enseña la app, entera. Un índice (XSP, Mini-SPX: europeas, liquidación en efectivo, sin asignación) lleva `c` (código en CBOE, `_XSP`) y `r` (raíces de sus contratos: `XSP` mensuales y `XSPW` semanales). `loadUniverse` las guarda en `feeds`, `fetchChain` pide `c`, `readCboeChain(…, roots)` lee las dos raíces y `cierres.mjs` pide la historia con `c` y la guarda con el símbolo de la app. Sin `c`, el código es el símbolo. Si CBOE no lo tuviera, el barrido lo dice en el motivo ("CBOE no tiene ese símbolo"). Va como `etf` (sin consulta de resultados).
- `config.json`: reglas de fábrica (públicas). `config.local.json`: lo que guarda el dueño en el modo ordenador, ignorado por git (nunca en el repositorio). Solo se usan en el modo ordenador.
- `scripts/rama.sh`: escribe en `gh-pages` solo su parte (`app` = todo menos `data/` e `historia/`; `datos` = solo `data/`; `historia` = solo `historia/`), con un único commit en la rama y reintento si el otro ha publicado entre medias.
- `scripts/entrega.sh`, `scripts/produccion.sh`, `scripts/esperar-ci.sh`, `scripts/ver.mjs`, `scripts/ejemplo-fondo.sh`, `scripts/playwright.mjs`: ver §2.

## 4. Flujos de GitHub Actions

- **`publicar.yml`:** en cada push a `main` que toque `web/` (o `scripts/rama.sh`, o sus propios flujos), corre `pruebas.yml` y publica la app. No barre.
- **`pruebas.yml`:** ver §2.
- **`barrido.yml`:** solo por horario (cada media hora en horario de mercado, lunes a viernes) o a mano. Barre la lista base con `--public` a `data/scan.json`. Un barrido con el mercado cerrado (`pricesOutsideMarket`, contando los 15 min de retraso) no sustituye al guardado si este es de mercado abierto: `keepPrevious` en `scan.mjs` sale sin barrer ni escribir, deja `saltado=1` y el paso de guardar no se ejecuta. A mano, la casilla `reemplazar` (`--reemplazar`) fuerza el barrido. Sin barrido anterior, o si el guardado ya es de mercado cerrado, se barre. Cada barrido deja un resumen en Actions.
- **`cierres.yml` y `scanner/cierres.mjs`:** cada mañana de lunes a viernes, antes de la apertura (12:23 UTC y, de repuesto, 13:03; CBOE publica el cierre de un día a la mañana siguiente, no la misma noche) o a mano, nunca por push ni en cada barrido. Baja del histórico de CBOE los cierres de 5 años de la lista base y escribe `historia/cierres.json` (`{at, last, symbols: {SIMBOLO: {d, c}}}`) e `historia/version.json`. Antes de los controles recompone los splits que la fuente deja sin ajustar en un tramo (`repairSplits`: un salto mayor del 40 % que es un múltiplo casi exacto, ±8 %, reescala los cierres anteriores a la escala de hoy; pasó con XLE y XLU). Controles: último cierre con 4 sesiones o menos, ningún salto diario mayor del 40 %; se descarta lo anterior a un hueco de más de 10 días y a la fecha de `DESDE` (IBIT). Si un control falla no publica y queda el archivo anterior. No lee secretos ni configuración.
- **`data/version.json`:** hora de `scan.json`. La app guarda el barrido en el dispositivo (Cache API), lo enseña al abrir y solo lo descarga cuando ha cambiado.

## 5. Datos

- **CBOE, 15 min de retraso:** `https://cdn.cboe.com/api/global/delayed_quotes/options/SIMBOLO.json`. De `data` se usan `current_price`, `price_change_percent`, `iv30`, `last_trade_time`, `security_type` y `options[]` con `option` (símbolo OCC), `bid`, `ask`, `iv`, `delta`, `open_interest`.
- **Histórico de CBOE:** `https://cdn.cboe.com/api/global/delayed_quotes/charts/historical/SIMBOLO.json` (redirige a `cdn-api.cboe.com`). `data[]` con `date` y `close`, ajustado por splits salvo algún tramo reciente (ver `repairSplits`). Se usa el cierre sin sumar dividendos.
- **StockAnalysis:** próxima fecha de resultados por símbolo, con caché de 3 días en el estado.
- **`data/scan.json`:** `blocks` (bloques en orden) y, por nombre, `{s, n, k, b, p, c, iv30, er, x}` (`b` es el bloque), donde `x` es una lista de `[vencimiento, iv al dinero, filas]` y cada fila es `[strike, bid, ask, interés abierto, iv, delta]`. Solo puts por debajo del precio. Va por orden alfabético.
- **`data/iv.json`:** la IV diaria que ya guarda el barrido.
- CBOE contesta 429 por encima de más o menos una petición por segundo; `getJson` lleva un freno compartido que se ajusta solo. Los símbolos con punto se piden con el punto.

## 6. Modo ordenador (`scan.mjs --serve`)

- Solo escucha en `127.0.0.1`. `--lan` (`npm run ordenador:movil`) lo abre a la red local y avisa de que cualquiera en ese Wi-Fi puede ver y cambiar las reglas.
- En los dos casos rechaza (403) cualquier `Host` que no sea localhost o, con `--lan`, una IP privada (10.x, 192.168.x, 172.16–31.x, 169.254.x) o un nombre `.local`, y cualquier escritura (`POST`) con `Origin` de otra página (`hostAllowed` / `originAllowed`, con prueba).
- Lo que cambia el dueño en la app (reglas, nombres quitados) se guarda en `config.local.json`; `config.json` queda con los de fábrica.

## 7. Otros modos

- **Repositorio privado con llave** (`ghBlock`, `ghJson`): hoy no se usa.
- **Versión de prueba** con datos incrustados (`window.__CENTINELA__`): la app funciona sin leer de la red. La página que la incrusta puede traer su propia fuente de datos asignando `extraSource`; ese código no vive en este repositorio. Los proxies públicos de datos (`allorigins`, `corsproxy`, `codetabs`) solo se usan en esta versión, nunca en la app publicada.
