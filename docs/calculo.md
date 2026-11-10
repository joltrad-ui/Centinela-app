# Cálculo: reglas, historia, nivel y error

Lo que hace el motor (`web/engine.js`, puro, compartido por la app y el barrido). **Ninguna de estas reglas se cambia sin preguntar al dueño.**
Lo que se ve en pantalla está en `docs/interfaz.md`; de dónde salen los datos, en `docs/operacion.md`.

## 1. Reglas básicas

- **Crédito a precio natural:** bid del corto menos ask del largo.
- **Prob. de asignación:** la que descuenta el mercado, sacada del precio de los strikes vecinos a precio medio y alisada para que no baje al subir el strike (`marketProbs`). Si no se puede medir, la fórmula con la IV del strike (`probBelow`), y el spread lo marca con `probSrc: "formula"`.
- **Prob. máxima:** es la regla que elige el corto (15 % de fábrica, 50 = sin límite).
- **Plazo de fábrica:** de 15 a 60 días (CBOE se lee hasta 60).
- **% abajo:** columna y regla opcional (`otmOn`).
- **Crédito mínimo:** en dólares por contrato (`minCredit`), no en % del ancho. Esa regla forzaba una probabilidad de pérdida mínima.
- **Versión de las reglas:** `v: 3` (24 oct). En `normalizeRules`, las de antes de la 2 se migran como siempre y las de antes de la 3 pasan **una vez** a plazo 15–60, prob. máxima 15 % y ancho $10; lo demás se conserva y, desde ahí, se respeta lo que ponga el dueño. El barrido lee `CENTINELA_CONFIG` con la misma migración, sin escribir el secreto.
- **Rentabilidad:** crédito / pérdida máxima.
- **Rentab. esperada mínima** (`minRetExp`, 24 oct): sustituye al equilibrio antiguo (rentabilidad × (100 − prob.) / prob., que contaba toda asignación como pérdida máxima y no descontaba la comisión; quitado del motor). 0 % de fábrica, de −5 a +5 de 0,1 en 0,1. `buildBullPuts` la calcula con `spreadRow` (comisión `equalFee`) y `withHistory` solo si recibe los cierres del nombre y el spread ya cumple prob., % abajo, ancho y cobro; sin cierres no se mide y la regla no aparta. Lo que no la supera sale "fuera de Reglas: rentab." (motivo `rentab. esperada baja`), no desaparece.
- **Ancho:** el de las reglas es un máximo ($10 de fábrica). Para cada corto se consideran todos los largos que dejan ese ancho o menos, y nunca más que el tope del nombre (`widthCap`): hasta $5 en todos y hasta $10 solo en QQQ, SPY, IWM, DIA, GLD, XSP y UNH (`WIDE_NAMES`). En las acciones, nunca $10, salvo UNH (7 nov 2026, a petición del dueño): cerca del precio sus strikes van de 10 en 10 y con $5 no hay spread. Vale en las Reglas, en Hoy (`equalRisk`) y en el Buscador y la ficha (`qualityDeals`).
- **SPY y XSP** (`TWINS`): son la misma apuesta. En el Buscador, el que sale antes con el orden elegido es el candidato y las filas del otro llevan "mismo bloque que …" (si hay cierres para medirlo, "mismo grupo", más abajo).
- **Grupos de correlación** (`correlationGroups`, 30 oct 2026): correlación de Pearson de los rendimientos diarios (logarítmicos) de los últimos 250 cierres, alineados por el final de la serie, entre cada par de nombres de la lista. Con menos de 120 rendimientos en común (poca historia) no se mide y el nombre queda solo. Dos nombres con correlación ≥ `corrMin` (0,85 de fábrica, de 0,5 a 0,99, en Reglas) van al mismo grupo, y por transitividad los que se enlazan a través de otro. En el Buscador el que sale antes con el orden elegido es el candidato y los demás del grupo llevan "mismo grupo que X (0,91)" con su correlación con el candidato. No toca los bloques (ni los de la lista ni los de caer juntos) ni el punto "bloque nuevo" del nivel, ni puntuación, nivel, error, orden ni filtros.
- **Bloques por caer juntos** (`effectiveBlocks`, 7 nov 2026): los bloques del punto "bloque nuevo" del nivel. Para cada nombre, el rendimiento de cada tramo de 20 sesiones (`c[i+20] / c[i] − 1`, uno por sesión); "perfora" si es menor o igual que el de la posición `floor(0,13 × n)` de sus `n` tramos ordenados (el 13 % peor; `coFallBreaches`). Para cada par, la media de P(B perfora | A perfora) y P(A perfora | B perfora), con las series alineadas por el final y solo los tramos que tienen los dos (`coFallPair`; independientes darían 13 %). Enlace medio (`averageLinkage`): se unen los dos grupos con la media más alta entre todos sus pares mientras llegue a `blockCoFall` (40 % de fábrica, de 25 a 70 % de 5 en 5, en Reglas; sin subir `RULES_V`); a igualdad, el par cuyo primer miembro va antes en `universe.json`. Cada grupo de 2 o más es un bloque, "Grupo de X" (X = su primer miembro en `universe.json`), y sus nombres salen de su bloque de la lista; los sueltos y los que no se miden siguen en su bloque de la lista. No se miden: XSP (va siempre con SPY, `COFALL_FOLLOWS`), los que tienen menos de 750 cierres hasta el corte (hoy IBIT) y los dados de alta (`alta` en `universe.json`) después del corte, hasta el mes siguiente. Orden: primero los grupos (por su primer miembro) y luego los bloques de la lista que no se quedan vacíos.
  - **Nombre quitado a mitad de mes** (fila con `baja` en la lista, 10 nov 2026): ya no tiene bloque, pero si su baja es posterior al corte sigue contando para formar los grupos (con sus cierres, que `cierres.mjs` trae hasta fin de mes), así los demás grupos no cambian; después sale de su grupo, y un grupo que se queda con un solo nombre deja de serlo: ese nombre vuelve a su bloque de la lista. Lo guardado se migra con `migrateBlockNames`, como al cambiar de mes. Sin sus cierres, o con la baja anterior al corte, simplemente no cuenta.
  - **Corte:** el último día de mercado anterior al día 1 del mes de hoy (Nueva York; `blockCutoff`). Se quitan a todas las series las sesiones posteriores, contadas hacia atrás desde `last` con `sessionsBetween` (`closesUntil`). Si los cierres no llegan al corte, los del mes anterior (`mode: "previous"`); si tampoco, los de la lista. Así los bloques no cambian dentro del mes. Con los cierres hasta el 30 oct 2026 y la lista de 36 nombres: Grupo de SPY (20, con las tecnológicas grandes menos TSLA y NFLX, XLV, EFA, EEM, JPM y V), de XLE (XLE, XOM, USO), de GLD (GLD, SLV) y de XLP (XLP, XLU, TLT); Otras bolsas, Energía, Pagos y Bonos largos se quedan vacíos; GDX y UBER esperan en Metales y Consumo discrecional hasta diciembre.
  - **Dónde:** el nombre del barrido lleva `sym.be` (lo pone `web/bloques.js`); `sym.b` sigue siendo el de la lista (Fed, `allListSymbols`, búsqueda de texto, columna `bloque` del Registro). `blockOf(sym)` da el efectivo, y lo usan el punto "bloque nuevo" (`dealChecks`), Mis bloques, la marca del Mapa, Barras, el filtro de Bloque y las acciones por bloque del Buscador. Los bloques abiertos salen del símbolo de cada deal sin cerrar (`deal.s`), no de `deal.b`.
  - **Umbral:** el barrido y el Registro (`bloque_efectivo`) usan siempre el de fábrica; el dispositivo, el de Reglas.
