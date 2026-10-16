# Cálculo: reglas, historia, nivel y error

Lo que hace el motor (`web/engine.js`, puro, compartido por la app y el barrido). **Ninguna de estas reglas se cambia sin preguntar al dueño.**
Lo que se ve en pantalla está en `docs/interfaz.md`; de dónde salen los datos, en `docs/operacion.md`.

## 1. Reglas básicas

- **Crédito a precio natural:** bid del corto menos ask del largo.
- **Prob. de asignación:** la que descuenta el mercado, sacada del precio de los strikes vecinos a precio medio y alisada para que no baje al subir el strike (`marketProbs`). Si no se puede medir, la fórmula con la IV del strike (`probBelow`), y el spread lo marca con `probSrc: "formula"`.
- **Prob. máxima:** es la regla que elige el corto (10 % de fábrica, 50 = sin límite).
- **% abajo:** columna y regla opcional (`otmOn`).
- **Crédito mínimo:** en dólares por contrato (`minCredit`), no en % del ancho. Esa regla forzaba una probabilidad de pérdida mínima.
- **Versión de las reglas:** `v: 2`; las guardadas sin ella se migran en `normalizeRules`.
- **Rentabilidad:** crédito / pérdida máxima.
- **Equilibrio:** ganancia esperada / pérdida esperada = rentabilidad × (100 − prob.) / prob. (`balanceOf`). Regla de equilibrio mínimo: `minBalance`, 0,5 por defecto, 0 = sin mínimo.
- **Ancho:** el de las reglas es un máximo. Para cada corto se consideran todos los largos que dejan ese ancho o menos.
- **Orden por defecto:** equilibrio entre baja probabilidad de asignación y buena rentabilidad.
- **Avisos del barrido:** avisa cualquier nombre de la lista que pase a cumplir. Un aviso por nombre y día. El primer barrido solo toma nota. Con el mercado cerrado no se avisa. Si el estado anterior no se puede leer (salvo 404), el barrido falla en vez de sobrescribir.
- `config.order` y `ORDERS` siguen en el motor porque el barrido de avisos los usa (ya no hay pantalla Lista).

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
- **Se espera pagar** = la MEDIA de las dos, no la mayor. Con 3 años de cierres de los 32 nombres, la mayor daba un 7,6 % a caídas que ocurrieron un 3,5 %; la media, un 5,8 %. Si la mayor es más de 3 veces la menor, nota "estimaciones muy distintas".
- **Rentab. esperada** = (cobras neto − se espera pagar) / pierdes máx. × 100. Es lo que ordena (de mayor a menor; sin cierres, detrás y por rentab. neta).
- **Equilibrio con historia** = cobras neto / se espera pagar, con un decimal. Es un dato, no ordena: ordenar por una división dejaba salir primero spreads que cobran muy poco.
- **"Poca historia"** = menos de 2 años de cierres.
- **"Solo con un cálculo"** (`onlyOne`): (cobras neto − pérdida con historia) y (cobras neto − pérdida reciente) tienen distinto signo. Manda sobre "estimaciones muy distintas". En esos dos casos se añaden la volatilidad reciente y la de todos los cierres guardados (`volatilities`: desviación de los rendimientos diarios × √252); la ficha las enseña siempre.
- **Tendencia** (`trendNotes`): "en mínimos del año" (precio en el 10 % más bajo del rango de 52 semanas) y "bajo su media de 200" (media de los últimos 200 cierres).
- **Fed** (`fedInside`): etiqueta roja "Fed el 28 oct" en los bloques "Bonos largos" y "Bolsa EE. UU." si una decisión cae entre hoy y el vencimiento. `FED_DATES` (en `engine.js`) es una lista corta, como la de festivos: del calendario oficial (federalreserve.gov/monetarypolicy/fomccalendars.htm) hay hasta enero de 2028 (provisional). **Ampliarla cuando la Fed publique más y antes de que se acabe.**
- **Mensajes:** ninguna fila con rentab. esperada > 0; prob. objetivo por debajo del 5 %; precios tomados con el mercado cerrado (`pricesOutsideMarket`, cuenta los 15 min de retraso).
- El equilibrio de las Reglas no usa nada de esto.

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
