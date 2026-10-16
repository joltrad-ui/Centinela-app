# Interfaz: pantallas, piezas comunes y criterios de diseño

Lo que se ve y cómo está hecho. Las cuentas están en `docs/calculo.md`; los datos y el despliegue, en `docs/operacion.md`.
App sin framework: `render()` reconstruye `#app`; los eventos se delegan en `app.js` con `data-*`.

## 1. Pantallas y navegación

- **Cuatro pantallas**, en la barra de abajo en este orden: **Hoy, Buscador, Avisos, Reglas**. La app se abre en la última usada (`centinela.pestana.v1`); la primera vez, Hoy.
- Sin título a la vista (el `h1` queda solo para lectores de pantalla) y sin botón Actualizar, salvo uno al principio de Reglas con su estado debajo: qué pasó en la última comprobación, la fecha del barrido y de los cierres, y si el mercado está abierto o cerrado (`refreshBox`, `state.refresh`). En las demás pantallas se actualiza arrastrando hacia abajo.
- **Sin conexión:** se enseña el último barrido guardado en el dispositivo (`DATA_CACHE`) con un aviso gris con su fecha y antigüedad; al volver la conexión, se recarga sola (`online` / `offline` en `app.js`).
- **Instalable** (manifest y `sw.js`): primero la red y, sin conexión, la última copia guardada. Pide siempre a la red con `cache: "no-cache"`.
- **Ya no hay** Lista, Deals ni Igual riesgo. Lista y Deals los sustituye el Buscador (14 oct); Igual riesgo se quitó el 12 oct (queda su motor).
- Hoy solo bull put. Más adelante: iron condor y estrategias bajistas.

## 2. Módulos

Ninguno pasa de ~900 líneas. Los que tienen pantalla se crean con `createX(ctx)` y devuelven `view`, `click` (true si el clic era suyo) y, si hace falta, `submit`.

| Módulo | Qué contiene |
|---|---|
| `app.js` | arranque, carga, guardado, cabecera, eventos y la tabla `RANGES` de las barras |
| `reglas.js`, `avisos.js` | pestañas Reglas y Avisos |
| `conexion.js` | secreto, puente y GitHub, con sus botones y formularios |
| `copia.js` | "Tus datos" en Reglas: copia de seguridad como texto y restaurar (`createCopia`, `parseBackup`) |
| `hoy.js` | estado de Hoy, ficha, Mis deals y eventos (`createHoy`: `view`, `sheet`, `click`, `submit`, `escape`, `setProb`, `setWidth`, `setFl`, `openName`, `dealRow`, `sortDeals`, `stats`) |
| `hoy-vistas.js` | controles de Hoy, mapa, nube y barras |
| `hoy-calc.js` | constantes, formatos y cuentas puras de la ficha y las listas |
| `buscador.js` | el Buscador (`createBuscador`) |
| `ui.js` | piezas comunes: `emptyBox`, `notice`, `sectionHead` |
| `filtros.js` | los filtros de barra: topes `W` y `PR`, formatos, `filterBars`, `choiceRow`, `moreHead` |
| `engine.js` | motor (ver `docs/calculo.md`) |

Al añadir un archivo a la app: ponerlo en `SHELL` de `sw.js` y subir `CACHE`.

## 3. Guardado en el dispositivo (`localStorage`)

Todo lo personal vive aquí y nunca en el repositorio ni en `data/` (ver Privacidad en `AGENTS.md`).

| Clave | Contiene |
|---|---|
| `centinela.config.v1` | reglas, orden, avisos y nombres quitados (`off`) |
| `centinela.hoy.v1` | vista, prob. objetivo, ancho (en puntos), precio visible o medio, bloques que ya tiene, vencimiento de nube y barras, orden de las barras, bloques abiertos de la ficha (`folds`), `fOpen` |
| `centinela.misdeals.v1` | deals apuntados |
| `centinela.buscador.v1` | filtros del Buscador (`lv, days, blocks, w, pr, hide, earn, trend, margin, one, tengo, ord, fOpen`). `margin` antes era un booleano: `true` se lee como `"yes"` |
| `centinela.buscador.guardados.v1` | combinaciones de filtros con nombre (hasta 8) |
| `centinela.tengo.v1` | acciones marcadas a mano como "la tengo" |
| `centinela.pestana.v1` | última pestaña |
| `centinela.avisos.vistos`, `centinela.secreto.copiado` | marcas de lectura y de copia |
| `centinela.github.v1`, `centinela.puente` | modo con repositorio privado (hoy sin uso) y puente propio |
| `centinela.real.v1`, `centinela.muestra` | versión de prueba con datos incrustados |
| `centinela.igual.v1` | restos de la pantalla antigua (`migrateEqualFee`) |