- **Riesgo a la vista** (`riskTag`, `RISK_TAG` en `hoy-calc.js`): un deal con pierdes máx. de más de $500 lleva "arriesga más de $500" en su fila y en la ficha. No se oculta. No hay regla de riesgo por operación en Reglas; si se añade, la cifra debe salir de ella.
- **Orden por defecto de los avisos** (`config.order`): `rentexp`, la rentab. esperada; sin cierres, detrás y por rentabilidad neta (`compareSpreads`). Un orden guardado `equilibrio` pasa a `rentexp`.
- **Avisos del barrido:** avisa cualquier nombre de la lista que pase a cumplir. Un aviso por nombre y día. El primer barrido solo toma nota. Con el mercado cerrado no se avisa. Si el estado anterior no se puede leer (salvo 404), el barrido falla en vez de sobrescribir.
- `config.order` y `ORDERS` siguen en el motor porque el barrido de avisos los usa (ya no hay pantalla Lista).

## 1b. Por qué un nombre no da deals (`noDealReason`, 10 nov 2026)

Para la línea "Sin deals hoy" del Buscador. Un nombre sin ningún deal dentro de Reglas lleva **un** motivo: el de la etapa más lejana a la que llega alguno de sus spreads. Etapas, en orden (`NO_DEAL_REASONS`):

