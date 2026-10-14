// Pestaña "Hoy": el flujo nuevo, de lo ancho a lo estrecho.
//
//   1. Mapa   — nombres por vencimientos, cada casilla con su nivel de 0 a 4: ¿hay algo hoy?
//   2. Nube   — los deals de un vencimiento, coste frente a rentab. esperada: ¿cuál?
//      Barras — los mismos deals, una fila cada uno: lo que cobra, lo que se espera pagar y lo que queda con su error.
//   3. Ficha  — una sola para Hoy, Deals y Lista: el ticket (cobras, apartas, te queda), avisos, cinco bloques plegables
//      (por qué ese nivel, precio y volatilidad, rentabilidad, probabilidades, al bróker) y los deals puntuados del nombre: ¿me lo creo?
//   4. Resumen para el bróker — texto para copiar. La app no envía órdenes ni sabe de ningún bróker.
//   5. Mis deals — lo abierto y lo cerrado, con el nivel que tenía cada uno: vigilar y aprender.
//
// Todo lo que se elige o se apunta aquí vive solo en el dispositivo (`localStorage`).
// Las cuentas son las de "Igual riesgo"; el nivel y el mapa están en el motor (`levelGrid`, `dealChecks`).
// No toca Lista, Deals, Igual riesgo, Avisos ni Reglas.

import {
  LEVEL_COST_PCT,
  PROB_OFF,
  atMid,
  dealChecks,
  dealStatus,
  fmtStrike,
  gateReason,
  labelOf,
  levelGrid,
  levelRecord,
  mapExpiries,
  monthRange,
  num,
  nyToday,
  pricesOutsideMarket,
  qualityDeals,
  rangeOf,
  rangeOrder,
  returnsOf,
  spreadRow,
  volatilities,
  withHistory,
  yearRange,
} from "./engine.js";

const LS_HOY = "centinela.hoy.v1";
const LS_DEALS = "centinela.misdeals.v1";
const PROBS = [5, 8, 10];
const PROB_MIN = 3; // la barra de prob. va de 3 a 20 % en pasos de 1 punto: "X % o menos" (20 % es el mismo tope que usa Deals)
const PROB_MAX = 20;
const probOk = (v) => Number.isInteger(v) && v >= PROB_MIN && v <= PROB_MAX;
const WIDTHS = [2, 3, 5, 10];
const FL_PROBS = [5, 8, 10, 15]; // filtro de prob. de la lista de deals de la ficha
const FOLDS = ["why", "vol", "ren", "prob", "bro"]; // los bloques plegables de la ficha
const VIEWS = ["mapa", "nube", "barras", "mis"];
const MAX_DEALS = 300;