## 4. Piezas comunes (se tocan en un solo sitio)

- **`emptyBox(título, motivos, acciones)`** (`ui.js`): todo "no hay nada". Acepta uno o varios botones.
- **`notice(tipo, texto)`** (`ui.js`): avisos. Gris = informa, ámbar = conviene mirar, rojo = algo falla o baja el nivel. El verde solo va en números y en la caja de lectura.
- **`sectionHead(título, dato)`** (`ui.js`): el título de cada apartado (`.group`, 1,25 rem, dato apagado a la derecha).
- **`stats([[rótulo, n], …])`** (`hoy.js`): los recuentos de nivel, siempre en **una sola línea**, sin caja: rótulo apagado y número. Rótulos cortos: Nivel 5, 4, 3, Margen y, en Hoy, Total. Lo usan el mapa de Hoy, el Buscador y la lista de deals de la ficha. Los mensajes de Hoy sin recuentos siguen como texto.
- **Plegables:** de contenido, siempre `foldBlock` (`hoy.js`): fila de 48 px con chevron (bloques de la ficha, "Cómo se puntúa", "Qué significa cada casilla"). De filtros: "Más filtros ▾" (`fhead`) y filas con etiqueta ▾ como "Ya tengo".
- **Alturas, solo tres** (variables de `app.css`): `--h-lg` 44 px (botón principal y campos), `--h-md` 36 px (botón discreto, pestañas `.seg`), `--h-sm` 32 px (chips, barras de orden, filas de filtros).
- **Barras de ordenación:** siempre `.sortbar` (contenedor gris `#262624`, opción activa en una píldora más oscura `#1e1e1c`, seminegrita), nunca chips sueltos. A todo el ancho en el Buscador, la ficha y las Barras de Hoy, sin rótulo (`.sortbar.eq`: botones del mismo ancho), pegada a la lista que ordena; en la ficha, debajo de los filtros.
- **Rojo y color:** texto `#e0625a`, rellenos `#cf3f37` (más oscuro que el verde, se distingue también en blanco y negro). Color solo en los números. El nivel 0 va en gris oscuro sin color, con estados distinguibles.
- **Fechas** con `labelOf` y **números** con `num` / `usd2`, nunca a mano. No usar `toFixed` ni `Intl` en `en-US` para texto visible (salvo coordenadas de gráficos).
- **No llamar `wrap` a ninguna clase:** ya es la de la página y mide 100 dvh.

## 5. Filtros (criterio único en toda la app)

- **Orden, siempre el mismo:** Nivel, Vence hasta, Ancho hasta, Prob. hasta (las que existan en cada pantalla, sin saltarse el orden); después "Más filtros" y, abajo, la barra de orden. `filterBars` (`filtros.js`) lo impone; para cambiar un tope, un rótulo o el orden se toca solo `filtros.js`. Las pantallas dicen cuáles tienen y con qué ids (`hoy-`, `fi-`, `bs-`).
- **Ancho, prob. y vencimiento** son siempre barras "hasta": ancho en $ por contrato de $100 a $1000 de 50 en 50; prob. de 3 a 30 % de uno en uno; vencimiento en días (de los mínimos a los máximos de las Reglas en Hoy y el Buscador; entre el más cercano y el más lejano del nombre en la ficha). El máximo de la barra no filtra. Se aplican al soltar (`RANGES` en `app.js`).
- **Elegir una opción entre varias** → barra segmentada de dos o tres posiciones (`choiceRow`). **Varias casillas independientes** → chips dentro de una fila plegable ("Ocultar"). Nunca una misma opción repartida en dos botones de dos posiciones.
- **Filas:** todas del mismo alto (34 px: 32 de control y 2 de margen), etiqueta en una columna fija de `--lab` (100 px) y los controles empezando en la misma línea; las barras de elegir una dentro de una fila miden lo mismo que un chip (`.fi-f-c.sl > .sortbar`). Textos cortos en las barras; la etiqueta lleva el sentido ("Margen: Todos / Con / Sin").
- **"Más filtros ▾ · N activos" / "Menos filtros ▴"** (`fhead`, `moreHead`): comprimidos de fábrica y se recuerdan (`fOpen`). Las barras principales van siempre a la vista. A la derecha de la cabecera: el "?" de ayuda (Buscador) y "Quitar filtros" (solo si hay filtros puestos, también con "Más filtros" cerrado). Las filas de "Más filtros" van juntas en un recuadro de fondo suave (`morePanel`, `.fi-more`) que sobresale 8 px a cada lado para que las filas sigan alineadas con las barras de arriba.
- **Filas plegables** (Guardados, Bloque, Ocultar en el Buscador; Ya tengo en Hoy): todas con `foldRow` (`filtros.js`), con el mismo aspecto que las demás filas: etiqueta a la izquierda y, a la derecha, un campo con el fondo y el alto de una barra (32 px) que enseña lo marcado separado por " · ", o "ninguno" apagado, y un ▾. Al tocarlo se abre (▴) y debajo salen las opciones como chips con "Listo"; solo una abierta a la vez en el Buscador (`bs.open`). Ninguna etiqueta lleva ▾ ni es un botón.

