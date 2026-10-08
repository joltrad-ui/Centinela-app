# Centinela

Filtro de bull puts sobre una lista corta de acciones y ETF de EE. UU. No da órdenes ni consejos: barre, filtra con tus reglas, ordena con tu orden y te avisa.

## Qué hace

- **Hoy**: la pantalla que se abre al entrar. Un mapa de nombres por vencimientos, con un nivel de 0 a 4 por casilla (cuánto tiene a favor el bull put de igual riesgo de esa casilla); una nube para comparar los de un vencimiento; unas barras con los mismos deals, una fila cada uno, que enseñan lo que cobra, lo que se espera pagar y lo que queda con su error; la ficha del deal con los cuatro puntos que dan el nivel; y **Mis deals**, donde apuntas lo que abres y cómo acabó. La app no envía órdenes: da un resumen para copiar.
- **Lista**: la lista base y la única que hay. 33 nombres con opciones líquidas (incluido XSP, el índice S&P 500 mini, sin asignación), agrupados por bloque (bolsa EE. UU., tecnología grande, energía, metales, otras bolsas, defensivos, bonos largos, bitcoin). Está en `scanner/universe.json`; para cambiarla se cambia ese archivo. Cada nombre se queda aunque no pase, con el motivo.
- **Deals**: todos los bull puts de la lista juntos, con filtros por ancho, vencimiento y % abajo.
- **Avisos**: cuando un nombre de la lista pasa a cumplir. Llegan al móvil con la app gratuita ntfy.
- **Reglas**: días, probabilidad de asignación máxima (la que elige el corto en cada nombre), ancho máximo, cobro mínimo en dólares, equilibrio mínimo, % abajo opcional e interruptores.

Los datos de opciones vienen de CBOE con 15 minutos de retraso. Las fechas de resultados, de StockAnalysis.

## Cómo está montado

Un solo repositorio público de GitHub. La app y el barrido se publican juntos en `https://TU-USUARIO.github.io/NOMBRE-DEL-REPOSITORIO/` (rama `gh-pages`), pero cada uno por su lado:

- **Publicar** (`.github/workflows/publicar.yml`): cada cambio en `web/` que llega a `main` publica la app en un par de minutos, con el barrido que ya hubiera. No barre nunca.
- **Barrido** (`.github/workflows/barrido.yml`): solo por horario o a mano. Barre la lista base cada media hora en horario de mercado y tarda menos de un minuto.
- Ninguno pisa al otro: publicar solo cambia los archivos de la app y el barrido solo la carpeta `data/`.

La app guarda el último barrido en el dispositivo: al abrirla lo enseña al momento y solo descarga lo que haya cambiado.

En repositorios públicos todo esto es gratis y sin límite de minutos.

### Qué es público y qué no

| | Dónde está | ¿Lo ve alguien más? |
|---|---|---|
| El código y la pantalla de la app | Repositorio y página | Sí |
| La lista y su barrido (precios y cadenas de los 32 nombres) | Repositorio y página, carpeta `data/` | Sí. Quien mire el repositorio ve qué nombres sigue la app |
| Reglas y orden | En tu dispositivo | No |
| Mis deals y los bloques que marcas como ya abiertos | En tu dispositivo | No. No se suben a ningún sitio; si borras los datos del navegador, se pierden |
| Reglas para los avisos | Secreto `CENTINELA_CONFIG` de GitHub | No. Los secretos no se pueden leer, ni siquiera por el dueño; solo sobrescribir |
| Qué nombre cumplía y qué se avisó hoy | `data/privado.json`, cifrado | El archivo se ve, el contenido no. La clave sale del secreto `NTFY_TOPIC` y el tamaño es fijo |
| Los avisos | App ntfy | Solo quien conozca el nombre del canal. Por eso tiene que ser largo y al azar |

Consecuencias de que sea así:

- La lista es pública: cualquier cambio en `scanner/universe.json` (añadir o quitar un nombre) se ve en el repositorio. Mientras sea una lista amplia y genérica no dice qué opera nadie; si se recorta a lo que uno opera, lo dice.
- Las reglas no pasan solas de un dispositivo a otro.
- Los avisos no se anotan en la app; se ven en ntfy.
- El registro de cada barrido en **Actions** también es público: solo dice cuántos nombres se han leído.

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
node scanner/scan.mjs --serve
```

Abre `http://localhost:8080`. Solo barre con el ordenador encendido y el móvil solo la ve en el mismo Wi-Fi. En este modo las reglas se guardan en `config.json`.

## Para ver la app sin datos reales

```
npm run ejemplo
```

## Por qué la regla principal es la probabilidad

"8 % abajo" no es el mismo riesgo en todos los nombres: en un índice tranquilo puede ser un 3 % de probabilidad y en una acción movida un 20 %. Y "crédito ≥ 10 % del ancho" obliga a aceptar un 10 % o más de probabilidad de perder, porque el crédito partido por el ancho es más o menos esa probabilidad. Por eso el riesgo se fija con la probabilidad de asignación máxima, que mide lo mismo en todos los nombres, y el crédito mínimo va en dólares por contrato. El % abajo queda como columna y como regla opcional.

## Cómo se calcula cada columna

- **Crédito (cobras)**: bid del put corto menos ask del put largo, por 100.
- **% del ancho**: crédito partido por el ancho.
- **Ancho**: la regla es un máximo. Vale ese ancho y cualquiera menor que tenga la cadena.
- **Pérdida máx.**: ancho menos crédito, por 100.
- **Rentabilidad**: crédito partido por la pérdida máxima.
- **Prob. de asignación**: probabilidad de que el precio acabe por debajo del corto el día del vencimiento, tal como la descuentan los precios: lo que cambia el precio del put al subir un dólar el strike, medido con los dos strikes vecinos a precio medio (la misma cuenta que crédito / ancho en un spread estrecho). Si faltan precios, se usa la fórmula con la volatilidad implícita del strike. No mide la asignación anticipada.
- **Equilibrio**: lo que esperas ganar partido por lo que esperas perder: rentabilidad × (100 − prob. de asignación) ÷ prob. de asignación. En 1 se igualan. Como la probabilidad sale de los mismos precios que el crédito, suele quedar algo por debajo de 1: lo que falta es sobre todo lo que se lleva la horquilla.
- **Movimiento esperado**: precio × volatilidad implícita al dinero × raíz de (días / 365).

## Qué no está todavía

- Media de 50 días, caída en 5 sesiones y gráfico de precio.
- Ex-dividendo.
- Filtro por volatilidad respecto a su historia (el barrido ya guarda la volatilidad diaria).
- Otras estrategias (iron condor, bajistas). El motor está preparado: ver `web/engine.js`.

## Estado de las pruebas

El barrido de la lista base lee los 33 nombres en unos segundos. Cada barrido deja un resumen en **Actions**: "Leídos N, sin lectura M" y el motivo.

## Carpetas

- `web/` la app (`engine.js` es el motor: reglas, columnas y orden).
- `scanner/scan.mjs` el barrido y los avisos.
- `scanner/universe.json` la lista base, por bloques.
- `config.json` reglas de fábrica. Solo se usa en el modo ordenador.
- `.github/workflows/barrido.yml` los barridos automáticos; `publicar.yml` la publicación de la app.
- `scripts/rama.sh` escribe cada parte en `gh-pages` sin pisar las otras.
- `scanner/cierres.mjs` baja una vez al día los cierres diarios de la lista (carpeta `historia/`), para la pestaña de prueba "Igual riesgo". Un push no lo lanza.
- `test/` pruebas y generador de datos de ejemplo.