const usd2 = (n) => `$${num(n, 2)}`;
const dollars = (n) => (Math.abs(n) >= 10 ? `$${num(Math.round(n), 0)}` : usd2(n));
const signedUsd = (n) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${dollars(Math.abs(n))}`;
const signedPct = (n) => `${n > 0 ? "+" : ""}${num(n, 1)} %`;
const nearest = (list, value) => list.reduce((best, item) => (Math.abs(item - value) < Math.abs(best - value) ? item : best), list[0]);
const dealKey = (row) => `${row.expiry}|${row.shortStrike}|${row.longStrike}`;
/** "0,17" o "12,5" escrito a mano → número. Acepta coma o punto. */
const parseNumber = (text) => {
  const clean = String(text ?? "").trim().replace(/\s/g, "").replace("−", "-").replace(",", ".");
  return /^-?\d+(\.\d+)?$/.test(clean) ? Number(clean) : NaN;
};

export function createHoy(ctx) {
  const { state, esc } = ctx;

  // ---------- lo guardado en el dispositivo ----------

  const saved = ctx.readLocal(LS_HOY) ?? {};
  const hoy = {
    view: VIEWS.includes(saved.view) ? saved.view : "mapa",
    prob: probOk(saved.prob) ? saved.prob : null,
    width: WIDTHS.includes(saved.width) ? saved.width : null,
    price: saved.price === "mid" ? "mid" : "nat",
    held: Array.isArray(saved.held) ? saved.held.filter((name) => typeof name === "string").slice(0, 40) : [],
    expiry: typeof saved.expiry === "string" ? saved.expiry : null,
    barSort: saved.barSort === "floor" ? "floor" : "left", // orden de la vista Barras: por lo que queda o por el suelo
    folds: Array.isArray(saved.folds) ? saved.folds.filter((id) => FOLDS.includes(id)) : [], // bloques de la ficha que estaban abiertos
    // solo en memoria
    deal: null, // ficha abierta: { s, expiry, short, long } o { s, none: true } si el nombre no tiene deals puntuados
    fl: { lv: [0, 1, 2, 3, 4, 5], exp: null, w: null, pr: null, hide: false, ord: "lv", shown: 30 }, // filtros de la lista de deals de la ficha
    heldOpen: false,
    mapExp: null, // el mapa enfocado en un vencimiento (null = todas las fechas)
    legendOpen: false, // la leyenda del mapa, plegada al final de la matriz
    help: false,
    form: null, // "abrir" o { close: id }
    error: "",
    copied: "",
    confirm: null, // id del deal que se va a borrar
  };
  const keep = () => ctx.writeLocal(LS_HOY, { view: hoy.view, prob: hoy.prob, width: hoy.width, price: hoy.price, held: hoy.held, expiry: hoy.expiry, folds: hoy.folds, barSort: hoy.barSort });

  const cleanDeal = (row) => {
    if (!row || typeof row !== "object" || typeof row.id !== "string" || typeof row.s !== "string" || typeof row.expiry !== "string") return null;
    const n = (value, fallback = null) => (typeof value === "number" && Number.isFinite(value) ? value : fallback);
    if (n(row.short) == null || n(row.long) == null || n(row.credit) == null) return null;
    return {
      id: row.id.slice(0, 24),
      s: row.s.slice(0, 8),
      b: typeof row.b === "string" ? row.b.slice(0, 40) : "",
      expiry: row.expiry.slice(0, 10),
      short: row.short,
      long: row.long,
      credit: row.credit,
      qty: Math.min(50, Math.max(1, Math.round(n(row.qty, 1)))),
      fee: n(row.fee, 0),
      openedAt: n(row.openedAt, 0),
      level: n(row.level),
      retExp: n(row.retExp),
      price0: n(row.price0),
      closedAt: n(row.closedAt),
      result: n(row.result),
    };
  };
  const rawDeals = ctx.readLocal(LS_DEALS);
  let deals = (Array.isArray(rawDeals) ? rawDeals : []).map(cleanDeal).filter(Boolean).slice(0, MAX_DEALS);
  const keepDeals = () => ctx.writeLocal(LS_DEALS, deals);
  const openDeals = () => deals.filter((deal) => !deal.closedAt);
  const cobrado = (deal) => deal.credit * 100 * deal.qty - deal.fee * deal.qty;

  // ---------- opciones y cuentas ----------

  /** Bloques que ya están abiertos: los que él marca a mano y los de sus deals apuntados sin cerrar. */
  const heldBlocks = () => [...new Set([...hoy.held, ...openDeals().map((deal) => deal.b).filter(Boolean)])];

  function options() {
    const rules = state.config.rules;
    const symbols = ctx.listSymbols();
    const today = nyToday();
    const expiries = mapExpiries(symbols, rules, today);
    return {
      symbols,
      today,
      expiries,
      rules,
      opts: {
        prob: hoy.prob ?? nearest(PROBS, rules.maxProb >= PROB_OFF ? 10 : rules.maxProb),
        width: hoy.width ?? nearest(WIDTHS, rules.width),
        fee: rules.equalFee,
        gapPct: rules.equalGapPct,
        safety: rules.levelSafety,
        marginK: rules.levelMargin,
        errVol: rules.errVolPct,
        errHistK: rules.errHistK,
        hist: state.hist?.symbols ?? null,
        held: heldBlocks(),
        price: hoy.price,
        orLess: true,
        expiries,
      },
    };
  }

  /** La fila de un deal concreto, con las cuentas de "Igual riesgo", a precio natural y a precio medio. */
  function dealRows(sym, deal, opts, today) {
    const nat = withHistory(spreadRow(sym, deal.expiry, deal.short, deal.long, opts.fee, today), opts.hist?.[sym.s], today, { volPct: opts.errVol, histK: opts.errHistK });
    if (nat.status !== "ok") return { nat: null, mid: null, row: null, why: nat.why };
    const mid = atMid(nat, opts.fee);
    return { nat, mid, row: opts.price === "mid" && mid ? mid : nat };
  }

  // ---------- piezas ----------

  const chip = (action, value, label, on) => `<button class="chip quiet" data-hoy="${action}" data-v="${esc(value)}" aria-pressed="${on}">${label}</button>`;
  const levelTag = (level, extra = "") => `<span class="lv lv${level}${extra}">${level}</span>`;

  function segmented() {
    const open = openDeals().length;
    const item = (id, label) => `<button data-hoy="view" data-v="${id}" aria-pressed="${hoy.view === id}">${label}</button>`;
    return `<div class="seg" role="group" aria-label="Vistas de Hoy">${item("mapa", "Mapa")}${item("nube", "Nube")}${item("barras", "Barras")}${item("mis", `Mis deals${open ? ` · ${open}` : ""}`)}</div>`;
  }

  function controls(o) {
    const blocks = ctx.blockOrder();
    const held = o.opts.held;
    const fromDeals = openDeals().map((deal) => deal.b).filter(Boolean);
    return `<div class="filters">
      <div class="frow" role="group" aria-label="Prob. de asignación, de ${PROB_MIN} % a ${PROB_MAX} %"><span class="small muted hoy-lab">Prob. hasta</span>
        <input type="range" class="range" id="hoy-range" min="${PROB_MIN}" max="${PROB_MAX}" step="1" value="${o.opts.prob}" aria-label="Prob. de asignación máxima">
        <b class="num" id="hoy-range-val" style="min-width:3.2em;text-align:right">${o.opts.prob} %</b></div>
      <div class="frow" role="group" aria-label="Ancho máximo"><span class="small muted hoy-lab">Ancho hasta</span>${WIDTHS.map((n) => chip("width", n, `$${n}`, o.opts.width === n)).join("")}</div>
      <div class="frow" role="group" aria-label="Precio"><span class="small muted hoy-lab">Precio</span>${chip("price", "nat", "Bid/Ask", hoy.price === "nat")}${chip("price", "mid", "Mid", hoy.price === "mid")}</div>
      ${
        hoy.heldOpen
          ? `<div class="frow hoy-wrap" role="group" aria-label="Bloques que ya tengo"><button class="small muted hoy-lab hoy-lab-btn" data-hoy="held-open" aria-expanded="true">Ya tengo ▴</button><div class="hoy-mine">${blocks
              .map((name) => `<button class="chip quiet" data-hoy="held" data-v="${esc(name)}" aria-pressed="${held.includes(name)}" ${fromDeals.includes(name) ? "disabled" : ""}>${esc(name)}</button>`)
              .join("")}<button class="chip quiet hoy-edit" data-hoy="held-open" aria-expanded="true">Listo</button></div></div>
            <p class="xs muted hoy-mine-note">Marca los bloques en los que ya tienes algo abierto. Un deal de un bloque marcado no suma el punto de bloque nuevo.${fromDeals.length ? " Los de tus deals apuntados se marcan solos." : ""} Solo en este dispositivo.</p>`
          : `<div class="frow" role="group" aria-label="Bloques que ya tengo"><button class="small muted hoy-lab hoy-lab-btn" data-hoy="held-open" aria-expanded="false">Ya tengo ▾</button>${held
              .map((name) => `<button class="chip quiet" data-hoy="held-open" aria-pressed="true">${esc(name)}</button>`)
              .join("")}${held.length ? "" : '<button class="chip quiet" data-hoy="held-open">ninguno</button>'}</div>`
      }
    </div>`;
  }

  /** Los avisos de abajo del todo: si el precio es una hipótesis y qué reglas mandan. Van al final para no empujar lo importante. */
  const notes = (o) => `${hoy.price === "mid" ? '<p class="banner small" style="margin-top:14px">A precio medio: es una hipótesis. Nadie garantiza que te llenen a ese precio.</p>' : ""}
    <button class="rules-line small" style="margin-top:${hoy.price === "mid" ? 8 : 14}px" data-tab="reglas">Plazo ${o.rules.minDte}–${o.rules.maxDte} días · comisión ${usd2(o.opts.fee)} · horquilla máxima ${o.opts.gapPct} % · se cambian en Reglas</button>`;

  // Cómo se llama el punto de seguridad según la regla (Reglas > Pestaña Hoy).
  const safetyText = (opts) =>
    opts.safety === "both"
      ? { short: "los dos cálculos en positivo", legend: "con punto: los dos cálculos en positivo" }
      : { short: "margen", legend: `con punto: lo que queda supera ${opts.marginK === 1 ? "el error" : `${num(opts.marginK, 1)} veces el error`}` };

  const legend = (opts) => `<p class="hoy-legend xs muted" style="margin:10px 0 0">
      <span class="hoy-pair"><span class="lv lv0">0</span>no cubre</span>
      <span class="hoy-pair"><span class="lv lv1">1</span><span class="lv lv2">2</span><span class="lv lv3">3</span>${opts.safety === "off" ? "" : '<span class="lv lv4">4</span>'}${opts.safety === "off" ? "a favor" : "todo a favor"}</span>
      ${opts.safety === "margin" ? `<span class="hoy-pair"><span class="lv lv5">5</span>todo a favor y lo que queda supera ${opts.marginK === 1 ? "2 veces" : `${num(2 * opts.marginK, 1)} veces`} el error</span>` : ""}
      ${opts.safety === "off" ? "" : `<span class="hoy-pair"><span class="lv lv3 firm">3</span>${safetyText(opts).legend} (en 1, 2 y 3)</span>`}
      <span class="hoy-pair"><span class="lv lvh">H</span>horquilla ancha</span>
      <span class="hoy-pair"><span class="lv lvx">–</span>sin fila</span>
    </p>`;

  const help = (opts) => `<button class="rules-line small" style="margin:10px 0 0" data-hoy="help" aria-expanded="${hoy.help}">Cómo se puntúa y cómo se lee ${hoy.help ? "▴" : "▾"}</button>
    ${
      hoy.help
        ? `<div class="eq-help small muted" style="margin-top:8px">
        <p>Cada casilla es un bull put: el de ese nombre en ese vencimiento, con la prob. de asignación hasta el objetivo y el ancho más cercano al elegido.</p>
        <p>Nivel 0: la rentab. esperada no es positiva; lo cobrado no cubre lo que se espera pagar. Si es positiva, el nivel empieza en 1 y suma un punto por cada comprobación: ${
          opts.safety === "off"
            ? ""
            : opts.safety === "both"
              ? "los dos cálculos (5 años de precios y volatilidad reciente) salen en positivo; "
              : `lo que queda (cobras neto menos lo que se espera pagar) supera ${opts.marginK === 1 ? "una vez" : `${num(opts.marginK, 1)} veces`} el error del cálculo, que es lo que se puede equivocar la media de los dos; `
        }el coste de ida y vuelta no pasa del ${LEVEL_COST_PCT} % de lo cobrado; el bloque no es uno que ya tengas abierto.${opts.safety === "off" ? " El punto de seguridad está apagado en Reglas, así que el nivel llega a 3." : " El punto de seguridad se cambia en Reglas."}${opts.safety === "margin" ? ` Un 4 que además deja ${opts.marginK === 1 ? "el doble" : `${num(2 * opts.marginK, 1)} veces`} el error es un 5: todo a favor y firme. El punto bajo el número solo sale en 1, 2 y 3: dice que lo que falta no es el margen.` : ""}</p>
        <p>Es un nivel y no una nota porque las cuentas no dan para afinar más. A igual nivel, las listas ponen primero el que más aguanta si el cálculo se equivoca (el suelo: lo que queda menos el error). «H» es un deal con precio pero con la horquilla demasiado ancha para fiarse. Con «Precio: Mid» se ve qué nivel tendría si te llenaran a precio medio (la mitad entre bid y ask); es una hipótesis, no un precio garantizado.</p>
        <p>Es una estimación para ordenar, no una previsión, y no es un consejo.</p>
      </div>`
        : ""
    }`;

  // ---------- 1. mapa ----------

  function viewMapa(o) {
    if (!o.symbols.length) return `<div class="empty"><h2>Esperando el primer barrido de la lista.</h2></div>`;
    if (!o.expiries.length) return `${controls(o)}<div class="empty"><h2>Ningún vencimiento cae dentro del plazo de Reglas.</h2></div>`;
    // Enfocado en una fecha: la misma matriz con una sola columna, ordenada por ese vencimiento, y el deal de cada casilla al lado.
    const focus = o.expiries.includes(hoy.mapExp) ? hoy.mapExp : null;
    const grid = levelGrid(o.symbols, focus ? { ...o.opts, expiries: [focus] } : o.opts, o.today);
    const shown = grid.names.filter((name) => name.priced > 0);
    const hidden = grid.names.filter((name) => name.priced === 0);
    const cell = (name, c, i) => {
      const exp = grid.expiries[i];
      const base = `data-hoy="cell" data-s="${esc(name.sym.s)}" data-e="${exp.expiry}"`;
      if (c.state === "out") return `<span class="lv lvx" role="gridcell" aria-label="${esc(name.sym.s)} ${esc(exp.label)}: sin fila" title="${esc(c.why)}">–</span>`;
      const keys = `data-k="${c.row.shortStrike}|${c.row.longStrike}"`;
      if (c.state === "gated") return `<button class="lv lvh" role="gridcell" ${base} ${keys} aria-label="${esc(name.sym.s)} ${esc(exp.label)}: apartada, ${esc(c.gate)}">H</button>`;
      const firm = c.level >= 1 && c.level <= 3 && c.checks.safe;
      return `<button class="lv lv${c.level}${firm ? " firm" : ""}" role="gridcell" ${base} ${keys} aria-label="${esc(name.sym.s)} ${esc(exp.label)}: nivel ${c.level}${firm ? `, ${safetyText(o.opts).short}` : ""}">${c.level}</button>`;
    };
    const detail = (name, c) =>
      `<button class="hoy-detail" data-hoy="cell" data-s="${esc(name.sym.s)}" data-e="${grid.expiries[0].expiry}" data-k="${c.row.shortStrike}|${c.row.longStrike}" tabindex="-1" aria-hidden="true"><b class="num">${fmtStrike(c.row.shortStrike)}/${fmtStrike(c.row.longStrike)}</b><small class="num">cobras ${usd2(c.row.net)} · ${num(c.row.otm, 1)} % abajo</small></button>`;
    const rows = shown
      .map(
        (name) => `<div class="hoy-name" role="rowheader"><b>${esc(name.sym.s)}</b>${o.opts.held.includes(name.sym.b ?? "") ? '<i class="hoy-held" title="Bloque que ya tienes"></i>' : ""}</div>${name.cells.map((c, i) => cell(name, c, i)).join("")}${focus ? detail(name, name.cells[0]) : ""}`,
      )
      .join("");
    const expChips = `<div class="frow" role="group" aria-label="Vencimiento" style="margin:-8px 0 12px"><span class="small muted hoy-lab">Vencimiento</span>${chip("mexp", "", "Todas", !focus)}${o.expiries.map((e) => chip("mexp", e, esc(labelOf(e)), e === focus)).join("")}</div>`;
    const s = grid.summary;
    // El contador: cuántas casillas hay en los niveles altos (4 y 3; solo 3 si el punto de seguridad está apagado).
    const scored = grid.names.flatMap((name) => name.cells).filter((c) => c.state === "level");
    const count = (level) => scored.filter((c) => c.level === level).length;
    const tops = o.opts.safety === "off" ? [3] : o.opts.safety === "margin" ? [5, 4, 3] : [4, 3];
    const line = !s.withHistory
      ? "Todavía no hay cierres diarios guardados: sin ellos no se puede puntuar."
      : s.positive === 0
        ? "Hoy ninguna casilla cubre lo que se espera pagar."
        : [...tops.map((level) => [`Nivel ${level}`, count(level)]), ...(o.opts.safety === "off" ? [] : [[o.opts.safety === "both" ? "Los dos cálculos en positivo" : "Con margen", s.firm]]), ["Comparables", s.comparable]]
            .map(([label, n]) => `<span class="hoy-count">${label}: <b class="num">${n}</b></span>`)
            .join('<span aria-hidden="true">·</span>');
    return `${controls(o)}
      ${expChips}
      <p class="hoy-sum${s.withHistory && s.positive > 0 ? "" : " none"}">${line}</p>
      <div class="hoy-grid${focus ? " one" : ""}" role="grid" aria-label="Nivel de cada nombre en cada vencimiento" style="grid-template-columns:${focus ? "54px 56px minmax(0,1fr)" : `54px repeat(${grid.expiries.length},minmax(0,1fr))`}">
        ${focus ? "" : `<span></span>${grid.expiries.map((exp) => `<button class="hoy-exp" data-hoy="mexp" data-v="${exp.expiry}" aria-label="Ver solo el ${esc(exp.label)}">${esc(exp.label)}</button>`).join("")}`}
        ${rows}
      </div>
      ${hidden.length ? `<p class="xs muted" style="margin-top:10px">${focus ? "Sin fila en esta fecha" : "Sin fila en ningún vencimiento"}: ${hidden.map((name) => esc(name.sym.s)).join(", ")}.</p>` : ""}
      <p class="xs muted" style="margin-top:8px">Toca una casilla para ver el deal. ${focus ? "Toca «Todas» para volver a ver todas las fechas." : "Toca una fecha para ver solo los de ese vencimiento."}</p>
      <button class="rules-line small" style="margin:10px 0 0" data-hoy="legend" aria-expanded="${hoy.legendOpen}">Qué significa cada casilla ${hoy.legendOpen ? "▴" : "▾"}</button>
      ${hoy.legendOpen ? legend(o.opts) : ""}
      ${notes(o)}
      ${help(o.opts)}`;
  }

  // ---------- 2. nube ----------

  function viewNube(o) {
    if (!o.symbols.length) return `<div class="empty"><h2>Esperando el primer barrido de la lista.</h2></div>`;
    if (!o.expiries.length) return `${controls(o)}<div class="empty"><h2>Ningún vencimiento cae dentro del plazo de Reglas.</h2></div>`;
    const expiry = o.expiries.includes(hoy.expiry) ? hoy.expiry : o.expiries.at(-1);
    const grid = levelGrid(o.symbols, { ...o.opts, expiries: [expiry] }, o.today);
    const cells = grid.names.map((name) => name.cells[0]);
    // A igual nivel, primero el que más aguanta si el cálculo se equivoca: el suelo (lo que queda menos el error).
    const floorOf = (c) => (c.row.err == null ? -Infinity : c.row.net - c.row.expected - c.row.err);
    const pts = cells.filter((c) => c.state === "level" && c.checks.scored && c.checks.costShare != null).sort((a, b) => b.level - a.level || floorOf(b) - floorOf(a) || b.row.retExp - a.row.retExp);
    const gated = cells.filter((c) => c.state === "gated").length;
    const expChips = `<div class="frow" role="group" aria-label="Vencimiento"><span class="small muted hoy-lab">Vencimiento</span>${o.expiries.map((e) => chip("exp", e, esc(labelOf(e)), e === expiry)).join("")}</div>`;
    let chart = "";
    if (pts.length) {
      const W = 340, H = 300, L = 36, R = 12, T = 14, B = 28;
      const ys = pts.map((c) => c.row.retExp);
      const lo = Math.min(-1, Math.floor(Math.min(...ys))), hi = Math.max(1, Math.ceil(Math.max(...ys)));
      const span = hi - lo;
      const step = span <= 6 ? 1 : span <= 12 ? 2 : span <= 30 ? 5 : 10;
      const x = (v) => L + (Math.min(100, Math.max(0, v)) / 100) * (W - L - R);
      const y = (v) => T + ((hi - v) / span) * (H - T - B);
      let lines = "";
      for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) {
        lines += `<line x1="${L}" x2="${W - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" class="${v === 0 ? "zero" : "grid"}"/><text x="${L - 5}" y="${(y(v) + 3.5).toFixed(1)}" text-anchor="end" class="tick">${v > 0 ? "+" : ""}${num(v, 0)}</text>`;
      }
      for (let v = 0; v <= 100; v += 20) lines += `<text x="${x(v).toFixed(1)}" y="${H - B + 14}" text-anchor="middle" class="tick">${v}</text>`;
      // Etiquetas: a la derecha del punto si caben; si pisan a otra, se prueba a la izquierda y luego arriba o abajo.
      const placed = [];
      const clash = (box) => placed.some((other) => box.x1 < other.x2 + 2 && box.x2 > other.x1 - 2 && Math.abs(box.y - other.y) < 11);
      const label = (px, py, text) => {
        const w = text.length * 6.4;
        const spots = [];
        for (const dy of [0, -11, 11, -22, 22]) {
          if (px + 12 + w <= W - 2) spots.push({ x: px + 12, y: py + dy, anchor: "start", x1: px + 12, x2: px + 12 + w });
          if (px - 12 - w >= L) spots.push({ x: px - 12, y: py + dy, anchor: "end", x1: px - 12 - w, x2: px - 12 });
        }
        const spot = spots.find((item) => !clash(item)) ?? spots[0];
        placed.push(spot);
        return spot;
      };
      for (const c of pts) placed.push({ x1: x(c.checks.costShare) - 7, x2: x(c.checks.costShare) + 7, y: y(c.row.retExp) });
      const marks = pts
        .map((c) => {
          const px = x(c.checks.costShare), py = y(c.row.retExp);
          const kind = c.checks.both ? "both" : c.row.marginHist > 0 || c.row.marginRecent > 0 ? "one" : "none";
          const shape =
            kind === "both"
              ? `<rect x="${(px - 5.5).toFixed(1)}" y="${(py - 5.5).toFixed(1)}" width="11" height="11" transform="rotate(45 ${px.toFixed(1)} ${py.toFixed(1)})" class="pt both"/>`
              : `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="${kind === "one" ? 5.5 : 4.5}" class="pt ${kind}"/>`;
          const ring = c.checks.fresh ? "" : `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="10" class="ring"/>`;
          const at = label(px, py, c.sym.s);
          return `<g data-hoy="cell" data-s="${esc(c.sym.s)}" data-e="${expiry}" data-k="${c.row.shortStrike}|${c.row.longStrike}" role="button" tabindex="0" aria-label="${esc(c.sym.s)}: rentab. esperada ${signedPct(c.row.retExp)}, coste ${c.checks.costShare} %">
            <circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="17" fill="transparent"/>${ring}${shape}
            <text x="${at.x.toFixed(1)}" y="${(at.y + 3.5).toFixed(1)}" text-anchor="${at.anchor}" class="lab">${esc(c.sym.s)}</text></g>`;
        })
        .join("");
      chart = `<div class="hoy-cloud">
        <p class="xs muted hoy-axis"><span>↑ Rentab. esperada (%)</span><span>mejor zona: arriba a la izquierda</span></p>
        <svg viewBox="0 0 ${W} ${H}" role="group" aria-label="Deals del ${esc(labelOf(expiry))}: coste sobre lo cobrado frente a rentab. esperada">${lines}${marks}</svg>
        <p class="xs muted" style="text-align:center;margin-top:-2px">Coste de ida y vuelta, en % de lo cobrado →</p>
      </div>
      <p class="hoy-legend xs muted" aria-hidden="true">
        <svg viewBox="0 0 14 14" width="14" height="14"><rect x="3" y="3" width="8" height="8" transform="rotate(45 7 7)" class="pt both"/></svg><span>los dos cálculos en positivo</span>
        <svg viewBox="0 0 14 14" width="14" height="14"><circle cx="7" cy="7" r="4.5" class="pt one"/></svg><span>solo uno</span>
        <svg viewBox="0 0 14 14" width="14" height="14"><circle cx="7" cy="7" r="4" class="pt none"/></svg><span>ninguno</span>
        <svg viewBox="0 0 22 22" width="18" height="18"><circle cx="11" cy="11" r="9" class="ring"/></svg><span>bloque que ya tienes</span>
      </p>`;
    }
    const list = pts
      .map(
        (c) => `<li><button class="deal" data-hoy="cell" data-s="${esc(c.sym.s)}" data-e="${expiry}" data-k="${c.row.shortStrike}|${c.row.longStrike}">
          <span class="deal-top" style="padding-right:96px">${levelTag(c.level, " sm")} <b>${esc(c.sym.s)}</b> <span class="muted">${fmtStrike(c.row.shortStrike)}/${fmtStrike(c.row.longStrike)}</span>
            <span class="deal-kpi num ${c.row.retExp > 0 ? "plus" : "minus"}">${signedPct(c.row.retExp)}</span></span>
          <span class="deal-sub small muted">${esc(c.sym.b ?? "")} · cobras neto ${usd2(c.row.net)} · coste ${c.checks.costShare} % de lo cobrado</span>
        </button></li>`,
      )
      .join("");
    return `${controls(o)}${expChips}
      ${
        pts.length
          ? `${chart}<div class="deal-head small muted" style="margin-top:14px"><span>${pts.length} ${pts.length === 1 ? "deal comparable" : "deals comparables"}</span><span>Rentab. esperada</span></div><ul class="rows">${list}</ul>`
          : `<div class="empty"><h2>Ningún deal comparable el ${esc(labelOf(expiry))}.</h2></div>`
      }
      ${gated ? `<p class="xs muted" style="margin-top:10px">${gated} ${gated === 1 ? "nombre apartado" : "nombres apartados"} por horquilla ancha o por coste: se ven en el mapa con una H.</p>` : ""}
      ${notes(o)}
      ${help(o.opts)}`;
  }

  // ---------- 2 bis. barras ----------

  /** Los mismos deals que la nube, una fila cada uno y todos en la misma escala (% de lo que se arriesga):
   *  el rombo es lo que cobra, el punto lo que queda de media, la barra su error y la línea de puntos lo que se espera pagar. */
  function viewBarras(o) {
    if (!o.symbols.length) return `<div class="empty"><h2>Esperando el primer barrido de la lista.</h2></div>`;
    if (!o.expiries.length) return `${controls(o)}<div class="empty"><h2>Ningún vencimiento cae dentro del plazo de Reglas.</h2></div>`;
    const expiry = o.expiries.includes(hoy.expiry) ? hoy.expiry : o.expiries.at(-1);
    const grid = levelGrid(o.symbols, { ...o.opts, expiries: [expiry] }, o.today);
    const cells = grid.names.map((name) => name.cells[0]);
    const k = o.opts.safety === "margin" ? o.opts.marginK : 1;
    const pts = cells
      .filter((c) => c.state === "level" && c.checks.scored && c.checks.costShare != null)
      .map((c) => ({ c, r: rangeOf(c.row, k) }))
      .filter((item) => item.r)
      .sort((a, b) => rangeOrder(a.r, b.r, hoy.barSort));
    const gated = cells.filter((c) => c.state === "gated").length;
    const expChips = `<div class="frow" role="group" aria-label="Vencimiento"><span class="small muted hoy-lab">Vencimiento</span>${o.expiries.map((e) => chip("exp", e, esc(labelOf(e)), e === expiry)).join("")}</div>`;
    const floor = hoy.barSort === "floor";
    let head = "", legend = "";
    let body = `<div class="empty"><h2>Ningún deal comparable el ${esc(labelOf(expiry))}.</h2></div>`;
    if (pts.length) {
      // Escala común. Por abajo se corta en −2 %: lo que cae más allá se marca con una flecha y lleva su número.
      const W = 320, H = 24, PAD = 9, FLOOR = -2;
      const hi = Math.max(1, Math.ceil(Math.max(...pts.map(({ r }) => Math.max(r.collected, r.high ?? r.expected)))));
      const lo = Math.max(FLOOR, Math.min(-1, Math.floor(Math.min(...pts.map(({ r }) => r.low ?? r.expected)))));
      const x = (v) => PAD + ((Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * (W - 2 * PAD);
      const f = (v) => x(v).toFixed(1);
      const step = hi - lo <= 8 ? 1 : 2;
      let gridLines = "", ticks = "";
      for (let v = lo; v <= hi + 1e-9; v += step) {
        gridLines += `<line x1="${f(v)}" x2="${f(v)}" y1="0" y2="${H}" class="${v === 0 ? "zero" : "grid"}"/>`;
        ticks += `<text x="${f(v)}" y="11" text-anchor="middle" class="tick">${v > 0 ? "+" : v < 0 ? "−" : ""}${num(Math.abs(v), 0)}</text>`;
      }
      const cy = H / 2;
      const rowsHtml = pts
        .map(({ c, r }) => {
          const pos = r.expected > 0;
          const off = r.expected < lo;
          const px = x(r.expected), gx = x(r.collected);
          const whisker = r.err == null || r.high <= lo ? "" : `<line x1="${f(r.low)}" x2="${f(r.high)}" y1="${cy}" y2="${cy}" class="b-err${pos ? "" : " neg"}"/>`;
          const dot = off
            ? `<path d="M${PAD + 5} ${cy - 5} L${PAD - 3} ${cy} L${PAD + 5} ${cy + 5} Z" class="b-off"/>`
            : `<circle cx="${px.toFixed(1)}" cy="${cy}" r="${pos ? 5.5 : 4.5}" class="b-dot${pos ? "" : " neg"}"/>`;
          const firm = c.level >= 1 && c.level <= 3 && c.checks.safe;
          // A la derecha, el número por el que se ordena: lo que queda con su error, o el suelo.
          const byFloor = floor && r.low != null;
          const kpi = byFloor ? `${signedPct(r.low)} <small>suelo</small>` : `${signedPct(r.expected)}${r.err == null ? "" : ` <small>± ${num(r.err, 1)}</small>`}`;
          const kpiPos = byFloor ? r.low > 0 : pos;
          return `<li><button class="hoy-brow" data-hoy="cell" data-s="${esc(c.sym.s)}" data-e="${expiry}" data-k="${c.row.shortStrike}|${c.row.longStrike}" aria-label="${esc(c.sym.s)}: cobra ${num(r.collected, 1)} %, se espera pagar ${num(r.pay, 1)} %, queda ${signedPct(r.expected)}${r.err == null ? "" : `, error ${num(r.err, 1)}`}">
            <span class="hoy-brow-top">${levelTag(c.level, ` sm${firm ? " firm" : ""}`)} <b>${esc(c.sym.s)}</b> <span class="muted">${fmtStrike(c.row.shortStrike)}/${fmtStrike(c.row.longStrike)}</span>
              <span class="hoy-brow-kpi num ${kpiPos ? "plus" : "minus"}">${kpi}</span></span>
            <svg viewBox="0 0 ${W} ${H}" aria-hidden="true">${gridLines}
              <line x1="${px.toFixed(1)}" x2="${gx.toFixed(1)}" y1="${cy}" y2="${cy}" class="b-pay"/>${whisker}${dot}
              <rect x="${(gx - 4.5).toFixed(1)}" y="${cy - 4.5}" width="9" height="9" transform="rotate(45 ${gx.toFixed(1)} ${cy})" class="b-got"/></svg>
            <span class="hoy-brow-sub xs muted">cobras ${usd2(c.row.net)} · se espera pagar ${usd2(c.row.expected)} · coste ${c.checks.costShare} %</span>
          </button></li>`;
        })
        .join("");
      const errLegend = k === 1 ? "± el error" : `± ${num(k, 1)} veces el error`;
      const pair = (icon, text) => `<span class="hoy-pair">${icon}${text}</span>`;
      legend = `<p class="hoy-legend xs muted" style="margin-top:12px" aria-hidden="true">
          ${pair('<svg viewBox="0 0 14 14" width="14" height="14"><circle cx="7" cy="7" r="5" class="b-dot"/></svg>', "queda de media")}
          ${pair('<svg viewBox="0 0 22 14" width="22" height="14"><line x1="2" x2="20" y1="7" y2="7" class="b-err"/></svg>', errLegend)}
          ${pair('<svg viewBox="0 0 14 14" width="14" height="14"><rect x="3" y="3" width="8" height="8" transform="rotate(45 7 7)" class="b-got"/></svg>', "cobras")}
          ${pair('<svg viewBox="0 0 22 14" width="22" height="14"><line x1="2" x2="20" y1="7" y2="7" class="b-pay"/></svg>', "se espera pagar")}
        </p>`;
      // El orden va una sola vez, encima de la lista: a la izquierda cuántos son y a la derecha por qué van ordenados (tocar lo cambia).
      head = `<div class="hoy-sort small">
          <span class="muted">${pts.length} ${pts.length === 1 ? "deal" : "deals"}</span>
          <span class="sortbar eq" role="group" aria-label="Orden de las barras">
            <button data-hoy="bsort" data-v="left" aria-pressed="${!floor}">Por lo que queda</button>
            <button data-hoy="bsort" data-v="floor" aria-pressed="${floor}">Por el suelo</button>
          </span>
        </div>`;
      body = `<div class="hoy-bars">
          <div class="hoy-brow-axis"><p class="xs muted">% de lo que arriesgas («pierdes máx.»)</p><svg viewBox="0 0 ${W} 14" aria-hidden="true">${ticks}</svg></div>
          <ul>${rowsHtml}</ul>
        </div>
        <p class="xs muted" style="margin-top:8px">${floor ? "El suelo es lo que queda menos el error, el extremo izquierdo de la barra: junta en un número lo que rinde y lo firme que es. " : ""}${
          o.opts.safety === "margin" ? "Si la barra no toca el cero, lo que queda supera el error: tiene el punto de seguridad. " : ""
        }La flecha marca lo que cae por debajo de −${num(Math.abs(lo), 0)} %. Toca una fila para ver el deal.</p>`;
    }
    return `${controls(o)}${expChips}${head}
      ${body}
      ${gated ? `<p class="xs muted" style="margin-top:10px">${gated} ${gated === 1 ? "nombre apartado" : "nombres apartados"} por horquilla ancha o por coste: se ven en el mapa con una H.</p>` : ""}
      ${legend}
      ${notes(o)}
      ${help(o.opts)}`;
  }

  // ---------- 3 y 4. ficha única, deals del nombre y resumen para el bróker ----------

  /** El punto de seguridad en la ficha, según la regla. Apagado no sale. */
  function safetyItem(item, checks, row, opts, both, anyOne) {
    const calcs = `Con lo reciente ${signedUsd(row.marginRecent)} · con la historia ${signedUsd(row.marginHist)}.`;
    if (opts.safety === "off") return "";
    if (opts.safety === "both") return item(checks.both, both ? "Los dos cálculos en positivo" : anyOne ? "Solo un cálculo en positivo" : "Ningún cálculo en positivo", calcs);
    if (checks.room == null) return item(false, "Sin error calculado para medir el margen", calcs);
    const left = row.net - row.expected;
    const k = opts.marginK === 1 ? "1 vez" : `${num(opts.marginK, 1)} veces`;
    return item(
      checks.safe,
      checks.safe ? "Lo que queda supera el error del cálculo" : left > 0 ? "Lo que queda no supera el error del cálculo" : "No queda nada tras lo que se espera pagar",
      `Queda <b class="num">${signedUsd(left)}</b> y el cálculo se puede equivocar en ±${dollars(row.err)}: ${num(Math.max(0, checks.room), 1)} ${checks.room === 1 ? "vez" : "veces"}. Pides ${k}.`,
    );
  }

  // Una sola ficha para todas las pantallas (Hoy, Deals y Lista): arriba el deal elegido (el ticket: lo que cobras,
  // lo que apartas para pérdidas y lo que te queda), después cinco bloques plegables y, al final, todos los deals
  // puntuados del mismo nombre con sus filtros. Tocar uno de la lista lo carga arriba.

  /** Los deals puntuados de un nombre (nivel 0–5), los mismos que Deals pero solo de ese nombre. Se guardan hasta que cambie algo. */
  let nameCache = { key: "", deals: [] };
  function nameDeals(sym, o) {
    const rules = o.rules;
    const key = JSON.stringify([state.scan?.at, state.hist?.at, rules, hoy.price, o.opts.held, o.today, sym.s]);
    if (nameCache.key !== key) {
      const out = qualityDeals(
        [sym],
        { rules, fee: o.opts.fee, gapPct: o.opts.gapPct, safety: o.opts.safety, marginK: o.opts.marginK, errVolPct: rules.errVolPct, errHistK: rules.errHistK, hist: o.opts.hist, held: o.opts.held, price: hoy.price, maxProb: 20, maxWidth: 10 },
        o.today,
      );
      nameCache = { key, deals: out.deals };
    }
    return nameCache.deals;
  }

  const FAIL_SHORT = { "probabilidad alta": "prob.", "sin dato de probabilidad": "prob.", "fuera del punto": "% abajo", "crédito corto": "cobras", "equilibrio bajo": "equilibrio" };
  const failShort = (fail) => FAIL_SHORT[fail] ?? (fail.startsWith("ancho de") ? "ancho" : fail);
  const spanText = (years) => (years >= 4.5 ? "5 años" : years >= 1.5 ? `${num(Math.round(years * 10) / 10, 1)} años` : "lo guardado");
  /** Dólares con céntimos y signo: aquí cada céntimo cuenta. */
  const usdS = (n) => `${n > 0 ? "+" : n < 0 ? "−" : ""}$${num(Math.abs(n), 2)}`;
  const tone = (n) => (n > 0 ? "up" : n < 0 ? "down" : "");

  /** Lo que rinde el deal: sin comisión, con comisión y tras lo que se espera pagar. Cada fila, en dólares, por día, sobre lo que arriesgas y sobre lo que arriesgas por día. */
  function yieldTable(row, fee) {
    const r = returnsOf(row, fee);
    if (!r) return "";
    const pct = (n, d) => (n == null ? "—" : `${n < 0 ? "−" : ""}${num(Math.abs(n), d)} %`);
    const line = (label, sub, v) =>
      v
        ? `<tbody><tr class="lab"><th scope="rowgroup" colspan="4">${label}${sub ? ` <small>${sub}</small>` : ""}</th></tr>
          <tr><td class="num ${tone(v.gain)}">${usdS(v.gain)}</td><td class="num ${tone(v.perDay)}">${usdS(v.perDay)}</td><td class="num ${tone(v.onRisk)}">${pct(v.onRisk, 2)}</td><td class="num ${tone(v.onRiskPerDay)}">${pct(v.onRiskPerDay, 3)}</td></tr></tbody>`
        : "";
    return `<div class="fi-yield">
      <table>
        <thead><tr><th scope="col" title="Gano">G</th><th scope="col" title="Gano por día">G/D</th><th scope="col" title="Gano sobre lo que arriesgas">G/S</th><th scope="col" title="Gano sobre lo que arriesgas, por día">G/S/D</th></tr></thead>
        ${line("Sin comisión", hoy.price === "mid" ? "a precio medio" : "a precio visible", r.gross)}
        ${line("Con comisión", "", r.net)}
        ${line("Esperada", "tras lo que se espera pagar", r.expected)}
      </table>
      <p class="xs muted">${r.days} ${r.days === 1 ? "día" : "días"} al vencimiento. G = gano · D = día · S = spread, lo que arriesgas («pierdes máx.»). Por contrato. Comisión de abrir: ${usd2(fee)}; entrar y salir cuesta ${row.roundTrip == null ? "—" : usd2(row.roundTrip)}.</p>
    </div>`;
  }

  function orderText(sym, row, rows) {
    const year = row.expiry.slice(0, 4);
    const lines = [
      `${sym.s} · bull put · vencimiento ${row.expiryLabel} ${year}`,
      `Vender 1 put ${fmtStrike(row.shortStrike)}`,
      `Comprar 1 put ${fmtStrike(row.longStrike)}`,
      `Crédito a precio visible: ${num(rows.nat.credit, 2)}`,
    ];
    if (rows.nat.midCredit != null && rows.nat.midCredit > 0) lines.push(`Crédito a precio medio: ${num(rows.nat.midCredit, 3).replace(/0$/, "")}`);
    return lines.join("\n");
  }

  /** Un bloque plegable: título, una frase a la derecha y un chevron. Cerrado de fábrica; lo abierto se recuerda en el dispositivo. */
  const fold = (id, title, sub, body) => {
    const open = hoy.folds.includes(id);
    return `<section class="fi-fold"><button class="fi-fold-h" data-hoy="fold" data-v="${id}" aria-expanded="${open}"><span class="fi-fold-t">${title}</span>${sub ? `<span class="fi-fold-s">${sub}</span>` : ""}<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M4 6l4 4 4-4"/></svg></button>${open ? `<div class="fi-fold-b">${body}</div>` : ""}</section>`;
  };

  const fiHead = (sym) => {
    const name = [sym.n, sym.b].filter((text, i, all) => text && text !== sym.s && all.indexOf(text) === i).join(" · ");
    const chg = typeof sym.c === "number" && Number.isFinite(sym.c) ? `<span class="fi-chg num ${tone(sym.c)}">${sym.c > 0 ? "+" : sym.c < 0 ? "−" : ""}${num(Math.abs(sym.c), 2)} %</span>` : "";
    return `<div class="fi-head">
        <div class="fi-id"><h2>${esc(sym.s)}</h2><b class="fi-price num">${sym.p > 0 ? usd2(sym.p) : "sin precio"}</b>${chg}</div>
        <button class="fi-x" data-hoy="close" aria-label="Cerrar">✕</button>
      </div>
      <p class="small muted fi-sub">${esc(name)}</p>`;
  };

  /** Todos los deals puntuados del nombre, con sus filtros. La fila elegida lleva una barra a la izquierda. */
  function dealsSection(sym, o, selectedKey) {
    const all = nameDeals(sym, o);
    const f = hoy.fl;
    const benefit = (d) => (d.row.net > 0 ? ((d.row.net - d.row.expected) / d.row.net) * 100 : null);
    const exps = [...new Set(all.map((d) => d.row.expiry))].sort();
    let list = all.filter(
      (d) => f.lv.includes(d.level) && (!f.exp || d.row.expiry === f.exp) && (!f.w || d.row.width <= f.w + 1e-6) && (!f.pr || (d.row.prob ?? 100) <= f.pr + 1e-9) && !(f.hide && !d.ok),
    );
    if (f.ord === "ben") list = [...list].sort((a, b) => (benefit(b) ?? -Infinity) - (benefit(a) ?? -Infinity));
    else if (f.ord === "prob") list = [...list].sort((a, b) => (a.row.prob ?? 100) - (b.row.prob ?? 100));
    else if (f.ord === "floor") list = [...list].sort((a, b) => (b.floor ?? -Infinity) - (a.floor ?? -Infinity) || b.level - a.level);
    else if (f.ord === "day") {
      // Rentab. esperada repartida entre los días hasta el vencimiento.
      const perDay = (d) => (d.row.retExp != null && d.row.dte > 0 ? d.row.retExp / d.row.dte : -Infinity);
      list = [...list].sort((a, b) => perDay(b) - perDay(a) || b.level - a.level);
    }
    const shown = list.slice(0, f.shown);
    const chipRow = (label, chips) => `<div class="fi-f"><span class="fi-f-l small muted">${label}</span><div class="fi-f-c">${chips}</div></div>`;
    const lvChips = [0, 1, 2, 3, 4, 5].map((l) => `<button class="lv lv${l} fi-lvb" data-hoy="fl-lv" data-v="${l}" aria-pressed="${f.lv.includes(l)}" aria-label="Nivel ${l}">${l}</button>`).join("");
    const filters = `<div class="fi-filters">
        ${chipRow("Nivel", lvChips)}
        ${exps.length > 1 ? chipRow("Vence", chip("fl-exp", "", "Todos", !f.exp) + exps.map((e) => chip("fl-exp", e, esc(labelOf(e)), f.exp === e)).join("")) : ""}
        ${chipRow("Ancho hasta", chip("fl-w", "0", "Todos", !f.w) + WIDTHS.map((n) => chip("fl-w", n, `$${n}`, f.w === n)).join(""))}
        ${chipRow("Prob. hasta", chip("fl-pr", "0", "Todas", !f.pr) + FL_PROBS.map((n) => chip("fl-pr", n, `${n} %`, f.pr === n)).join(""))}
        ${chipRow("", chip("fl-hide", "", "Ocultar fuera de Reglas", f.hide))}
      </div>`;
    // El orden va abajo del todo de los filtros, pegado a la lista y a todo el ancho, sin rótulo.
    const sortBar = `<div class="fi-sort sortbar eq" role="group" aria-label="Orden">${[["lv", "Nivel"], ["ben", "Beneficio"], ["prob", "Prob."], ["floor", "Suelo"], ["day", "Por día"]].map(([id, label]) => `<button data-hoy="fl-ord" data-v="${id}" aria-pressed="${f.ord === id}">${label}</button>`).join("")}</div>`;
    const rowHtml = (d) => {
      const r = d.row;
      const left = r.net - r.expected;
      const p = benefit(d);
      const key = dealKey(r);
      const out = d.ok ? "" : `<small class="xs fi-out">fuera de Reglas${d.fails.length ? `: ${esc([...new Set(d.fails.map(failShort))].join(", "))}` : ""}</small>`;
      return `<li><button class="fi-dr${key === selectedKey ? " on" : ""}" data-hoy="pick" data-e="${r.expiry}" data-k="${r.shortStrike}|${r.longStrike}" aria-pressed="${key === selectedKey}">
          <span class="lv lv${d.level} fi-dr-lv">${d.level}</span>
          <span class="fi-dr-m"><span class="fi-dr-t"><b class="num">${fmtStrike(r.shortStrike)}/${fmtStrike(r.longStrike)}</b> <span class="muted">· ${esc(r.expiryLabel)}</span></span>
            <small class="xs muted num">prob. ${r.prob == null ? "—" : `${num(r.prob, 1)} %`} · ancho $${num(r.width * 100, 0)}</small>${out}</span>
          <span class="fi-dr-r num"><span class="fi-dr-v"><b class="${tone(left)}">${usdS(left)}</b>${p == null ? "" : ` <span class="${tone(left)}">${p < 0 ? "−" : ""}${num(Math.abs(p), 0)} %</span>`}</span><small class="xs muted">queda</small></span>
        </button></li>`;
    };
    return `<section class="fi-deals">
        <div class="fi-deals-h"><h3>Deals de ${esc(sym.s)}</h3><span class="small muted num">${list.length} de ${all.length}</span></div>
        ${all.length ? filters + sortBar : ""}
        ${
          all.length === 0
            ? `<p class="small muted">Ahora no hay ningún bull put puntuado de ${esc(sym.s)} en el plazo de Reglas.</p>`
            : list.length === 0
              ? `<p class="small muted">Ningún deal con estos filtros.</p><button class="btn quiet" data-hoy="fl-reset">Quitar filtros</button>`
              : `<ul class="fi-dlist">${shown.map(rowHtml).join("")}</ul>${list.length > shown.length ? `<button class="btn quiet fi-more" data-hoy="fl-more">Ver más (${list.length - shown.length})</button>` : ""}`
        }
      </section>`;
  }

  function sheet() {
    if (!hoy.deal) return "";
    const o = options();
    const sym = (state.scan?.symbols ?? []).find((item) => item.s === hoy.deal.s);
    if (!sym) return "";
    const wrap = (inner) => `<div class="sheet-back" data-hoy="close"><div class="sheet fi-sheet" role="dialog" aria-modal="true" aria-label="${esc(sym.s)}">${inner}</div></div>`;
    if (hoy.deal.none) {
      return wrap(`${fiHead(sym)}<p class="small muted" style="margin-top:16px">Ahora no hay ningún bull put puntuado de ${esc(sym.s)} en el plazo de Reglas.</p>`);
    }
    const rows = dealRows(sym, hoy.deal, o.opts, o.today);
    if (!rows.row) {
      return wrap(`${fiHead(sym)}<p class="small muted" style="margin-top:16px">Ese bull put ya no tiene precio${rows.why ? `: ${esc(rows.why.toLowerCase())}` : ""}.</p>${dealsSection(sym, o, null)}`);
    }
    const row = rows.row;
    const key = dealKey(row);
    const checks = dealChecks(row, o.opts);
    const gate = gateReason(rows.nat, o.opts.gapPct);
    const apart = hoy.price === "nat" && gate;
    const both = row.marginHist > 0 && row.marginRecent > 0;
    const anyOne = row.marginHist > 0 || row.marginRecent > 0;
    const entry = nameDeals(sym, o).find((d) => dealKey(d.row) === key);
    const maxLevel = o.opts.safety === "off" ? 3 : o.opts.safety === "margin" ? 5 : 4;
    const cob = row.net;
    const ap = row.expected;
    const scored = checks.scored && ap != null;
    const left = scored ? cob - ap : null;
    const share = scored && cob > 0 ? (left / cob) * 100 : null;
    const worst = scored ? Math.min(row.marginRecent, row.marginHist) : null;
    const worstPct = worst != null && cob > 0 ? (worst / cob) * 100 : null;

    // El deal: nivel, strikes, vencimiento, días y ancho por contrato.
    const deal = `<div class="fi-deal">
        ${apart ? `<span class="lv lvh mid" role="img" aria-label="Apartada de la comparación">H</span>` : `<span class="lv lv${checks.level} mid" role="img" aria-label="Nivel ${checks.level} de ${maxLevel}">${checks.level}</span>`}
        <div class="fi-deal-t"><b class="num">${fmtStrike(row.shortStrike)}/${fmtStrike(row.longStrike)} · ${esc(row.expiryLabel)} · ${row.dte} ${row.dte === 1 ? "día" : "días"}</b>
          <span class="small muted">ancho $${num(row.width * 100, 0)} por contrato${hoy.price === "mid" ? " · precio medio: hipótesis" : ""}</span></div>
      </div>
      ${apart ? `<p class="xs muted" style="margin-top:8px">Apartada de la comparación: ${esc(gate.toLowerCase())}. A precio visible no se puntúa.</p>` : ""}`;

    // El ticket, el protagonista: cobras, apartas para pérdidas y lo que te queda, con una barra y el peor cálculo.
    const bar = scored && cob > 0 ? Math.min(100, Math.max(0, (ap / cob) * 100)) : null;
    const ticket = scored
      ? `<div class="fi-ticket">
          <div class="fi-line"><span class="fi-lab-big">Cobras</span><b class="fi-big num bl">${usdS(cob)}</b></div>
          <div class="fi-line"><span class="fi-lab">Apartas para pérdidas</span><b class="fi-mid num down">−$${num(Math.abs(ap), 2)}</b></div>
          <hr class="fi-dash">
          <div class="fi-total"><span class="fi-lab-big">Tu beneficio</span><span class="fi-total-n"><b class="fi-huge num ${tone(left)}">${usdS(left)}</b>${share == null ? "" : `<b class="fi-pct num ${tone(left)}">${share < 0 ? "−" : ""}${num(Math.abs(share), 0)} %</b>`}</span></div>
          ${bar == null ? "" : `<div class="fi-bar" role="img" aria-label="De lo que cobras, ${num(bar, 0)} % se aparta para pérdidas y ${num(100 - bar, 0)} % es tuyo"><i class="r" style="width:${bar.toFixed(1)}%"></i><i class="g" style="width:${(100 - bar).toFixed(1)}%"></i></div>`}
          <p class="fi-cap small muted">${share == null ? "" : left > 0 ? `De cada ${usd2(cob)} que cobras, el ${num(share, 0)} % es tuyo.` : "Lo que cobras no cubre lo que se espera pagar."}</p>
          <p class="fi-short small"><span class="muted">Si el cálculo se queda corto</span> <b class="num ${tone(worst)}">${usdS(worst)}</b>${worstPct == null ? "" : ` <span class="num ${tone(worst)}">${worstPct < 0 ? "−" : ""}${num(Math.abs(worstPct), 0)} %</span>`}</p>
        </div>`
      : `<div class="fi-ticket">
          <div class="fi-line"><span class="fi-lab-big">Cobras</span><b class="fi-big num bl">${usdS(cob)}</b></div>
          <p class="small muted" style="margin-top:10px">Sin cierres diarios de este nombre no se puede calcular lo que apartas ni lo que te queda.</p>
        </div>`;

    const bePct = sym.p > 0 ? ((sym.p - row.breakeven) / sym.p) * 100 : null;
    const boxes = `<div class="fi-boxes">
        <div class="fi-box"><span class="fi-lab">Prob. asignación</span><b class="num">${row.prob == null ? "—" : `${num(row.prob, 1)} %`}</b></div>
        <div class="fi-box"><span class="fi-lab">Pierdes máx.</span><b class="num down">${usd2(row.loss)}</b></div>
        <div class="fi-box wide"><span class="fi-lab">Pierdes si ${esc(sym.s)} baja de</span><b class="num">${usd2(row.breakeven)}</b>
          <span class="small muted">Ahora está en ${usd2(sym.p)}${bePct == null ? "" : ` · ${num(bePct, 1)} % abajo`}</span></div>
      </div>`;

    // Avisos: en ámbar lo que conviene mirar; en rojo lo que baja el nivel.
    const pills = [];
    const am = (text) => pills.push(`<span class="fi-pill am">${text}</span>`);
    const rd = (text) => pills.push(`<span class="fi-pill rd">${text}</span>`);
    if (row.earnInside && sym.er) am(`Resultados ${esc(labelOf(sym.er.d))}`);
    if (row.fed?.length) am(`Fed el ${row.fed.map((date) => esc(labelOf(date))).join(" y ")}`);
    for (const note of row.trend ?? []) am(esc(note));
    if (row.shortHistory && row.histProb != null) am("poca historia");
    if (row.onlyOne) am("los dos cálculos no coinciden");
    else if (row.distinct) am("estimaciones muy distintas");
    if (entry && !entry.ok) am(`fuera de Reglas${entry.fails.length ? `: ${esc([...new Set(entry.fails.map(failShort))].join(", "))}` : ""}`);
    const lowers = [];
    if (checks.scored && checks.positive) {
      if (o.opts.safety !== "off" && !checks.safe) lowers.push(o.opts.safety === "both" ? "un cálculo en negativo" : "poco margen");
      if (!checks.cheap) lowers.push(checks.costShare == null ? "coste sin medir" : `coste ${checks.costShare} %`);
      if (!checks.fresh) lowers.push("bloque repetido");
    }
    for (const text of lowers) rd(esc(text));
    const pillRow = pills.length ? `<div class="fi-pills">${pills.join("")}</div>` : "";

    // 1. Por qué este nivel
    const item = (ok, text, sub = "") => `<li class="${ok ? "yes" : "no"}"><i aria-hidden="true">${ok ? "✓" : "✕"}</i><span>${text}${sub ? `<small>${sub}</small>` : ""}</span></li>`;
    const calcs = `Cálculo con lo reciente <b class="num ${tone(row.marginRecent)}">${row.marginRecent == null ? "—" : usdS(row.marginRecent)}</b> · con la historia de ${spanText((state.hist?.symbols?.[sym.s]?.c?.length ?? 0) / 252)} <b class="num ${tone(row.marginHist)}">${row.marginHist == null ? "—" : usdS(row.marginHist)}</b>`;
    let whyText = "";
    if (!scored) whyText = "Sin cierres diarios de este nombre no se puede puntuar.";
    else if (!checks.positive) whyText = `Lo que cobras (${usd2(cob)}) no cubre lo que se espera pagar (${usd2(ap)}). Por eso es nivel 0.`;
    else
      whyText = `Te quedan <b class="num">${usd2(left)}</b> de ${usd2(cob)} y ${worst > 0 ? "aguanta aunque el cálculo falle" : "no aguanta si el cálculo falla"} (<b class="num ${tone(worst)}">${usdS(worst)}</b>).${lowers.length ? ` Lo baja: ${esc(lowers.join(" y "))}.` : ""}`;
    const list = checks.scored
      ? `<ul class="hoy-checks">
        ${item(checks.positive, `Rentab. esperada <b class="num">${signedPct(row.retExp)}</b>`, checks.positive ? "Lo cobrado supera lo que se espera pagar." : "Lo cobrado no cubre lo que se espera pagar. Sin esto, nivel 0.")}
        ${safetyItem(item, checks, row, o.opts, both, anyOne)}
        ${item(checks.cheap, checks.costShare == null ? "Coste sin precio medio" : `Coste de ida y vuelta: <b class="num">${checks.costShare} %</b> de lo cobrado`, `Tope para el punto: ${LEVEL_COST_PCT} %. Entrar y salir cuesta ${row.roundTrip == null ? "—" : usd2(row.roundTrip)}.`)}
        ${item(checks.fresh, checks.fresh ? `Bloque nuevo: ${esc(sym.b ?? "sin bloque")}` : `Repite un bloque que ya tienes: ${esc(sym.b ?? "")}`)}
      </ul>`
      : "";
    const why = `<p class="small">${whyText}</p>${list}${scored ? `<p class="xs muted fi-calcs">${calcs}</p>` : ""}`;

    // 2. Precio y volatilidad
    const closes = state.hist?.symbols?.[sym.s]?.c;
    const year = yearRange(closes, sym.p), month = monthRange(closes, sym.p);
    const ends = (label, r) => {
      if (!r) return "";
      const at = r.max > r.min && sym.p > 0 ? Math.min(100, Math.max(0, Math.round(((sym.p - r.min) / (r.max - r.min)) * 100))) : 50;
      return `<div class="hoy-ends" role="img" aria-label="${label}: mínimo ${usd2(r.min)}, máximo ${usd2(r.max)}"><span class="muted">${label}</span><span class="num">${usd2(r.min)}</span><span class="hoy-ends-bar"><i style="left:${at}%"></i></span><span class="num">${usd2(r.max)}</span></div>`;
    };
    const vols = volatilities(closes);
    const volRows = [];
    if (sym.iv30 != null) volRows.push(["Implícita 30 d", sym.iv30, "implied"]);
    if (vols?.recentPct != null && vols.longPct != null) {
      volRows.push(["Ahora", vols.recentPct, "recent"]);
      volRows.push([spanText(closes.length / 252), vols.longPct, "long"]);
    }
    const volMax = Math.max(1, ...volRows.map((r) => r[1])) * 1.1;
    const ratio = vols?.recentPct != null && vols.longPct > 0 ? vols.recentPct / vols.longPct : null;
    const volNote = ratio == null ? "" : ratio < 0.75 ? "Ahora se mueve bastante menos que de costumbre: el cálculo reciente es el optimista." : ratio > 1.33 ? "Ahora se mueve bastante más que de costumbre." : "";
    const vol = `${ends(year && year.sessions > 250 ? "52 sem." : year ? `${year.sessions} ses.` : "", year)}${ends("1 mes", month)}
      ${
        volRows.length
          ? `<p class="xs muted" style="margin:12px 0 0">Volatilidad: cuánto se mueve al año</p>${volRows.map(([label, value, kind]) => `<div class="vol-row"><span class="vol-label">${esc(label)}</span><span class="vol-track"><i class="${kind}" style="width:${((value / volMax) * 100).toFixed(1)}%"></i></span><b class="num">${num(value, 0)} %</b></div>`).join("")}${volNote ? `<p class="xs muted" style="margin-top:6px">${volNote}</p>` : ""}`
          : ""
      }`;

    // 4. Probabilidades
    const kv = (label, value, note) => `<div class="fi-kv"><div><span>${label}</span><small class="xs muted">${note}</small></div><b class="num">${value}</b></div>`;
    const probs = `${kv("Mercado", row.prob == null ? "—" : `${num(row.prob, 1)} %${row.probSrc === "formula" ? " (fórmula)" : ""}`, "Lo que descuentan los precios de las opciones: acabar bajo el corto.")}
      ${row.histProb != null ? kv("Historia", `${num(row.histProb, 1)} %`, "Veces que, en los cierres guardados, acabó bajo el corto.") : ""}
      ${kv("Pérdida máx.", row.longProb == null ? "—" : `${num(row.longProb, 1)} %`, "Acabar bajo el largo: pierdes todo el ancho menos lo cobrado.")}`;

    // 5. Al bróker
    const text = orderText(sym, row, rows);
    const form =
      hoy.form === "abrir"
        ? `<form class="hoy-form" data-hoy-form="abrir" novalidate>
            <label class="small muted" for="hoy-credit">Crédito que cobraste, por acción</label>
            <input class="textfield" id="hoy-credit" name="credit" inputmode="decimal" autocomplete="off" value="${esc(num(rows.nat.credit, 2))}">
            <label class="small muted" for="hoy-qty" style="display:block;margin-top:10px">Contratos</label>
            <input class="textfield" id="hoy-qty" name="qty" inputmode="numeric" autocomplete="off" value="1">
            ${hoy.error ? `<p class="small down" role="alert" style="margin-top:8px">${esc(hoy.error)}</p>` : ""}
            <div style="display:flex;gap:8px;margin-top:12px"><button class="btn primary" type="submit">Apuntar</button><button class="btn" type="button" data-hoy="form-cancel">Cancelar</button></div>
            <p class="xs muted" style="margin-top:8px">Se apunta en Mis deals con el nivel de ahora (${apart ? "apartada" : checks.level}). Solo en este dispositivo.</p>
          </form>`
        : `<div class="hoy-actions"><button class="btn" data-hoy="form-open">La he abierto</button></div>`;
    const bro = `<pre class="small" id="hoy-order">${esc(text)}</pre>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><button class="btn quiet" data-hoy="copy">Copiar</button>${hoy.copied ? `<span class="xs muted" role="status">${esc(hoy.copied)}</span>` : ""}</div>
      ${form}
      <p class="xs muted" style="margin-top:8px">La app no envía órdenes. No es una orden ni un consejo, y los precios van con retraso: compruébalos en tu bróker.</p>`;

    return wrap(`${fiHead(sym)}
      ${deal}
      ${ticket}
      ${boxes}
      ${pillRow}
      <div class="fi-folds">
        ${fold("why", apart ? "Por qué está apartada" : `Por qué nivel ${checks.level}`, "", why)}
        ${fold("vol", "Precio y volatilidad", "", vol)}
        ${fold("ren", "Rentabilidad por día y costes", "", yieldTable(row, o.opts.fee))}
        ${fold("prob", "Probabilidades", "", probs)}
        ${fold("bro", "Al bróker", "", bro)}
      </div>
      ${dealsSection(sym, o, key)}`);
  }

  // ---------- 5. mis deals ----------

  function viewMis() {
    const today = nyToday();
    const bySymbol = new Map((state.scan?.symbols ?? []).map((sym) => [sym.s, sym]));
    const open = openDeals().sort((a, b) => (a.expiry < b.expiry ? -1 : a.expiry > b.expiry ? 1 : a.s.localeCompare(b.s)));
    const closed = deals.filter((deal) => deal.closedAt).sort((a, b) => b.closedAt - a.closedAt);
    if (!deals.length) {
      return `<div class="empty"><h2>Todavía no has apuntado ningún deal.</h2>
        <p class="small muted" style="margin-top:8px">Se apuntan desde la ficha de un deal, con «La he abierto». Aquí verás cuánto le queda y lo lejos que está el precio del corto y, al cerrarlo, lo que pasó con cada nivel.</p>
        <p class="small muted" style="margin-top:8px">Se guardan solo en este dispositivo.</p></div>`;
    }
    const LABEL = { lejos: "lejos del corto", cerca: "cerca del corto", debajo: "por debajo del corto", vencido: "vencido", "sin-precio": "sin precio" };
    const title = (deal) => `<b>${esc(deal.s)}</b> <span class="muted">${fmtStrike(deal.short)}/${fmtStrike(deal.long)} · ${esc(labelOf(deal.expiry))}${deal.qty > 1 ? ` · ${deal.qty} contratos` : ""}</span>`;
    const levelOf = (deal) => (deal.level == null ? '<span class="lv lvh sm">H</span>' : levelTag(deal.level, " sm"));
    const openList = open
      .map((deal) => {
        const st = dealStatus(deal, bySymbol.get(deal.s)?.p ?? null, today);
        const closing = hoy.form && hoy.form.close === deal.id;
        const lines =
          st.state === "vencido"
            ? `Venció el ${esc(labelOf(deal.expiry))}. Apunta el resultado para cerrarlo.`
            : st.price == null
              ? `Quedan ${st.dte} d · sin precio en el último barrido`
              : `Quedan ${st.dte} d · precio ${usd2(st.price)} · ${st.above >= 0 ? `${num(st.above, 1)} % por encima del corto` : `${num(-st.above, 1)} % por debajo del corto`}`;
        return `<li class="hoy-deal">
          <p>${levelOf(deal)} ${title(deal)} <span class="pill st-${st.state}">${LABEL[st.state]}</span></p>
          <p class="small muted" style="margin-top:4px">${lines}</p>
          <p class="small muted">Cobraste ${usd2(cobrado(deal))} · abierto el ${esc(labelOf(new Date(deal.openedAt).toISOString().slice(0, 10)))}</p>
          ${
            closing
              ? `<form class="hoy-form" data-hoy-form="cerrar" data-id="${esc(deal.id)}" novalidate>
                  <label class="small muted" for="hoy-result">Resultado final, en dólares. Con menos delante si perdiste.</label>
                  <input class="textfield" id="hoy-result" name="result" inputmode="decimal" autocomplete="off" value="${esc(num(cobrado(deal), 2))}">
                  ${hoy.error ? `<p class="small down" role="alert" style="margin-top:8px">${esc(hoy.error)}</p>` : ""}
                  <div style="display:flex;gap:8px;margin-top:12px"><button class="btn primary" type="submit">Cerrar deal</button><button class="btn" type="button" data-hoy="form-cancel">Cancelar</button></div>
                  <p class="xs muted" style="margin-top:8px">Si venció sin valor, el resultado es lo que cobraste. Si lo recompraste, lo cobrado menos lo pagado y las comisiones.</p>
                </form>`
              : `<div class="hoy-actions"><button class="btn quiet" data-hoy="deal-close" data-id="${esc(deal.id)}">Cerrar deal</button>${
                  bySymbol.has(deal.s) ? `<button class="btn quiet" data-hoy="cell" data-s="${esc(deal.s)}" data-e="${deal.expiry}" data-k="${deal.short}|${deal.long}">Ver ficha</button>` : ""
                }${
                  hoy.confirm === deal.id
                    ? `<button class="btn quiet down" data-hoy="deal-del-yes" data-id="${esc(deal.id)}">¿Seguro? Borrar</button>`
                    : `<button class="btn quiet" data-hoy="deal-del" data-id="${esc(deal.id)}">Borrar</button>`
                }</div>`
          }
        </li>`;
      })
      .join("");
    const record = levelRecord(deals);
    const recordRows = record
      .map(
        (row) => `<li class="hoy-rec"><span>${levelTag(row.level, " sm")} <span class="small">${row.n} ${row.n === 1 ? "deal" : "deals"} · ${row.won} en positivo</span></span>
          <span class="num small">total <b class="${row.total > 0 ? "up" : row.total < 0 ? "down" : ""}">${signedUsd(row.total)}</b> · media <b>${signedUsd(row.avg)}</b></span></li>`,
      )
      .join("");
    const closedList = closed
      .slice(0, 40)
      .map(
        (deal) => `<li class="hoy-deal"><p>${levelOf(deal)} ${title(deal)} <b class="num ${deal.result > 0 ? "up" : deal.result < 0 ? "down" : ""}" style="float:right">${deal.result == null ? "—" : signedUsd(deal.result)}</b></p>
          <p class="small muted" style="margin-top:2px">Cerrado el ${esc(labelOf(new Date(deal.closedAt).toISOString().slice(0, 10)))}${
            hoy.confirm === deal.id
              ? ` · <button class="hoy-link down" data-hoy="deal-del-yes" data-id="${esc(deal.id)}">¿Seguro? Borrar</button>`
              : ` · <button class="hoy-link" data-hoy="deal-del" data-id="${esc(deal.id)}">Borrar</button>`
          }</p></li>`,
      )
      .join("");
    return `
      ${open.length ? `<h2 class="group"><span>Abiertos</span><span class="small muted">${open.length}</span></h2><ul class="rows">${openList}</ul>` : '<p class="small muted" style="margin-top:14px">No tienes ningún deal abierto apuntado.</p>'}
      ${
        closed.length
          ? `<h2 class="group"><span>Lo que pasó, por nivel</span><span class="small muted">${closed.length} ${closed.length === 1 ? "cerrado" : "cerrados"}</span></h2>
             <ul class="rows">${recordRows}</ul>
             <p class="xs muted" style="margin-top:8px">El nivel es el que tenía cada deal al apuntarlo. Con pocos deals no dice nada; con unos meses dirá si un nivel alto de verdad sale mejor.</p>
             <h2 class="group"><span>Cerrados</span></h2><ul class="rows">${closedList}</ul>`
          : ""
      }
      <p class="xs muted" style="margin-top:12px">Guardado solo en este dispositivo. Lo que apuntas aquí no sale del móvil.</p>`;
  }

  // ---------- vista ----------

  function view() {
    const o = options();
    const closed = state.scan && !state.scan.example && pricesOutsideMarket(state.scan.at);
    const body = hoy.view === "mis" ? viewMis() : hoy.view === "nube" ? viewNube(o) : hoy.view === "barras" ? viewBarras(o) : viewMapa(o);
    return `
      ${ctx.header("Hoy", false)}
      ${closed && hoy.view !== "mis" ? '<p class="banner small">Precios tomados con el mercado cerrado: las horquillas son más anchas y salen menos casillas.</p>' : ""}
      ${segmented()}
      ${body}
      ${ctx.foot()}`;
  }

  // ---------- eventos ----------

  function click(el) {
    const act = el.dataset.hoy;
    const value = el.dataset.v;
    if (act === "view" && VIEWS.includes(value)) {
      hoy.view = value;
      hoy.form = null;
      hoy.confirm = null;
      keep();
      window.scrollTo(0, 0);
    } else if (act === "width" && WIDTHS.includes(Number(value))) {
      hoy.width = Number(value);
      keep();
    } else if (act === "price") {
      hoy.price = value === "mid" ? "mid" : "nat";
      keep();
    } else if (act === "held-open") {
      hoy.heldOpen = !hoy.heldOpen;
    } else if (act === "held") {
      hoy.held = hoy.held.includes(value) ? hoy.held.filter((name) => name !== value) : [...hoy.held, value];
      keep();
    } else if (act === "legend") {
      hoy.legendOpen = !hoy.legendOpen;
    } else if (act === "help") {
      hoy.help = !hoy.help;
    } else if (act === "bsort") {
      hoy.barSort = value === "floor" ? "floor" : "left";
      keep();
    } else if (act === "fold" && FOLDS.includes(value)) {
      hoy.folds = hoy.folds.includes(value) ? hoy.folds.filter((id) => id !== value) : [...hoy.folds, value];
      keep();
    } else if (act === "pick") {
      // Un deal de la lista de la ficha: se carga arriba y la ficha vuelve al principio.
      const [short, long] = String(el.dataset.k ?? "").split("|").map(Number);
      if (!hoy.deal || !Number.isFinite(short) || !Number.isFinite(long)) return;
      hoy.deal = { s: hoy.deal.s, expiry: el.dataset.e, short, long };
      hoy.form = null;
      hoy.error = "";
      hoy.copied = "";
      ctx.render();
      document.querySelector(".fi-sheet")?.scrollTo({ top: 0, behavior: "smooth" });
      return;
    } else if (act === "fl-lv") {
      const l = Number(value);
      hoy.fl.lv = hoy.fl.lv.includes(l) ? hoy.fl.lv.filter((x) => x !== l) : [...hoy.fl.lv, l].sort();
      hoy.fl.shown = 30;
    } else if (act === "fl-exp") {
      hoy.fl.exp = value || null;
      hoy.fl.shown = 30;
    } else if (act === "fl-w") {
      hoy.fl.w = WIDTHS.includes(Number(value)) ? Number(value) : null;
      hoy.fl.shown = 30;
    } else if (act === "fl-pr") {
      hoy.fl.pr = FL_PROBS.includes(Number(value)) ? Number(value) : null;
      hoy.fl.shown = 30;
    } else if (act === "fl-ord") {
      hoy.fl.ord = ["ben", "prob", "floor", "day"].includes(value) ? value : "lv";
    } else if (act === "fl-hide") {
      hoy.fl.hide = !hoy.fl.hide;
      hoy.fl.shown = 30;
    } else if (act === "fl-more") {
      hoy.fl.shown += 30;
    } else if (act === "fl-reset") {
      hoy.fl = { lv: [0, 1, 2, 3, 4, 5], exp: null, w: null, pr: null, hide: false, ord: hoy.fl.ord, shown: 30 };
    } else if (act === "mexp") {
      // En el mapa, tocar una fecha no saca de la matriz: la enfoca en ese vencimiento (y la nube y las barras abrirán en él).
      hoy.mapExp = value || null;
      if (value) {
        hoy.expiry = value;
        keep();
      }
    } else if (act === "exp") {
      hoy.expiry = value;
      if (hoy.view !== "barras") hoy.view = "nube";
      keep();
      window.scrollTo(0, 0);
    } else if (act === "cell") {
      const [short, long] = String(el.dataset.k ?? "").split("|").map(Number);
      if (!Number.isFinite(short) || !Number.isFinite(long)) return;
      hoy.deal = { s: el.dataset.s, expiry: el.dataset.e, short, long };
      hoy.form = null;
      hoy.error = "";
      hoy.copied = "";
    } else if (act === "close") {
      hoy.deal = null;
      hoy.form = null;
      hoy.error = "";
    } else if (act === "copy") {
      const text = document.getElementById("hoy-order")?.textContent ?? "";
      const done = (message) => {
        hoy.copied = message;
        ctx.render();
      };
      try {
        navigator.clipboard.writeText(text).then(
          () => done("Copiado."),
          () => done("No se pudo copiar solo: mantén pulsado el texto y cópialo a mano."),
        );
      } catch {
        done("No se pudo copiar solo: mantén pulsado el texto y cópialo a mano.");
      }
      return;
    } else if (act === "form-open") {
      hoy.form = "abrir";
      hoy.error = "";
    } else if (act === "form-cancel") {
      hoy.form = null;
      hoy.error = "";
    } else if (act === "deal-close") {
      hoy.form = { close: el.dataset.id };
      hoy.error = "";
      hoy.confirm = null;
    } else if (act === "deal-del") {
      hoy.confirm = el.dataset.id;
    } else if (act === "deal-del-yes") {
      deals = deals.filter((deal) => deal.id !== el.dataset.id);
      hoy.confirm = null;
      keepDeals();
    } else {
      return;
    }
    ctx.render();
  }

  function submit(form) {
    const data = new FormData(form);
    if (form.dataset.hoyForm === "abrir" && hoy.deal) {
      const o = options();
      const sym = (state.scan?.symbols ?? []).find((item) => item.s === hoy.deal.s);
      const rows = sym ? dealRows(sym, hoy.deal, o.opts, o.today) : { row: null };
      if (!rows.row) return;
      const credit = parseNumber(data.get("credit"));
      const qty = parseNumber(data.get("qty"));
      const width = rows.nat.width;
      if (!(credit > 0) || !(credit < width)) hoy.error = `Escribe el crédito por acción, entre 0,01 y ${num(width, 2)}.`;
      else if (!Number.isInteger(qty) || qty < 1 || qty > 50) hoy.error = "Escribe cuántos contratos, de 1 a 50.";
      else if (deals.length >= MAX_DEALS) hoy.error = "Hay demasiados deals apuntados. Borra alguno cerrado.";
      else {
        const gate = gateReason(rows.nat, o.opts.gapPct);
        const checks = dealChecks(rows.nat, o.opts);
        deals.push({
          id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
          s: sym.s,
          b: sym.b ?? "",
          expiry: hoy.deal.expiry,
          short: hoy.deal.short,
          long: hoy.deal.long,
          credit: Math.round(credit * 1000) / 1000,
          qty,
          fee: o.opts.fee,
          openedAt: Date.now(),
          level: gate || !checks.scored ? null : checks.level, // el nivel a precio visible; apartada = sin nivel
          retExp: rows.nat.retExp ?? null,
          price0: sym.p,
          closedAt: null,
          result: null,
        });
        keepDeals();
        hoy.deal = null;
        hoy.form = null;
        hoy.error = "";
        hoy.view = "mis";
        keep();
        window.scrollTo(0, 0);
      }
    } else if (form.dataset.hoyForm === "cerrar") {
      const deal = deals.find((item) => item.id === form.dataset.id);
      if (!deal) return;
      const result = parseNumber(data.get("result"));
      if (!Number.isFinite(result) || Math.abs(result) > 1_000_000) hoy.error = "Escribe el resultado en dólares, por ejemplo 15,80 o −120.";
      else {
        deal.result = Math.round(result * 100) / 100;
        deal.closedAt = Date.now();
        keepDeals();
        hoy.form = null;
        hoy.error = "";
      }
    }
    ctx.render();
  }

  /** Escape cierra la ficha. Devuelve true si había algo que cerrar. */
  function escape() {
    if (!hoy.deal) return false;
    hoy.deal = null;
    hoy.form = null;
    ctx.render();
    return true;
  }

  /** Abre la ficha de un nombre (desde Lista) con su mejor deal puntuado: el de más nivel que cumple las Reglas o, si ninguno, el de más nivel. */
  function openName(name) {
    const sym = (state.scan?.symbols ?? []).find((item) => item.s === name);
    if (!sym) return;
    const all = nameDeals(sym, options());
    const best = all.find((d) => d.ok) ?? all[0];
    hoy.deal = best ? { s: sym.s, expiry: best.row.expiry, short: best.row.shortStrike, long: best.row.longStrike } : { s: sym.s, none: true };
    hoy.form = null;
    hoy.error = "";
    hoy.copied = "";
    ctx.render();
  }

  /** La barra de prob.: al soltar, se aplica. */
  function setProb(value) {
    if (!probOk(value)) return false;
    hoy.prob = value;
    keep();
    return true;
  }

  return { view, sheet, click, submit, escape, setProb, openName };
}