## 6. Buscador (`buscador.js`)

La pantalla de todas las acciones, con el esquema de la ficha. De arriba abajo:

1. **Caja de búsqueda** (símbolo, nombre o bloque). Al escribir solo se repinta la lista (`setQuery`).
2. **Panel plegable "Acciones"** (chips por bloque). Tocar quita o pone una acción: el mismo `config.off` de siempre, que la oculta en toda la app. Con "Marcar las que tengo", tocar marca "la tengo" (`centinela.tengo.v1`, solo en el dispositivo).
3. **Filtros:** Nivel 0–5, Vence hasta, Ancho hasta, Prob. hasta; y en "Más filtros": **Guardados** (plegable: combinaciones con nombre; tocar una la aplica, la × la borra, y un campo "Nombre" + "Guardar estos filtros" guarda la de ahora; se marca la que coincide con los filtros actuales), Bloque (plegable), **Margen** (Todos / Con / Sin), **Volatilidad** (Todas / IV alta / IV baja), **Las que tengo** (Todas / Ocultar / Solo), **Precio** (Bid/Ask / Mid, el mismo de Hoy), **Ocultar** (plegable: Resultados, Tendencia, Fuera de Reglas), "Quitar filtros".
4. **Recuentos de nivel** (`stats`) y una línea con el recuento real a la izquierda ("30 nombres · 1336 de 1575 deals": los que salen de los que hay) y "Uno por nombre" a la derecha.
5. **Barra de orden:** Nivel, Beneficio, Prob., Suelo, Por día. Beneficio = lo que queda de lo cobrado en %; Suelo = el `floor` del deal (en % de lo que se arriesga); Por día = rentab. esperada ÷ días hasta el vencimiento.
6. **Lista de deals:** la misma fila que la ficha más el símbolo (`dealRow` y `sortDeals` de `hoy-calc.js` / `hoy.js`). Tocar una fila abre la ficha en ese deal (`data-hoy="cell"`).

- **"Las que tengo"** = las acciones con un deal abierto en Mis deals + las marcadas a mano.
- **Cuando no sale nada:** `emptyBox` con los tres filtros que más devolverían al quitarlos ("Quitar Ancho hasta $100 · saldrían 18"; `criteria`, `blockers`, acción `drop`) y "Quitar todos los filtros".
- **Datos:** `qualityDeals` (motor) con tope de prob. de 30 %, calculados una vez por barrido, reglas, precio y acciones (caché), puntuados con el mismo nivel 0–5 que Hoy. Valores de fábrica: niveles 3, 4 y 5, uno por nombre.
- Los filtros viven en `centinela.buscador.v1`; `cleanFilters` los sanea y es el mismo saneado que usan las combinaciones guardadas.
- **Ayuda de los filtros:** un "?" a la derecha de la cabecera "Más filtros" abre un recuadro con lo que significan Nivel, Margen y Las que tengo (`HELP` en `buscador.js`, solo en memoria). Los textos usan el vocabulario de `docs/calculo.md`. Las etiquetas de las filas no llevan marcas: ninguna línea ni símbolo extra.
- **Precálculo:** con Hoy en pantalla, en un rato libre (`requestIdleCallback`) `app.js` llama a `buscador.warm()`, que calcula los deals; al abrir el Buscador ya están (la caché es por barrido, reglas, precio y acciones).