1. "sin opciones en el plazo" (sin cadena o sin vencimientos dentro del plazo de Reglas);
2. "ningún strike con la prob. de Reglas" (y, solo con la regla del % abajo encendida, "ningún strike con el % abajo de Reglas");
3. "no llega al cobro mínimo" (incluye los puts dentro de la prob. pero demasiado baratos, `tooCheap`);
4. "horquilla ancha" (antes, si la prob. solo sale de la fórmula de reserva, "prob. sin medir en el mercado");
5. "no cubre el coste de salir";
6. "rentab. esperada baja" (antes, sin cierres del nombre, "sin cierres para puntuar"); y, si hay algún interruptor encendido, "lo apartan tus interruptores".

Usa lo que ya dan `assessSymbol` (`stage`, `tooCheap`) y `gateReason`, con las Reglas del dispositivo; a precio medio la horquilla y el coste de salir no apartan, igual que en `qualityDeals`. Devuelve "" si el nombre tiene deal. No se guarda ni se publica. Las etapas 4 y 5 van antes que la rentab. esperada porque un precio poco fiable hace poco fiable esa cuenta.

## 2. Igual riesgo (`equalRisk`, `equalRiskList`, `withHistory`)

La pestaña "Igual riesgo" se quitó el 12 oct (su pantalla y sus controles); queda el motor, que usan Hoy, el Buscador y la ficha. No toca Reglas ni Avisos.

- **Corto:** el strike más alto cuya prob. no pasa del objetivo. Tolerancia de 3 puntos para "sin strike cerca". Con `orLess: true` ("X % o menos", lo que pasa Hoy) no hay ese límite inferior: vale el más cercano.
- **Largo:** el strike que deja el ancho más grande que no pasa del elegido, entre los que tienen precio. El ancho real se enseña en la fila si es distinto.
- **Coste de ida y vuelta** = (horquilla del corto + horquilla del largo) × 100 + 2 × comisión. La comisión (`equalFee`) es de 1,40 $ de fábrica, de 0 a 20, en la sección "Comisión y horquilla" de Reglas. No vive en `centinela.igual.v1` (`migrateEqualFee` pasa a las reglas la que alguien tuviera guardada antes).
- **Puertas** (`gateReason`), en este orden, antes de ordenar: (1) prob. de la fórmula de reserva; (2) horquilla del spread mayor que el límite de las reglas (`equalGapPct`, 35 % de fábrica, de 10 a 100, también en "Comisión y horquilla") sobre el crédito a precio medio, o crédito medio ≤ 0, o sin precio medio; (3) cobras neto menor que el coste de ida y vuelta. Las que fallan van al grupo gris con su motivo.
- **Resultados dentro del plazo:** no apartan la fila; la etiqueta roja lleva la fecha. La historia casi no contiene saltos de resultados, así que su número es menos fiable.
- **A precio medio** (`atMid`): rehace las cuentas con el crédito a precio medio y no aplica la puerta de horquilla (sí la de la fórmula de reserva). Es una hipótesis y la pantalla lo dice.
- **Controles guardados** de la pantalla antigua: prob. objetivo (chips 5, 8, 10 % y deslizador de 1 a 15 %), ancho y vencimiento, en `centinela.igual.v1`.

