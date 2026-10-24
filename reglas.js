// Pestaña Reglas: los topes, los interruptores y los números que mandan en toda la app.

import { PROB_OFF } from "./engine.js";

export function createReglas(ctx) {
  const { state, esc, num, sectionHead, changeConfig, refreshBox, syncLine, foot, conexion, copia, DEFAULT_CONFIG } = ctx;

  function stepper(path, label, hint, min, max, step, format) {
    const value = path.split(".").reduce((obj, key) => obj[key], state.config);
    return `<div class="field">
      <div class="txt"><b>${label}</b><span class="small muted">${hint}</span></div>
      <div class="stepper">
        <button data-step="${path}" data-dir="-1" data-min="${min}" data-max="${max}" data-by="${step}" aria-label="Bajar ${esc(label)}">−</button>
        <span>${format(value)}</span>
        <button data-step="${path}" data-dir="1" data-min="${min}" data-max="${max}" data-by="${step}" aria-label="Subir ${esc(label)}">+</button>
      </div>
    </div>`;
  }

  function gate(key, title, hint, inner = "") {
    const on = state.config.rules.gates[key];
    return `<div class="gate">
      <button role="switch" aria-checked="${on}" data-gate="${key}">
        <span style="min-width:0"><b>${title}</b><span class="small muted">${hint}</span></span>
        <span class="switch"><i></i></span>
      </button>
      ${on ? inner : ""}
    </div>`;
  }

  function viewReglas() {
    const r = state.config.rules;
    const days = (n) => `${n} d`;
    const p0 = (n) => `${num(n, 0)} %`;
    const d0 = (n) => `$${num(n, 0)}`;
    return `<div class="narrow">
      <header class="top">
        <h1 class="sr-only">Reglas</h1>
        <div class="top-row"><button class="btn primary" data-act="reload" ${state.loading || state.checking ? "disabled" : ""}>${state.loading || state.checking ? "Actualizando…" : "Actualizar"}</button></div>
        ${refreshBox()}
        <p class="small muted" style="margin-top:12px">Filtran tu lista al instante en este dispositivo. ${esc(syncLine())}</p>
      </header>
      <div class="panel">
        ${stepper("rules.minDte", "Vencimiento desde", "No mires puts que caduquen antes.", 5, 60, 1, days)}
        ${stepper("rules.maxDte", "Vencimiento hasta", "Ni los que caduquen después.", 5, 60, 1, days)}
        ${stepper("rules.maxProb", "Prob. de asignación máxima", "Elige el corto: en cada nombre, los puts con esta probabilidad o menos de acabar en dinero.", 1, PROB_OFF, 1, (n) => (n >= PROB_OFF ? "sin límite" : p0(n)))}
        ${stepper("rules.width", "Ancho máximo del spread", "Dólares entre el put que vendes y el que compras. Vale ese ancho y cualquiera menor.", 1, 50, 1, d0)}
        ${stepper("rules.minCredit", "Cobras, mínimo", "Crédito por contrato, en dólares. Por debajo, el spread no pasa.", 0, 500, 5, (n) => (n <= 0 ? "sin mínimo" : d0(n)))}
        ${stepper("rules.minRetExp", "Rentab. esperada mínima", "Cobras neto menos lo que se espera pagar, sobre lo que arriesgas. Por debajo, sale como fuera de Reglas.", -5, 5, 0.1, (n) => `${n > 0 ? "+" : ""}${num(n, 1)} %`)}
        <div class="gate">
          <button role="switch" aria-checked="${r.otmOn}" data-rule-switch="otmOn">
            <span style="min-width:0"><b>Limitar además el % abajo</b><span class="small muted">Apagado, el % abajo es solo una columna. Encendido, el corto tiene que caer además en este tramo.</span></span>
            <span class="switch"><i></i></span>
          </button>
          ${
            r.otmOn
              ? stepper("rules.minOtm", "% abajo, desde", "El put corto, como mínimo así de lejos del precio.", 1, 30, 1, p0) +
                stepper("rules.maxOtm", "% abajo, hasta", "Y como máximo así de lejos.", 1, 35, 1, p0)
              : ""
          }
        </div>
      </div>

      <section class="block">
        ${sectionHead("Si lo enciendes")}
        <p class="small muted">Apagado, no cuenta. Encendido, el nombre deja de cumplir y la lista dice por qué.</p>
        <div class="panel">
          ${gate("event", "Sin resultados en el plazo", "Hasta dos días después del vencimiento.")}
          ${gate(
            "liquid",
            "Corto con mercado",
            "Interés abierto en el corto y horquilla que no se coma el crédito.",
            stepper("rules.gates.oiMin", "Interés abierto mínimo", "Contratos abiertos en el put corto.", 0, 5000, 50, (n) => num(n, 0)) +
              stepper("rules.gates.spreadPct", "Horquilla máxima", "Suma de las dos horquillas, sobre el crédito a precio medio.", 5, 100, 5, p0),
          )}
          ${gate(
            "loss",
            "Pérdida por contrato",
            "El ancho menos el crédito, en dólares.",
            stepper("rules.gates.lossMin", "Desde", "Por debajo de esto, no pasa.", 20, 2000, 10, d0) +
              stepper("rules.gates.lossMax", "Hasta", "Por encima, tampoco.", 20, 5000, 10, d0),
          )}
          ${gate("room", "Fuera del movimiento", "El corto, más lejos que la mitad de lo que el mercado espera que se mueva el precio.")}
        </div>
      </section>

      <section class="block">
        ${sectionHead("Pestaña Hoy")}
        <p class="small muted">Solo cuenta ahí. Usa la comisión y la horquilla de la sección de abajo.</p>
        <div class="panel">
          <div class="field stack">
            <div class="txt"><b>Punto de seguridad del nivel</b><span class="small muted">Es uno de los puntos que suman al nivel. Elige qué se le pide a lo que queda tras pagar lo que se espera.</span></div>
            <div class="seg" role="group" aria-label="Punto de seguridad" style="margin:10px 0 4px">
              ${[["margin", "Con margen"], ["both", "Los dos cálculos"], ["off", "No cuenta"]].map(([id, label]) => `<button data-rule-set="levelSafety" data-v="${id}" aria-pressed="${state.config.rules.levelSafety === id}">${label}</button>`).join("")}
            </div>
            <p class="small muted">${{ margin: "Lo que queda (cobras neto menos lo que se espera pagar) tiene que superar el error del cálculo. Es lo que se puede equivocar esa media: cambia con los años de historia y con la volatilidad.", both: "La historia de 5 años y la volatilidad reciente tienen que salir las dos en positivo. Corta en el cero: −0,05 y −5 cuentan igual.", off: "El nivel llega a 3. Los dos cálculos se siguen viendo en la ficha." }[state.config.rules.levelSafety]}</p>
          </div>
          ${state.config.rules.levelSafety === "margin" ? stepper("rules.levelMargin", "Margen exigido", "Cuántas veces tiene que caber el error en lo que queda. 1 es lo mínimo; más es más exigente.", 0.5, 3, 0.5, (n) => `${num(n, 1)} ${n === 1 ? "vez" : "veces"}`) : ""}
          ${stepper("rules.errVolPct", "Error: volatilidad", "Cuánto se supone que puede variar la volatilidad reciente en el plazo del deal. ±10 % de fábrica.", 10, 40, 5, (n) => `±${n} %`)}
          ${stepper("rules.errHistK", "Error: historia", "Por cuánto se multiplica el error de la media de 5 años. ×1 de fábrica.", 1, 3, 0.5, (n) => `×${num(n, 1)}`)}
          <p class="small muted" style="margin:8px 0 2px">Nota: estos dos solo cambian el error (el ± de la ficha, la barra de Barras, el suelo y el punto de seguridad), no lo que se espera pagar ni el nivel 0. Medido con 5 años de los 32 nombres, la volatilidad del mes siguiente varió de verdad unos ±35 % y el error de la historia se quedó corto unas 2 veces. Si ves el mercado peor, sube a ±35 % y ×2: con el barrido del 7 oct, el nivel 4 pasaba de 37 casillas a 12.</p>
        </div>
      </section>

      <section class="block">
        ${sectionHead("Comisión y horquilla")}
        <div class="panel">
          ${stepper("rules.equalFee", "Comisión por spread al abrir", "Lo que cobra tu broker por abrir un spread, en dólares. Se descuenta del cobro, y para salir cuenta otra vez en el coste total (entrar y salir).", 0, 20, 0.1, (n) => `$${num(n, 2)}`)}
          ${stepper("rules.equalGapPct", "Horquilla máxima", "Las dos horquillas, sobre el crédito a precio medio. Por encima, la fila se aparta.", 10, 100, 5, p0)}
        </div>
      </section>

      <section class="block">
        ${sectionHead("Cómo se calcula")}
        <div class="panel">
          <details>
            <summary>Las columnas, una a una</summary>
            <dl>
              <div><dt>Crédito (cobras)</dt><dd>Bid del put corto menos ask del put largo, por 100. Es el precio al que entra seguro, no el medio.</dd></div>
              <div><dt>% del ancho</dt><dd>Crédito partido por el ancho.</dd></div>
              <div><dt>Pérdida máx.</dt><dd>Ancho menos crédito, por 100.</dd></div>
              <div><dt>Rentabilidad</dt><dd>Crédito partido por la pérdida máxima.</dd></div>
              <div><dt>Prob. de asignación</dt><dd>Probabilidad de que el precio acabe por debajo del corto el día del vencimiento, tal como la descuentan los precios: lo que cambia el precio del put al subir un dólar el strike, medido con los dos strikes vecinos a precio medio. Es la misma cuenta que el crédito partido por el ancho de un spread estrecho. Si faltan precios para medirla, se usa la fórmula con la volatilidad implícita del strike y la ficha lo dice. No mide la asignación anticipada.</dd></div>
              <div><dt>Rentab. esperada</dt><dd>(Cobras neto − se espera pagar) ÷ pierdes máx. Cobras neto = crédito × 100 menos la comisión. Se espera pagar = la media de la pérdida esperada con 5 años de cierres y con la volatilidad reciente. Es lo que ordena. Sin cierres del nombre, se ordena detrás por la rentabilidad neta.</dd></div>
              <div><dt>Equilibrio</dt><dd>Cobras neto ÷ se espera pagar. Es un dato de la ficha: no ordena ni filtra.</dd></div>
              <div><dt>Movimiento esperado</dt><dd>Precio × volatilidad implícita al dinero × raíz de (días / 365).</dd></div>
            </dl>
          </details>
        </div>
      </section>

      ${copia.view()}
    ${conexion.block()}
      ${conexion.bridge()}

      <button class="btn quiet" style="margin-top:16px" data-act="reset">Volver al bull put de mesa</button>
      ${foot()}
    </div>`;
  }


  function setPath(config, path, value) {
    const keys = path.split(".");
    let obj = config;
    for (const key of keys.slice(0, -1)) obj = obj[key];
    obj[keys.at(-1)] = value;
  }

  const PAIRS = { "rules.maxDte": "rules.minDte", "rules.maxOtm": "rules.minOtm", "rules.gates.lossMax": "rules.gates.lossMin" };

  /** Clic en un control de las reglas; devuelve true si era suyo. */
  function click(el) {
    if (el.dataset.step) {
      const path = el.dataset.step;
      const current = path.split(".").reduce((obj, key) => obj[key], state.config);
      const by = Number(el.dataset.by);
      const next = Math.min(Number(el.dataset.max), Math.max(Number(el.dataset.min), Math.round((current + Number(el.dataset.dir) * by) * 100) / 100));
      changeConfig((config) => {
        setPath(config, path, next);
        const low = PAIRS[path];
        if (low && low.split(".").reduce((obj, key) => obj[key], config) > next) setPath(config, low, next);
      });
    } else if (el.dataset.gate) {
      changeConfig((config) => {
        config.rules.gates[el.dataset.gate] = !config.rules.gates[el.dataset.gate];
      });
    } else if (el.dataset.ruleSet) {
      changeConfig((config) => {
        config.rules[el.dataset.ruleSet] = el.dataset.v;
      });
    } else if (el.dataset.ruleSwitch) {
      changeConfig((config) => {
        config.rules[el.dataset.ruleSwitch] = !config.rules[el.dataset.ruleSwitch];
      });
    } else if (el.dataset.act === "reset") {
      changeConfig((config) => {
        config.rules = structuredClone(DEFAULT_CONFIG.rules);
        config.order = DEFAULT_CONFIG.order;
      });
    } else return false;
    return true;
  }

  return { view: viewReglas, click };
}
