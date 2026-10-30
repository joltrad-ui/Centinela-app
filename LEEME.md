# Centinela

Filtro de bull puts sobre una lista corta de acciones y ETF de EE. UU. No da órdenes ni consejos: barre, filtra con tus reglas, ordena con tu orden y te avisa.

Los datos de opciones vienen de CBOE con 15 minutos de retraso. Las fechas de resultados, de StockAnalysis.

## Las seis pantallas

- **Hoy** (la que se abre al entrar):
  - **Mapa:** nombres por vencimientos, con un nivel de 0 a 5 por casilla (cuánto tiene a favor ese bull put).
  - **Nube y Barras:** los deals de un vencimiento, para compararlos. Las barras enseñan lo que cobra, lo que se espera pagar y lo que queda con su error.
  - **Ficha:** la de cada deal. Lo que cobras, lo que apartas para pérdidas, lo que te queda, los puntos que dan el nivel, un gráfico del precio con sus medias de 50 y 200 días y el strike, y, al final, todos los deals puntuados del mismo nombre con filtros.
- **Buscador:** todos los bull puts de los 42 nombres de la lista base (incluido XSP, el índice S&P 500 mini, sin asignación), cada nombre con su motivo si no pasa.
  - Caja de búsqueda; quitar y poner acciones una a una y marcar las que ya tienes.
  - Filtros: Nivel, Vence hasta, Ancho hasta y Prob. hasta (barras). En "Más filtros": Margen, Las que tengo y Precio (barras), y Bloque, Ocultar (resultados, tendencia, fuera de Reglas) y Guardados (combinaciones con nombre) como filas plegables. El "?" explica Nivel, Margen y Las que tengo.
  - Cuando no sale nada, te dice qué filtro quitar y cuántos deals saldrían.
  - Volatilidad: IV alta o IV baja frente a lo que el valor se ha movido de verdad.
- **Avisos:** cuándo un nombre de la lista pasa a cumplir tus reglas. Llegan al móvil con la app gratuita ntfy.
- **Mis deals:** donde apuntas lo que abres (o lo que ya tienes en tu bróker) y cómo acabó. Arriba un resumen (abiertos, lo que llevas y lo que pierdes como máximo, con borde rojo si alguno está cerca o por debajo del corto); después una tarjeta compacta por deal, con la distancia del precio al corto y los cuatro números clave (tócala para ver ficha, cerrar o borrar), y los cerrados en una línea cada uno. La app no envía órdenes.
- **Registro:** lo que Centinela ha ido proponiendo, comprobado al vencer. Cada día de mercado, el último barrido guarda los deals de nivel 3 o más (con las reglas de fábrica) en un CSV por mes de la rama de datos (`registro/`), y al vencer se apunta el resultado por contrato. La pestaña enseña cuatro señales (verde, ámbar, rojo o gris con menos de 3 vencimientos mensuales) y tablas por nivel, por desacuerdo y por grupo de correlación. Solo avisa: no cambia ninguna regla.
- **Reglas:** días, probabilidad de asignación máxima (la que elige el corto en cada nombre), ancho máximo, cobro mínimo en dólares, rentab. esperada mínima, % abajo opcional, interruptores, comisión y horquilla, y las reglas del nivel de Hoy (punto de seguridad y error). Aquí también está **Tus datos**: una copia de seguridad, como un texto que guardas tú, de lo que vive solo en tu dispositivo (Mis deals, las que tengo, filtros guardados, reglas). Sirve para cambiar de móvil o por si borras los datos del navegador, y no se sube a ningún sitio.

La lista está en `scanner/universe.json`; para cambiarla se cambia ese archivo.

## Cómo está montado

Un solo repositorio público de GitHub. La app y el barrido se publican juntos en `https://TU-USUARIO.github.io/NOMBRE-DEL-REPOSITORIO/` (rama `gh-pages`), cada uno por su lado:

- **Publicar** (`publicar.yml`): cada cambio en `web/` que llega a `main` publica la app en un par de minutos. No barre nunca.
- **Pruebas** (`pruebas.yml`): corren en cada PR y antes de publicar. Si fallan, no se publica.
- **Barrido** (`barrido.yml`): solo por horario o a mano. Barre la lista base cada media hora en horario de mercado y tarda menos de un minuto; deja un resumen en **Actions** ("Leídos N, sin lectura M" y el motivo).
- Ninguno pisa al otro: publicar solo cambia los archivos de la app y el barrido solo la carpeta `data/`.
- La app guarda el último barrido en el dispositivo: al abrirla lo enseña al momento y solo descarga lo que haya cambiado. Sin conexión, enseña ese último barrido con un aviso.

En repositorios públicos todo esto es gratis y sin límite de minutos.

### Qué es público y qué no

| | Dónde está | ¿Lo ve alguien más? |
|---|---|---|
| El código y la pantalla de la app | Repositorio y página | Sí |
| La lista y su barrido (precios y cadenas de los 42 nombres) | Repositorio y página, carpeta `data/` | Sí. Quien mire el repositorio ve qué nombres sigue la app |
| El registro de deals (`registro/`, CSV por mes) | Rama de datos del repositorio y página | Sí. Son los deals que propone la app con las reglas de fábrica sobre la lista pública: nada de lo que apuntas ni de tus reglas |
| Reglas y orden | En tu dispositivo | No |
| Mis deals, las que tengo, filtros guardados y los bloques que marcas como ya abiertos | En tu dispositivo | No. No se suben a ningún sitio; si borras los datos del navegador, se pierden (por eso existe la copia de **Tus datos**) |
| Reglas para los avisos | Secreto `CENTINELA_CONFIG` de GitHub | No. Los secretos no se pueden leer, ni siquiera por el dueño; solo sobrescribir |
| Qué nombre cumplía y qué se avisó hoy | `data/privado.json`, cifrado | El archivo se ve, el contenido no. La clave sale del secreto `NTFY_TOPIC` y el tamaño es fijo |
| Los avisos | App ntfy | Solo quien conozca el nombre del canal. Por eso tiene que ser largo y al azar |

Consecuencias:

- La lista es pública: cualquier cambio en `scanner/universe.json` (añadir o quitar un nombre) se ve en el repositorio. Mientras sea una lista amplia y genérica no dice qué opera nadie; si se recorta a lo que uno opera, lo dice.
- Las reglas no pasan solas de un dispositivo a otro.
- Los avisos no se anotan en la app; se ven en ntfy.
- El registro de cada barrido en **Actions** también es público: solo dice cuántos nombres se han leído.
- La app no pide nada a otros sitios al abrirla: las fuentes van dentro.

## Puesta en marcha

1. Sube este proyecto entero a un repositorio público, incluida la carpeta `.github`. La app se publica sola.
2. En **Actions → Barrido → Run workflow** lanza el primer barrido (menos de un minuto).
3. **Settings → Pages → Source: Deploy from a branch → gh-pages / (root)**.
4. Abre `https://TU-USUARIO.github.io/NOMBRE-DEL-REPOSITORIO/`. En Chrome: menú → **Instalar app**.

### Avisos al móvil

1. Instala **ntfy** desde Google Play y suscríbete a un nombre largo y difícil de adivinar (por ejemplo `centinela-` y 20 letras y números al azar). No lo escribas en ningún sitio público.
2. En el repositorio: **Settings → Secrets and variables → Actions → New repository secret**, nombre `NTFY_TOPIC`, valor ese mismo nombre.
3. En la app: **Reglas → Avisos al móvil → Copiar configuración para avisos**. Crea otro secreto, nombre `CENTINELA_CONFIG`, y pega lo copiado.
4. Cada vez que cambies las reglas y quieras que los avisos las sigan, repite el paso 3 (el secreto se sobrescribe).

## En tu ordenador, sin GitHub

Con Node.js 22, dentro de esta carpeta:

```
node scanner/scan.mjs --serve     # solo desde este ordenador, en http://localhost:8080
npm run ordenador:movil           # además, desde el móvil en el mismo Wi-Fi
```