## 3. Con historia (`withHistory`)

- **T** = sesiones hasta el vencimiento (`sessionsBetween`, con tabla de festivos de EE. UU. hasta 2028: **ampliarla antes de que se acabe**).
- **Ventanas** de T sesiones de los cierres, llevadas al precio de hoy.
- **Prob. histórica** = parte que acaba bajo el corto.
- **Pérdida esperada histórica** = media de min(max(corto − final, 0), ancho) × 100.
- **Volatilidad reciente** = la mayor entre la realizada de 20 y de 60 sesiones, × √252.
- **Pérdida esperada reciente** = [L(corto) − L(largo)] × 100, sin tipo de interés.
- **Se espera pagar** = la MEDIA de las dos, no la mayor. Con 3 años de cierres de los 32 nombres de entonces, la mayor daba un 7,6 % a caídas que ocurrieron un 3,5 %; la media, un 5,8 %. Si la mayor es más de 3 veces la menor, nota "estimaciones muy distintas".
- **Rentab. esperada** = (cobras neto − se espera pagar) / pierdes máx. × 100. Es lo que ordena (de mayor a menor; sin cierres, detrás y por rentab. neta).
- **Equilibrio con historia** (`balanceHist`) = cobras neto / se espera pagar, con un decimal. Es un dato (la ficha lo enseña bajo la rentab. esperada), no ordena ni filtra: ordenar por una división dejaba salir primero spreads que cobran muy poco.
- **"Poca historia"** = menos de 2 años de cierres.
- **"Solo con un cálculo"** (`onlyOne`): (cobras neto − pérdida con historia) y (cobras neto − pérdida reciente) tienen distinto signo. Manda sobre "estimaciones muy distintas". En esos dos casos se añaden la volatilidad reciente y la de todos los cierres guardados (`volatilities`: desviación de los rendimientos diarios × √252); la ficha las enseña siempre.
- **Tendencia** (`trendNotes`): "en mínimos del año" (precio en el 10 % más bajo del rango de 52 semanas) y "bajo su media de 200" (media de los últimos 200 cierres).
- **Fed** (`fedInside`): etiqueta roja "Fed el 28 oct" en los bloques "Bonos largos" y "Bolsa EE. UU." si una decisión cae entre hoy y el vencimiento. `FED_DATES` (en `engine.js`) es una lista corta, como la de festivos: del calendario oficial (federalreserve.gov/monetarypolicy/fomccalendars.htm) hay hasta enero de 2028 (provisional). **Ampliarla cuando la Fed publique más y antes de que se acabe.**
- **Mensajes:** ninguna fila con rentab. esperada > 0; prob. objetivo por debajo del 5 %; precios tomados con el mercado cerrado (`pricesOutsideMarket`, cuenta los 15 min de retraso).

### Medias, cambio reciente e IV frente a la realizada (informativo)

- **Media de 50 días** (`sma`, `smaSeries`): media simple de los últimos 50 cierres guardados. La ficha enseña también cuánto está el precio por encima o por debajo. Sin 50 cierres, no sale.
- **Últimas 5 sesiones** (`changeOver`): el precio de ahora frente al cierre de hace 5 sesiones (el último cierre guardado cuenta como la sesión 1), en %.
- **Gráfico de precio** (`priceChart` en `hoy-calc.js`): el último año de cierres (hasta 252) más el precio de hoy, con la media de 50 y la de 200 días y el strike corto del deal. Sin 60 cierres, no sale.
- **Ninguna de las tres cosas entra en el nivel, en el orden, en los avisos ni en "Ocultar tendencia".**
- **Volatilidad en el Buscador** (`vol` en `centinela.buscador.v1`): IV alta = IV a 30 días ≥ 1,2 × la volatilidad realizada reciente (la mayor de 20 y 60 sesiones, la misma de `volatilities`); IV baja = ≤ 0,8 ×. Sin cierres o sin IV, el nombre no tiene dato y no sale en ninguna de las dos. Los umbrales (`VOL_HIGH`, `VOL_LOW` en `buscador.js`) son una propuesta del agente, no una regla del dueño.

