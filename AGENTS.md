# Centinela: guía para el agente

Filtro de bull puts sobre una lista corta de acciones y ETF de EE. UU. Lee también `LEEME.md` (para el dueño).
Esta guía es corta a propósito: lo que siempre hay que tener presente. El detalle está en `docs/`, y se lee solo lo que toca.

## Dónde mirar según lo que vayas a hacer

| Si vas a… | Lee |
|---|---|
| tocar una cuenta, una regla, el nivel, el error o la historia | `docs/calculo.md` |
| tocar una pantalla, un filtro, una pieza común o un criterio de diseño | `docs/interfaz.md` |
| tocar el barrido, los flujos, los datos, las pruebas, la entrega o el modo ordenador | `docs/operacion.md` |
| añadir algo a `data/`, al registro o a lo que se guarda | la sección Privacidad de abajo, antes que nada |

## Criterio (no negociable)

- Es una herramienta de filtrado. No da órdenes, consejos ni recomendaciones, ni en la interfaz ni en los avisos.
- Todo el texto visible va en español y con su vocabulario: "% abajo", "ancho", "crédito", "% del ancho", "corto / largo", "cobras", "pérdida máx.", "rentabilidad", "prob. de asignación", "favoritos", "interruptores". No introducir jerga nueva (delta 16, POP, IVR…) sin que la pida.
- Números a la española en toda la app y en los avisos: coma decimal, "%" separado por un espacio y punto de millares solo desde cinco cifras (`num` en el motor). Fechas con `labelOf`, dólares con `usd2`. No usar `toFixed` ni `Intl` en `en-US` para texto visible.
- Simple: lo que necesita, ni más ni menos. **Antes de añadir una columna, un filtro o una pantalla, preguntar.**
- Node 22, sin dependencias. No añadir paquetes de npm sin preguntar.
- Hoy solo bull put. Más adelante: iron condor y estrategias bajistas.
- Las reglas de cálculo (crédito a precio natural, prob. de asignación del mercado, prob. máxima como regla del corto, crédito mínimo en dólares por contrato, ancho como máximo, rentabilidad y rentab. esperada, nivel de 0 a 5 y su error) **no se cambian sin preguntar**: están en `docs/calculo.md`.
- Un mismo criterio, en un solo sitio: filtros en `web/filtros.js`, piezas de pantalla en `web/ui.js`, alturas y colores en las variables de `app.css`. Antes de copiar un patrón, comprobar si ya existe (`docs/interfaz.md` §4 y §5).

## Cómo responder al dueño

- Respuesta final de 5 a 8 líneas: primero el resultado (qué se hizo y si está en producción), después lo que el dueño debe saber.
- Nunca se recortan: qué se subió, si pasó la comprobación, lo que no se pudo comprobar y cualquier riesgo o cambio de costumbre (por ejemplo, una orden que cambia).
- No repetir lo que ya se ve en la conversación ni listar "qué cambia" cuando él lo pidió. Sin capturas de pantalla salvo que las pida. El detalle, solo si lo pide.
- No republicar la app de prueba tras cada cambio: solo si lo pide.

## Privacidad (el repositorio es público)

- Nada personal en el repositorio, en `data/`, en los mensajes de commit ni en el registro de Actions: ni reglas, ni favoritos, ni avisos, ni nombres añadidos, ni correos.
- Los commits se firman con una dirección `@users.noreply.github.com` y no llevan enlace de sesión (decisión del dueño, 16 oct); las PR tampoco.
- Las reglas viven en el dispositivo (`localStorage`) y, para los avisos, en el secreto `CENTINELA_CONFIG`. La lista de nombres es pública (`scanner/universe.json`). El estado de los avisos va cifrado en `data/privado.json` con clave derivada de `NTFY_TOPIC` y tamaño fijo.
- En modo `--public` solo se barre la lista base (40 nombres), nunca favoritos ni nombres añadidos, y `scan.json` va por orden alfabético. La lista es pública: antes de añadir o quitar nombres a petición del dueño, avisarle de que el cambio se ve en el repositorio y de que una lista recortada a lo que opera lo delata.
- Qué nombres quita o deja el dueño (`off`) vive solo en `localStorage` y en `CENTINELA_CONFIG`; nunca en el repositorio ni en `data/`. El barrido público sigue leyendo los 40.
- "Mis deals", las acciones marcadas "las que tengo" y los bloques que el dueño marca como ya abiertos viven solo en `localStorage`. No se suben, no entran en `CENTINELA_CONFIG` y no se escriben en ningún archivo. La app no envía órdenes ni sabe qué bróker usa.
- La copia de seguridad ("Tus datos" en Reglas) es un texto que el dueño guarda donde quiera: no se sube a ningún sitio y nunca incluye la llave de GitHub ni el puente (`copia.js`, con prueba).
- Lo que cambia el dueño en el modo ordenador va a `config.local.json` (git lo ignora); `config.json` es solo de fábrica y no debe llegar con datos del dueño.
- La app no debe pedir nada a otros sitios al abrirla: las fuentes son propias (`web/fonts/`) y una prueba de pantalla lo vigila. El servidor del ordenador solo escucha en `127.0.0.1` salvo con `--lan`, y rechaza otros `Host` y otros `Origin` (`docs/operacion.md` §6).
- Las pruebas y los flujos de pruebas no usan secretos ni red.
- Antes de añadir cualquier archivo a `data/` o cualquier línea al registro, comprobar que no depende de la configuración personal.