## 7. Hoy (`hoy.js`, `hoy-vistas.js`)

La pestaña de entrada. Va de lo ancho a lo estrecho: **Mapa** (nombres × vencimientos, un nivel de 0 a 4 por casilla) → **Nube** (un vencimiento: coste de ida y vuelta sobre lo cobrado frente a rentab. esperada) → **Barras** (los mismos deals, una fila cada uno en una sola escala: lo que cobra, lo que se espera pagar y lo que queda con su error) → **la ficha** con un "Resumen para tu bróker" que solo se copia → **Mis deals** (lo que el dueño apunta que ha abierto y cómo acabó, con el recuento por nivel).

- `createHoy(ctx)` recibe de `app.js` el estado y las utilidades; sus botones llevan `data-hoy` y sus formularios `data-hoy-form`. Usa las mismas cuentas que antes tenía "Igual riesgo" (`spreadRow`, `withHistory`, `gateReason`) y las reglas `equalFee` y `equalGapPct`.
- **Controles:** Ancho hasta (`hoy-w-range`, $100–$1000; `hoy.setWidth`) y Prob. hasta (`hoy-pr-range`, 3–30 %, "X % o menos": `hoy.setProb`, pasa `orLess: true` a `equalRisk`), siempre a la vista; en "Más filtros", Precio (barra) y "Ya tengo". El ancho por defecto sale de las Reglas (`nearest(WIDTHS, rules.width)`); un ancho guardado se conserva en puntos y se ve en $.
- **"Ya tengo"** (bloques ya abiertos): una fila plegable (`foldRow`) con los bloques marcados en el campo; al pulsar se abren todos como chips para marcar. Los de Mis deals se marcan solos (y no se pueden desmarcar). `hoy-held` es el punto de la leyenda del mapa, no esta fila.
- **Mapa:** el resumen es un contador en una línea (`stats`: casillas de nivel 5, 4 y 3 con la regla de margen de fábrica, 4 y 3 con "both", solo el 3 con el punto de seguridad apagado; más "Margen" y "Total"). La leyenda va plegada al final de la matriz ("Qué significa cada casilla", `hoy.legendOpen`).
- **Tocar una fecha** (cabecera de columna o chips "Vencimiento": Todas y cada fecha) **no** lleva a la nube: enfoca la matriz en ese vencimiento (`hoy.mapExp`, acción `mexp`, solo en memoria): una sola columna, ordenada por ese día, con el deal de cada casilla al lado (corto/largo, cobras neto y % abajo; `hoy-detail`), y el contador cuenta solo esa fecha. "Todas" vuelve a la matriz completa. La nube y las barras abren en la fecha enfocada.
- **Avisos generales** de Mapa, Nube y Barras ("A precio medio: es una hipótesis", la línea "Plazo · comisión · horquilla máxima") van al final de la pantalla, antes de "Cómo se puntúa" (`notes`), para no empujar lo importante. Precios con el mercado cerrado: aviso ámbar.
- **Barras:** encima de la lista, tras una línea fina, una sola cabecera: a la izquierda cuántos deals hay y a la derecha el orden ("Por lo que queda" / "Por el suelo"), que cambia al tocarlo. La leyenda de los símbolos va al final, antes de los avisos. Detalle del cálculo en `docs/calculo.md` §6.

## 7b. Reglas: "Tus datos" (`copia.js`)

- "Copiar mis datos" saca un texto JSON (`{centinela: 1, guardado, datos}`) con las claves de `KEYS`: reglas, Hoy, Mis deals, Buscador, combinaciones guardadas, las que tengo y la pestaña. Se queda a la vista en un campo para copiarlo a mano si el portapapeles falla.
- "Restaurar": se pega la copia y "Revisar" enseña qué trae ("2 deals abiertos y 1 cerrado, 3 acciones marcadas…"); "Sí, restaurar" reemplaza lo del dispositivo y recarga la app. Solo se aceptan las claves de `KEYS` (`parseBackup`, con prueba).
- **Nunca** entran en la copia la llave de GitHub (`centinela.github.v1`), el puente, los barridos guardados ni las marcas de lectura. No se sube a ningún sitio.