## 4. Nivel de un deal (`dealChecks`, `levelCell`, `levelGrid`), de 0 a 5

Decidido el 8 oct tras la revisión del modelo.

- **0** si la rentab. esperada no pasa de 0 (o no hay cierres para calcularla). Si pasa, **1** más un punto por cada comprobación que se cumple (hasta 4).
- **5** = un 4 que, con la regla `"margin"`, deja lo que queda en al menos el doble del margen exigido (2 veces el error de fábrica). Con `"both"` el máximo es 4 y con `"off"` es 3.
- **Las tres comprobaciones:** (a) el punto de seguridad; (b) el coste de ida y vuelta, de hasta el 40 % de lo cobrado neto (`LEVEL_COST_PCT`); (c) que el bloque no esté ya abierto.
- **Punto de seguridad** (regla `levelSafety`, sección "Pestaña Hoy" de Reglas): `"margin"` (de fábrica) = lo que queda (cobras neto − se espera pagar) supera `levelMargin` veces el error (de 0,5 a 3, de media en media, 1 de fábrica); `"both"` = la historia y la volatilidad reciente salen las dos en positivo (la versión de antes); `"off"` = no cuenta y el nivel llega a 3. `room` = lo que queda partido por el error.
- **El punto bajo el número** solo se pinta en 1, 2 y 3 (en 4 y 5 va implícito): dice que lo que falta no es el margen.
- **Orden a igual nivel:** primero el suelo (lo que queda menos el error) y luego la rentab. esperada.
- **El nivel resume, no ordena por sí solo:** dos deals del mismo nivel pueden cumplir puntos distintos. Por eso la casilla lleva un punto cuando cumple el de seguridad y la ficha enseña los cuatro.
- **Casillas cerca de `room` = `levelMargin`** cambian de un día a otro con cualquier cambio pequeño de precios o de plazo: es esperable.
- **Casillas apartadas por una puerta** (`gateReason`): sin nivel, se ven con una H.
- **Vencimientos del mapa** (`mapExpiries`): los del plazo de Reglas que tiene al menos la mitad de los nombres, como mucho cinco.
- **Aguanta un mal año** (`badYear`, `badYearLeft` en `dealChecks`; 10 nov 2026): un deal aguanta un mal año si cobras neto − `badYearK` × se espera pagar > 0; `badYearLeft` es lo que queda (o falta) en dólares por contrato. `badYearK` es una regla de la sección "Pestaña Hoy": 1,5 de fábrica, de 1 a 3 de 0,25 en 0,25, sin subir `RULES_V`. De dónde sale el 1,5: con cierres semanales de 2012 a 2026 de 9 nombres, lo que se espera pagar prevé de media 1,33 veces lo que luego se pagó, pero en los años malos se queda corto (2015: 0,65; 2018: 0,75; 2022: 0,79), es decir, se pagó entre 1,3 y 1,5 veces lo previsto. **Es un dato y un filtro: no cambia el nivel, el punto de seguridad, el error, el orden ni los avisos.** Sin cierres para puntuar no hay dato. Se ve en la ficha, en el filtro "Mal año" del Buscador y en la columna `aguanta_mal_anio` del Registro (ahí siempre con el 1,5 de fábrica).
- **Estado de un deal apuntado** (`dealStatus`): "cerca" a menos del 3 % del corto. El recuento por nivel (`levelRecord`) usa el nivel que tenía al apuntarlo; cambiar la regla no reescribe el de los ya apuntados.