## Comandos de cada día

```
bash scripts/entrega.sh "mensaje"   # comprueba, prueba lo que toca, commit y sube
npm test                            # motor + pantallas; npm run test:motor, solo el motor (1 s)
npm run ejemplo                     # app con datos de ejemplo en http://localhost:8080 (bash scripts/ejemplo-fondo.sh: solo si no corre ya)
node scripts/ver.mjs --pestana Buscador --medir '.fi-f'   # mirar la app como un móvil, sin escribir un script nuevo
```

Probar con la muestra y las pruebas, no con barridos reales. Agrupar los cambios en un solo envío. A producción: `bash scripts/produccion.sh`, PR a `main`, fusión con rebase y `bash scripts/esperar-ci.sh pr|main <sha>`; después `bash scripts/produccion.sh reiniciar` (`docs/operacion.md` §2).

## Mapa de archivos

- `web/`: la app, sin framework. `app.js` (arranque y eventos), `hoy.js` + `hoy-vistas.js` + `hoy-calc.js` (Hoy y la ficha), `buscador.js`, `reglas.js`, `avisos.js`, `conexion.js`, `copia.js` (copia de seguridad), `filtros.js` y `ui.js` (piezas comunes), `engine.js` (motor puro, compartido con el barrido; las estrategias se registran en `STRATEGIES`, hoy solo `bullPut`), `sw.js` (offline), `app.css`, `fonts/`. Al añadir un archivo: ponerlo en `SHELL` de `sw.js` y subir `CACHE`.
- `scanner/`: `scan.mjs` (barrido, avisos por ntfy y servidor local), `cierres.mjs` (histórico de 5 años), `universe.json` (la lista base).
- `.github/workflows/`: `publicar.yml`, `pruebas.yml`, `barrido.yml`, `cierres.yml`. `scripts/`: `rama.sh` (publica en `gh-pages`), `entrega.sh`, `produccion.sh`, `esperar-ci.sh`, `ver.mjs`, `ejemplo-fondo.sh` y `playwright.mjs`.
- `config.json` (reglas de fábrica) y `config.local.json` (el dueño, ignorado por git). `test/`: `engine.test.mjs` y `ui.test.mjs`. `docs/`: el detalle.

## Estado

En marcha en GitHub con un solo repositorio público. El barrido de la lista base tarda segundos. Detalles de datos y límites (CBOE 429, símbolos con punto) en `docs/operacion.md` §5. La app tiene además un modo con repositorio privado y llave que hoy no se usa, y una versión de prueba con datos incrustados.

## Pendiente

- Ex-dividendo.
- IV frente a su propia historia (el barrido guarda la IV diaria en `data/iv.json` desde el 4 oct; hacen falta unos 3 meses de datos para que signifique algo).
- Convertir la media de 50 días y la caída en 5 sesiones en avisos o filtros, si el dueño lo pide (hoy son solo informativas).
- Guardar calls para iron condor y estrategias bajistas.
- Ampliar `FED_DATES` y la tabla de festivos antes de que se acaben (`docs/calculo.md` §3).

## Cómo mantener esta guía

- Esta guía y `docs/` se actualizan con cada cambio que cambie un criterio, un nombre o un comportamiento; si algo ya no es cierto, se corrige o se quita, no se añade otra frase debajo.
- Una idea por línea; lo que cambia con el tiempo (cifras, listas) va en `docs/`, no aquí.
- Cada `docs/*.md` debería leerse en un minuto: si crece, se parte por tema.
