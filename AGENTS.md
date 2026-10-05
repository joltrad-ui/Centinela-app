# Centinela: guía para el agente

Filtro de bull puts sobre un universo de acciones y ETF de EE. UU. Lee también `LEEME.md`.

## Criterio (no negociable)

- Es una herramienta de filtrado. No da órdenes, consejos ni recomendaciones, ni en la interfaz ni en los avisos.
- Todo el texto visible va en español y con su vocabulario: "% abajo", "ancho", "crédito", "% del ancho", "corto / largo", "cobras", "pérdida máx.", "rentabilidad", "prob. de asignación", "favoritos", "interruptores". No introducir jerga nueva (delta 16, POP, IVR…) sin que la pida.
- Simple: lo que necesita, ni más ni menos. Antes de añadir una columna, un filtro o una pantalla, preguntar.
- Hoy solo bull put. Más adelante: iron condor y estrategias bajistas.
- Orden por defecto: equilibrio entre baja probabilidad de asignación y buena rentabilidad.

## Cómo se ejecuta

Node 22, sin dependencias. No añadir paquetes de npm sin preguntar.

```
npm test                         # pruebas del motor
npm run ejemplo                  # app con cadenas inventadas en http://localhost:8080
node scanner/scan.mjs --limit 20 # barrido real de 20 nombres, escribe en out/data
node scanner/scan.mjs --serve    # barrido real completo + app en http://localhost:8080
```

El barrido real necesita salida a internet hacia: `cdn.cboe.com`, `cdn-api.cboe.com`, `stockanalysis.com`, `raw.githubusercontent.com` y, para los avisos, `ntfy.sh`.

## Estructura

- `web/engine.js`: motor puro, compartido por la app y el barrido. Reglas, construcción de spreads, columnas, orden, embudo. Las estrategias se registran en `STRATEGIES`; hoy solo `bullPut`.
- `web/app.js`, `web/app.css`, `web/index.html`: app sin framework, cinco pantallas (Universo, Favoritos, Deals, Avisos, Reglas). Instalable (manifest y `sw.js`).
- `scanner/scan.mjs`: lee CBOE, guarda `data/scan.json`, lleva el estado entre barridos y envía avisos por ntfy. `--serve` añade un servidor local con `/api/config`.
- `scanner/universe.json`: lista de reserva (S&P 500, Nasdaq 100, ETF).
- `config.json`: reglas de fábrica; solo se usa en el modo ordenador.
- `.github/workflows/barrido.yml`: barrido cada media hora en horario de mercado, con `--public`. Publica `web/` y `data/` juntos en la rama `gh-pages`. Un cambio que solo toca `web/` se publica sin volver a barrer.

## Privacidad (el repositorio es público)

- Nada personal en el repositorio, en `data/`, en los mensajes de commit ni en el registro de Actions: ni reglas, ni favoritos, ni avisos, ni nombres añadidos, ni correos.
- Los commits se firman con una dirección `@users.noreply.github.com`.
- Reglas y favoritos viven en el dispositivo (`localStorage`) y, para los avisos, en el secreto `CENTINELA_CONFIG`. El estado de los avisos va cifrado en `data/privado.json` con clave derivada de `NTFY_TOPIC` y tamaño fijo.
- En modo `--public` el universo no incluye favoritos ni nombres añadidos, y `scan.json` va por orden alfabético.
- Antes de añadir cualquier archivo a `data/` o cualquier línea al registro, comprobar que no depende de la configuración personal.

## Datos

- CBOE, 15 min de retraso: `https://cdn.cboe.com/api/global/delayed_quotes/options/SIMBOLO.json`. De `data` se usan `current_price`, `price_change_percent`, `iv30`, `last_trade_time`, `security_type` y `options[]` con `option` (símbolo OCC), `bid`, `ask`, `iv`, `delta`, `open_interest`.
- StockAnalysis: próxima fecha de resultados por símbolo, con caché de 3 días en el estado.
- `data/scan.json`, por nombre: `{s, n, k, p, c, iv30, er, x}`, donde `x` es una lista de `[vencimiento, iv al dinero, filas]` y cada fila es `[strike, bid, ask, interés abierto, iv, delta]`. Solo puts por debajo del precio.

## Reglas de cálculo que no se cambian sin preguntar

- Crédito a precio natural: bid del corto menos ask del largo.
- Prob. de asignación: la que descuenta el mercado, sacada del precio de los strikes vecinos a precio medio y alisada para que no baje al subir el strike (`marketProbs`). Si no se puede medir, la fórmula con la IV del strike (`probBelow`), y el spread lo marca con `probSrc: "formula"`.
- La prob. de asignación máxima es la regla que elige el corto (10 % de fábrica, 50 = sin límite). El % abajo es columna y regla opcional (`otmOn`). El crédito mínimo va en dólares por contrato (`minCredit`), no en % del ancho: esa regla forzaba una probabilidad de pérdida mínima. Las reglas llevan versión (`v: 2`); las guardadas sin ella se migran en `normalizeRules`.
- Rentabilidad: crédito / pérdida máxima. Equilibrio: ganancia esperada / pérdida esperada = rentabilidad × (100 − prob.) / prob. (`balanceOf`). Hay una regla de equilibrio mínimo (`minBalance`, 0,5 por defecto, 0 = sin mínimo).
- El ancho de las reglas es un máximo: para cada corto se consideran todos los largos que dejan ese ancho o menos.
- Un aviso por nombre y día. El primer barrido solo toma nota. Con el mercado cerrado no se avisa.
- Si el estado anterior no se puede leer (salvo 404), el barrido falla en vez de sobrescribir.

## Estado

En marcha en GitHub con un solo repositorio público. El barrido real lee 548 de 550 nombres en unos 8,5 minutos. CBOE contesta 429 por encima de más o menos una petición por segundo; `getJson` lleva un freno compartido que se ajusta solo. Los símbolos con punto (BRK.B) se piden con el punto.

La app tiene además un modo con repositorio privado y llave (`ghBlock`, `ghJson`), que hoy no se usa.

Con datos incrustados (`window.__CENTINELA__`) la app funciona como versión de prueba. La página que la incrusta puede traer su propia fuente de datos asignando `extraSource`; ese código no vive en este repositorio.

## Pendiente

- Media de 50 días, caída en 5 sesiones y gráfico de precio (en el Centinela original venían de Yahoo).
- Ex-dividendo.
- Filtro por volatilidad respecto a su historia (el barrido ya guarda la IV diaria en `data/iv.json`).
- Guardar calls para iron condor y estrategias bajistas.