## 5. El error del cálculo

- **`err`** (de `withHistory`) = 0,5 × √(errHist² + errRecent²).
- **`errHist`** = error de la media de la pérdida histórica por lotes (`historyStats().se`: ventanas partidas en lotes seguidos de `sessions` ventanas, desviación de las medias de los lotes entre √lotes; con menos de 3 lotes, desviación de las ventanas entre √(ventanas/sesiones)). Va multiplicado por `errHistK` (×1 de fábrica, de 1 a 3 de media en media).
- **`errRecent`** = media de la diferencia entre la pérdida con la volatilidad reciente × (1 + b) y × (1 − b), con b = `errVolPct` (±10 % de fábrica, de 10 a 40 de 5 en 5).
- Las dos son reglas de la sección "Pestaña Hoy" de Reglas, con una nota al lado. Solo cambian el error (el ± de la ficha, la barra de Barras, el suelo y el punto de seguridad), no lo que se espera pagar ni el nivel 0. Igual riesgo sigue con los valores de fábrica.
- **Revisión del 8 oct:** con 5 años de los 32 nombres, la volatilidad del mes siguiente varió ±35 % y el error por lotes se quedó corto unas 2 veces. Con ±35 % y ×2, el nivel 4 del barrido del 7 oct pasaba de 37 casillas a 12. Es una estimación del orden de magnitud, no un intervalo exacto: a mano con bootstrap por bloques sale parecido.

## 6. Rentabilidad del deal (`returnsOf`) y vista Barras (`rangeOf`)

Solo presentación: no entran en el nivel ni en el orden.

- **Tres filas por contrato:** sin comisión (crédito × 100), con comisión (cobras neto) y esperada (cobras neto − se espera pagar). En cada una: dólares, dólares por día, % sobre lo que se arriesga ("pierdes máx.", con el ancho menos lo cobrado en la fila sin comisión) y ese % por día (días naturales hasta el vencimiento, sin anualizar).
- **Cabeceras en mayúscula:** G (gano), G/D, G/S (S = spread, lo que se arriesga), G/S/D. Bajo la tabla: los días al vencimiento, la leyenda de las letras, la comisión de abrir y lo que cuesta entrar y salir.
- **Orden por día:** dentro de un mismo vencimiento coincide con el de la rentab. esperada, por eso no hay orden por día en la nube.
- **Barras** (`rangeOf`): cada deal comparable del vencimiento elegido, en % de lo que se arriesga: rombo = cobras neto; punto = lo que queda de media (cobras neto − se espera pagar); línea de puntos entre los dos = se espera pagar; barra = ± el error (± `levelMargin` veces el error con la regla `"margin"`, así "la barra no toca el cero" es lo mismo que tener el punto de seguridad). La escala se corta por abajo en −2 %: lo que cae más allá lleva una flecha y su número. Enseña lo que la nube no: que dos deals con la misma rentab. esperada pueden cobrar cantidades muy distintas y tener un error muy distinto. El coste de ida y vuelta va como número en la fila.
- **Orden de las filas** (`rangeOrder`, `hoy.barSort` en `centinela.hoy.v1`): "Lo que queda" (de fábrica) o "El suelo" = lo que queda menos el error, el extremo izquierdo de la barra; con el suelo, la cifra de la derecha de cada fila es el suelo. Es un desempate entre deals parecidos, no un nivel.
- **Descartado:** un nivel 5 por desempate (el 7 oct cumplían todo 0 casillas de 383 y el 6 oct 3 de 417, las tres el mismo deal) y que la Fed reste puntos (medido con 5 años de cierres: casi todos los plazos llevan una reunión dentro y las caídas fuertes no son más frecuentes con ella).

## Historial: la fila de la pantalla Igual riesgo (quitada)

