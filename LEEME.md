# Centinela

Filtro de bull puts sobre un universo amplio de acciones y ETF de EE. UU. No da órdenes ni consejos: barre, filtra con tus reglas, ordena con tu orden y te avisa.

## Qué hace

- **Universo**: barre unas 550 empresas y ETF (S&P 500, Nasdaq 100 y 32 ETF). Enseña los que cumplen tus reglas, con el orden que elijas.
- **Favoritos**: tu lista acotada. Cada nombre se queda aunque no pase, con el motivo.
- **Deals**: todos los bull puts de tus favoritos en una sola lista, con filtros por ancho, vencimiento y % abajo.
- **Avisos**: cuando un favorito pasa a cumplir, o un nombre nuevo entra entre los primeros del universo. Llegan al móvil con la app gratuita ntfy.
- **Reglas**: días, % abajo, ancho máximo, crédito mínimo, probabilidad de asignación máxima, equilibrio mínimo e interruptores.

Los datos de opciones vienen de CBOE con 15 minutos de retraso. Las fechas de resultados, de StockAnalysis.

## Cómo está montado

Un solo repositorio público de GitHub. Cada media hora, en horario de mercado de EE. UU., GitHub barre el universo y publica la app junto con el resultado en `https://TU-USUARIO.github.io/NOMBRE-DEL-REPOSITORIO/`. En repositorios públicos esto es gratis y sin límite de minutos.

### Qué es público y qué no

| | Dónde está | ¿Lo ve alguien más? |
|---|---|---|
| El código y la pantalla de la app | Repositorio y página | Sí |
| El barrido del universo (precios y cadenas de los 550 nombres) | Página, carpeta `data/` | Sí. Es igual para cualquiera y no dice nada de quien lo usa |
| Reglas, orden y favoritos | En tu dispositivo | No |
| Reglas y favoritos para los avisos | Secreto `CENTINELA_CONFIG` de GitHub | No. Los secretos no se pueden leer, ni siquiera por el dueño; solo sobrescribir |
| Qué favorito cumplía y qué se avisó hoy | `data/privado.json`, cifrado | El archivo se ve, el contenido no. La clave sale del secreto `NTFY_TOPIC` y el tamaño es fijo |
| Los avisos | App ntfy | Solo quien conozca el nombre del canal. Por eso tiene que ser largo y al azar |

Consecuencias de que sea así:

- El barrido público solo lleva el universo de base. Un nombre de fuera no se puede añadir desde la app, porque su sola presencia en un archivo público lo delataría.
- Las reglas y los favoritos no pasan solos de un dispositivo a otro.
- Los avisos no se anotan en la app; se ven en ntfy.
- El registro de cada barrido en **Actions** también es público: solo dice cuántos nombres se han leído.

## Puesta en marcha

1. Sube este proyecto entero a un repositorio público, incluida la carpeta `.github`. El primer barrido arranca solo y tarda unos diez minutos.
2. Cuando termine: **Settings → Pages → Source: Deploy from a branch → gh-pages / (root)**.
3. Abre `https://TU-USUARIO.github.io/NOMBRE-DEL-REPOSITORIO/`. En Chrome: menú → **Instalar app**.

### Avisos al móvil

1. Instala **ntfy** desde Google Play y suscríbete a un nombre largo y difícil de adivinar (por ejemplo `centinela-` y 20 letras y números al azar). No lo escribas en ningún sitio público.
2. En el repositorio: **Settings → Secrets and variables → Actions → New repository secret**, nombre `NTFY_TOPIC`, valor ese mismo nombre.
3. En la app: **Reglas → Avisos al móvil → Copiar configuración para avisos**. Crea otro secreto, nombre `CENTINELA_CONFIG`, y pega lo copiado.
4. Cada vez que cambies reglas o favoritos y quieras que los avisos lo sigan, repite el paso 3 (el secreto se sobrescribe).

## En tu ordenador, sin GitHub

Con Node.js 22, dentro de esta carpeta:

```
node scanner/scan.mjs --serve
```

Abre `http://localhost:8080`. Solo barre con el ordenador encendido y el móvil solo la ve en el mismo Wi-Fi. En este modo las reglas se guardan en `config.json` y sí se pueden añadir nombres al universo.

## Para ver la app sin datos reales

```
npm run ejemplo
```

## Cómo se calcula cada columna

- **Crédito (cobras)**: bid del put corto menos ask del put largo, por 100.
- **% del ancho**: crédito partido por el ancho.
- **Ancho**: la regla es un máximo. Vale ese ancho y cualquiera menor que tenga la cadena.
- **Pérdida máx.**: ancho menos crédito, por 100.
- **Rentabilidad**: crédito partido por la pérdida máxima.
- **Prob. de asignación**: probabilidad de que el precio acabe por debajo del corto el día del vencimiento, sacada de la volatilidad implícita de ese strike. No mide la asignación anticipada.
- **Equilibrio**: lo que esperas ganar partido por lo que esperas perder: rentabilidad × (100 − prob. de asignación) ÷ prob. de asignación. En 1 se igualan.
- **Movimiento esperado**: precio × volatilidad implícita al dinero × raíz de (días / 365).

## Qué no está todavía

- Media de 50 días, caída en 5 sesiones y gráfico de precio.
- Ex-dividendo.
- Filtro por volatilidad respecto a su historia (el barrido ya guarda la volatilidad diaria).
- Otras estrategias (iron condor, bajistas). El motor está preparado: ver `web/engine.js`.

## Estado de las pruebas

El barrido lee de CBOE 548 de los 550 nombres en unos 8 minutos y medio (CBOE admite más o menos una petición por segundo y el barrido se ajusta solo a ese ritmo). Cada barrido deja un resumen en **Actions**: "Leídos N, sin lectura M" y el motivo.

## Carpetas

- `web/` la app (`engine.js` es el motor: reglas, columnas y orden).
- `scanner/scan.mjs` el barrido y los avisos.
- `scanner/universe.json` lista de reserva del universo.
- `config.json` reglas de fábrica. Solo se usa en el modo ordenador.
- `.github/workflows/barrido.yml` el barrido automático.
- `test/` pruebas y generador de datos de ejemplo.