- Solo barre con el ordenador encendido.
- `ordenador:movil` abre el servidor a la red local: úsalo solo en una red de confianza.
- Lo que cambias en la app (reglas, nombres quitados) se guarda en `config.local.json`, que git ignora. `config.json` queda con los valores de fábrica.

Para ver la app sin datos reales, con cadenas inventadas: `npm run ejemplo` (o `bash scripts/ejemplo-fondo.sh`, que la deja corriendo solo si no lo está).

## Por qué la regla principal es la probabilidad

"8 % abajo" no es el mismo riesgo en todos los nombres: en un índice tranquilo puede ser un 3 % de probabilidad y en una acción movida un 20 %. Y "crédito ≥ 10 % del ancho" obliga a aceptar un 10 % o más de probabilidad de perder, porque el crédito partido por el ancho es más o menos esa probabilidad. Por eso el riesgo se fija con la probabilidad de asignación máxima, que mide lo mismo en todos los nombres, y el crédito mínimo va en dólares por contrato. El % abajo queda como columna y como regla opcional.

## Cómo se calcula cada columna

- **Crédito (cobras):** bid del put corto menos ask del put largo, por 100.
- **% del ancho:** crédito partido por el ancho.
- **Ancho:** la regla es un máximo ($10 de fábrica). Vale ese ancho y cualquiera menor que tenga la cadena. Se busca hasta $5 en todos los nombres y hasta $10 solo en QQQ, SPY, IWM, DIA, GLD y XSP; en las acciones, nunca $10. Los que arriesgan más de $500 lo dicen en su fila.
- **Pérdida máx.:** ancho menos crédito, por 100.
- **Rentabilidad:** crédito partido por la pérdida máxima.
- **Prob. de asignación:** probabilidad de que el precio acabe por debajo del corto el día del vencimiento, tal como la descuentan los precios: lo que cambia el precio del put al subir un dólar el strike, medido con los dos strikes vecinos a precio medio. Si faltan precios, se usa la fórmula con la volatilidad implícita del strike. No mide la asignación anticipada.
- **Rentab. esperada:** (cobras neto − se espera pagar) ÷ pierdes máx. Es lo que ordena y lo que mide la regla "rentab. esperada mínima" (0 % de fábrica).
- **Equilibrio:** cobras neto ÷ se espera pagar. Solo un dato de la ficha.
- **Movimiento esperado:** precio × volatilidad implícita al dinero × raíz de (días / 365).

El nivel de 0 a 5, lo que "se espera pagar" y su error están explicados con detalle en `docs/calculo.md`.

## Qué no está todavía

- Ex-dividendo.
- Filtro por la IV frente a su propia historia (el barrido ya guarda la volatilidad diaria; faltan unos meses de datos).
- Otras estrategias (iron condor, bajistas). El motor está preparado: ver `web/engine.js`.

## Carpetas

- `web/`: la app (`engine.js` es el motor; `fonts/` las fuentes).
- `scanner/`: `scan.mjs` (el barrido y los avisos), `cierres.mjs` (los cierres diarios de 5 años, una vez al día, carpeta `historia/`; un push no lo lanza), `registro.mjs` (el registro de deals, tras cada barrido con el mercado abierto; carpeta `registro/`) y `universe.json` (la lista base, por bloques).
- `.github/workflows/`: `publicar.yml`, `pruebas.yml`, `barrido.yml` y `cierres.yml`.
- `scripts/`: `rama.sh` (escribe cada parte en `gh-pages` sin pisar las otras) y las herramientas de trabajo (`entrega.sh`, `produccion.sh`, `esperar-ci.sh`, `ver.mjs`, `ejemplo-fondo.sh`).
- `config.json`: reglas de fábrica (públicas). `config.local.json`: lo que guardas tú en el modo ordenador, ignorado por git.
- `test/`: pruebas del motor y de las pantallas, y el generador de datos de ejemplo.
- `docs/` y `AGENTS.md`: la guía para quien trabaje en el código (cálculo, interfaz y operación).