Se conserva para entender nombres que siguen en el motor: cabecera con la rentab. esperada (o "rentab. neta" sin cierres); línea de cobras neto, coste total y pierdes máx.; píldoras (resultados y Fed en rojo, tendencia, "poca historia", "estimaciones muy distintas", "los dos cálculos no coinciden" = `onlyOne`); líneas de probabilidades (asignación de mercado, de historia, pérdida máx.) y volatilidades (implícita 30 d, ahora, 5 años); una línea plegable con "se espera pagar · queda · equilibrio". Sus variables `state.eqOpen` y `state.eqHelp` ya no existen. La ficha de Hoy enseña lo equivalente.

## Registro de deals (`scanner/registro.mjs`, `web/registro-calc.js`)

- **Qué guarda (desde el 31 oct 2026):** los deals de **todos los niveles (0 a 5)** con rentab. esperada calculable, dentro y fuera de las **reglas de fábrica** (`DEFAULT_RULES`, no las del dueño: el repositorio es público), en una sola foto al día. Sin los niveles bajos no se puede comparar si los altos rinden más. Hasta el 30 oct solo se guardaban los de nivel 3 o más del último barrido; esas filas no se reescriben (sus tres columnas nuevas quedan vacías). Columnas en `COLUMNS` (y, en claro, en `registro/columnas.txt`): fecha, primera aparición, nombre, vencimiento, corto, largo, ancho, cobro neto, nivel, rentab. esperada, error, pérdida esperada con la historia, con la volatilidad, **desacuerdo** (valor absoluto de su diferencia, en dólares por contrato), prob. de mercado, bloque, grupo de correlación (con `corrMin` de fábrica), resultados dentro del plazo, cierre al vencimiento, resultado y estado.
- **La foto del día** (`photoTime`, `takesPhoto`, `updateRows` con `keepToday`): el primer barrido con el mercado abierto entre las **14:45 y las 15:45 de Nueva York** (`America/New_York`: sigue el cambio de hora solo; los dos extremos cuentan). Antes de esa franja, o si el día no tiene ningún barrido en ella (cierre anticipado, un fallo), cada barrido deja una foto de reserva que el siguiente sustituye, y queda la del último barrido con el mercado abierto. Con la foto de la franja hecha, los barridos de después no la tocan (solo apuntan lo vencido). Una sola foto al día. Columnas nuevas, al final: `hora_ny` (HH:MM del barrido), `en_ventana` (sí/no) y `dentro_reglas` (sí/no: si Centinela lo habría propuesto). El análisis de la pestaña sigue con lo de antes: solo nivel 3 o más y dentro de Reglas (las filas antiguas cuentan como dentro).
- **Primera aparición:** el mismo spread (nombre, vencimiento, strikes) sale muchos días; se guarda cada día y solo la primera fila lleva `primera_aparicion = 1`. El análisis usa solo esas.
- **Resolver:** al vencer, con el cierre del subyacente de ese día (`closeOn`, sobre `historia/cierres.json`; en festivo, el de la sesión anterior): resultado por contrato = cobro neto − pérdida al vencimiento, con la pérdida = (corto − cierre, entre 0 y el ancho) × 100. Positivo = ganado; si no, perdido. Se resuelve en el siguiente barrido tras el cierre diario (`cierres.yml`).
- **Tamaño:** medido con el barrido real del 30 oct (39 nombres): 1.829 filas y ~213 KB por día con todos los niveles (antes 1.371 filas y ~147 KB), unos 4,4 MB al mes en `registro/AAAA-MM.csv`.
- **Desacuerdo:** solo se guarda. No entra en el error, el nivel, el orden ni los filtros.
- **`aguanta_mal_anio`** (sí/no, última columna, 10 nov 2026): si el deal aguanta un mal año (§4) con el `badYearK` de fábrica, nunca con el del dueño. Las filas anteriores quedan vacías.
- **Días con algún deal** (`daysWithDeal`): por cada nombre de la lista, en cuántos de los últimos 30 días registrados tuvo al menos una fila con `dentro_reglas = sí` (las antiguas sin el dato cuentan como dentro) y nivel de 1 o más. Un nombre con `alta` solo se compara con los días desde su alta. Con las reglas de fábrica.