## 7c. Reglas y Avisos (`reglas.js`, `avisos.js`)

- Mismo vocabulario visual que el resto: `sectionHead` para los títulos, recuadros `.panel` con divisores (esquinas `--r-card`, igual que `.fi-more`, `.empty` y `.notice`), `notice` para los avisos, `emptyBox` para los vacíos y alturas solo de la escala.
- **Regla con número** (`stepper`, clase `.field`): el título y el −/+ en la misma línea y la explicación debajo, a todo el ancho; el −/+ mide 44 px (`--h-lg`). Una regla con elección propia (el punto de seguridad) usa `.field.stack`.
- Los interruptores (`.gate`, `.switch`) y los botones (`.btn`) usan las alturas de la escala. Los números de las reglas se cambian con −/+, no con barras (decisión del dueño).

## 8. La ficha (`sheet` de `hoy.js`)

Una sola para las tres pantallas: tocar una casilla de Hoy o una fila del Buscador la abre. Con un nombre sin deal elegido, `hoy.openName` carga el mejor deal puntuado (el de más nivel que cumple las Reglas o, si ninguno, el de más nivel; sin deals puntuados enseña solo la cabecera y un aviso).

- **Arriba:** nombre, precio y variación del día (`fi-head`); nombre largo y bloque; el nivel con strikes, vencimiento, días y ancho por contrato (`fi-deal`).
- **El ticket** (`fi-ticket`), el protagonista: "Cobras" (cobras neto, en azul), "Apartas para pérdidas" (= se espera pagar, en rojo), una línea de puntos y "Tu beneficio" (cobras neto menos lo que se espera pagar, grande, en verde o en rojo si no pasa de 0) con su % sobre lo cobrado; una barra fina (rojo = apartas, verde = beneficio); la frase "De cada $X que cobras, el N % es tuyo"; y "Si el cálculo se queda corto" (el peor de `marginRecent` y `marginHist`, en $ y %).
- **Cajas:** prob. de asignación, pierdes máx. y, ancha, "Pierdes si IWM baja de $X" (el break-even) con "Ahora está en $Y · Z % abajo".
- **Avisos en píldoras** neutras con un punto de color: ámbar para lo que conviene mirar (resultados, Fed, tendencia, poca historia, "los dos cálculos no coinciden", "estimaciones muy distintas", fuera de Reglas con el motivo) y rojo para lo que baja el nivel (poco margen, coste N %, bloque repetido).
- **Gráfico de precio** dentro de "Precio y volatilidad" (SVG, `priceChart`): precio, media de 50 y de 200 días y el strike corto del deal; debajo, "Media de 50 días" y "Últimas 5 sesiones" con su explicación. Solo informativo.
- **Cinco bloques plegables** (`fi-fold`, cerrados de fábrica; los abiertos se recuerdan en `centinela.hoy.v1`, `folds`): "Por qué nivel N" (frase corta, los cuatro ✓/✕ y los dos cálculos), "Precio y volatilidad" (rangos de 52 semanas y 1 mes y las tres volatilidades), "Rentabilidad por día y costes" (`yieldTable`, siempre con las tres filas), "Probabilidades" (mercado, historia y pérdida máx.) y "Al bróker" (resumen, Copiar, "La he abierto" y el aviso).
- **Al final, "Deals de X"** (`dealsSection`, `N de M`): todos los bull puts puntuados del nombre (`nameDeals` = `qualityDeals` de ese solo nombre, con caché), cada uno con nivel, strikes, fecha, prob., ancho, "fuera de Reglas" con el motivo y lo que queda en $ y %. Filtros solo en memoria (`hoy.fl`, `setFl`): Nivel, Vence hasta, Ancho hasta, Prob. hasta, Ocultar (Fuera de Reglas) y orden (nivel, beneficio %, prob.), más los recuentos de nivel (`stats`). Tocar una fila la carga arriba y vuelve al principio de la ficha; la elegida lleva una barra a la izquierda.
- Equilibrio ya no sale en la ficha (la regla de equilibrio mínimo de Reglas sigue). Se quitó el botón "Ver todo de…".
