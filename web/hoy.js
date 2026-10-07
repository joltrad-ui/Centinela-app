// Pestaña "Hoy": el flujo nuevo, de lo ancho a lo estrecho.
//
//   1. Mapa   — nombres por vencimientos, cada casilla con su nivel de 0 a 4: ¿hay algo hoy?
//   2. Nube   — los deals de un vencimiento, coste frente a rentab. esperada: ¿cuál?
//      Barras — los mismos deals, una fila cada uno: lo que cobra, lo que se espera pagar y lo que queda con su error.
//   3. Ficha  — las cuatro comprobaciones, lo que queda con cada cálculo y los avisos: ¿me lo creo?
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
  rangeOf,
  returnsOf,
  spreadRow,
  withHistory,
  yearRange,
} from "./engine.js";

const LS_HOY = "centinela.hoy.v1";
const LS_DEALS = "centinela.misdeals.v1";
const PROBS = [5, 8, 10];
const WIDTHS = [2, 3, 5, 10];
const VIEWS = ["mapa", "nube", "barras", "mis"];
const MAX_DEALS = 300;

const usd2 = (n) => `$${num(n, 2)}`;
const dollars = (n) => (Math.abs(n) >= 10 ? `$${num(Math.round(n), 0)}` : usd2(n));
const signedUsd = (n) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${dollars(Math.abs(n))}`;
const signedPct = (n) => `${n > 0 ? "+" : ""}${num(n, 1)} %`;
const shortMoney = (n) => `$${Number.isInteger(n) ? String(n) : num(n, 2).replace(/0$/, "")}`;
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
    prob: PROBS.includes(saved.prob) ? saved.prob : null,
    width: WIDTHS.includes(saved.width) ? saved.width : null,
    price: saved.price === "mid" ? "mid" : "nat",
    held: Array.isArray(saved.held) ? saved.held.filter((name) => typeof name === "string").slice(0, 40) : [],
    expiry: typeof saved.expiry === "string" ? saved.expiry : null,
    yieldOpen: saved.yieldOpen === true, // la tabla de rendimiento de la ficha: plegada (solo "Con comisión") o con las tres filas
    // solo en memoria
    deal: null, // ficha abierta: { s, expiry, short, long }
    heldOpen: false,
    help: false,
    form: null, // "abrir" o { close: id }
    error: "",
    copied: "",
    confirm: null, // id del deal que se va a borrar
  };
  const keep = () => ctx.writeLocal(LS_HOY, { view: hoy.view, prob: hoy.prob, width: hoy.width, price: hoy.price, held: hoy.held, expiry: hoy.expiry, yieldOpen: hoy.yieldOpen });

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
        hist: state.hist?.symbols ?? null,
        held: heldBlocks(),
        price: hoy.price,
        expiries,
      },
    };
  }

  /** La fila de un deal concreto, con las cuentas de "Igual riesgo", a precio natural y a precio medio. */
  function dealRows(sym, deal, opts, today) {
    const nat = withHistory(spreadRow(sym, deal.expiry, deal.short, deal.long, opts.fee, today), opts.hist?.[sym.s], today);
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
    const heldLine = held.length ? held.join(", ") : "ninguno";
    return `<div class="filters">
      <div class="frow" role="group" aria-label="Prob. objetivo"><span class="small muted hoy-lab">Prob. objetivo</span>${PROBS.map((n) => chip("prob", n, `${n} %`, o.opts.prob === n)).join("")}</div>
      <div class="frow" role="group" aria-label="Ancho"><span class="small muted hoy-lab">Ancho</span>${WIDTHS.map((n) => chip("width", n, `$${n}`, o.opts.width === n)).join("")}</div>
      <div class="frow" role="group" aria-label="Precio"><span class="small muted hoy-lab">Precio</span>${chip("price", "nat", "Bid/Ask", hoy.price === "nat")}${chip("price", "mid", "Mid", hoy.price === "mid")}</div>
      <button class="rules-line small" data-hoy="held-open" aria-expanded="${hoy.heldOpen}">Bloques que ya tengo: ${esc(heldLine)} ${hoy.heldOpen ? "▴" : "▾"}</button>
      ${
        hoy.heldOpen
          ? `<div class="chips" role="group" aria-label="Bloques que ya tengo" style="margin-top:2px">${blocks
              .map((name) => `<button class="chip quiet" data-hoy="held" data-v="${esc(name)}" aria-pressed="${held.includes(name)}" ${fromDeals.includes(name) ? "disabled" : ""}>${esc(name)}</button>`)
              .join("")}</div>
            <p class="xs muted">Marca los bloques en los que ya tienes algo abierto. Un deal de un bloque marcado no suma el punto de bloque nuevo.${fromDeals.length ? " Los de tus deals apuntados se marcan solos." : ""} Solo en este dispositivo.</p>`
          : ""
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

  const legend = (opts) => `<p class="hoy-legend xs muted" aria-hidden="true">
      <span class="lv lv0">0</span><span>no cubre</span>
      <span class="lv lv1">1</span><span class="lv lv2">2</span><span class="lv lv3">3</span>${opts.safety === "off" ? "" : '<span class="lv lv4">4</span>'}<span>${opts.safety === "off" ? "a favor" : "todo a favor"}</span>
      ${opts.safety === "off" ? "" : `<span class="lv lv3 firm">3</span><span>${safetyText(opts).legend}</span>`}
      <span class="lv lvh">H</span><span>horquilla ancha</span>
      <span class="lv lvx">–</span><span>sin fila</span>
    </p>`;

  const help = (opts) => `<button class="rules-line small" style="margin:10px 0 0" data-hoy="help" aria-expanded="${hoy.help}">Cómo se puntúa y cómo se lee ${hoy.help ? "▴" : "▾"}</button>
    ${
      hoy.help
        ? `<div class="eq-help small muted" style="margin-top:8px">
        <p>Cada casilla es un bull put: el de ese nombre en ese vencimiento, con la prob. de asignación hasta el objetivo y el ancho más cercano al elegido. Las cuentas son las de la pestaña Igual riesgo.</p>
        <p>Nivel 0: la rentab. esperada no es positiva; lo cobrado no cubre lo que se espera pagar. Si es positiva, el nivel empieza en 1 y suma un punto por cada comprobación: ${
          opts.safety === "off"
            ? ""
            : opts.safety === "both"
              ? "los dos cálculos (5 años de precios y volatilidad reciente) salen en positivo; "
              : `lo que queda (cobras neto menos lo que se espera pagar) supera ${opts.marginK === 1 ? "una vez" : `${num(opts.marginK, 1)} veces`} el error del cálculo, que es lo que se puede equivocar la media de los dos; `
        }el coste de ida y vuelta no pasa del ${LEVEL_COST_PCT} % de lo cobrado; el bloque no es uno que ya tengas abierto.${opts.safety === "off" ? " El punto de seguridad está apagado en Reglas, así que el nivel llega a 3." : " El punto de seguridad se cambia en Reglas."}</p>
        <p>Es un nivel y no una nota porque las cuentas no dan para afinar más: dos deals del mismo nivel no se pueden ordenar con seguridad. «H» es un deal con precio pero con la horquilla demasiado ancha para fiarse. Con «Precio: Mid» se ve qué nivel tendría si te llenaran a precio medio (la mitad entre bid y ask); es una hipótesis, no un precio garantizado.</p>
        <p>Es una estimación para ordenar, no una previsión, y no es un consejo.</p>
      </div>`
        : ""
    }`;

  // ---------- 1. mapa ----------

  function viewMapa(o) {
    if (!o.symbols.length) return `<div class="empty"><h2>Esperando el primer barrido de la lista.</h2></div>`;
    if (!o.expiries.length) return `${controls(o)}<div class="empty"><h2>Ningún vencimiento cae dentro del plazo de Reglas.</h2></div>`;
    const grid = levelGrid(o.symbols, o.opts, o.today);
    const shown = grid.names.filter((name) => name.priced > 0);
    const hidden = grid.names.filter((name) => name.priced === 0);
    const cell = (name, c, i) => {
      const exp = grid.expiries[i];
      const base = `data-hoy="cell" data-s="${esc(name.sym.s)}" data-e="${exp.expiry}"`;
      if (c.state === "out") return `<span class="lv lvx" role="gridcell" aria-label="${esc(name.sym.s)} ${esc(exp.label)}: sin fila" title="${esc(c.why)}">–</span>`;
      const keys = `data-k="${c.row.shortStrike}|${c.row.longStrike}"`;
      if (c.state === "gated") return `<button class="lv lvh" role="gridcell" ${base} ${keys} aria-label="${esc(name.sym.s)} ${esc(exp.label)}: apartada, ${esc(c.gate)}">H</button>`;
      const firm = c.level >= 1 && c.checks.safe;
      return `<button class="lv lv${c.level}${firm ? " firm" : ""}" role="gridcell" ${base} ${keys} aria-label="${esc(name.sym.s)} ${esc(exp.label)}: nivel ${c.level}${firm ? `, ${safetyText(o.opts).short}` : ""}">${c.level}</button>`;
    };
    const rows = shown
      .map(
        (name) => `<div class="hoy-name" role="rowheader"><b>${esc(name.sym.s)}</b>${o.opts.held.includes(name.sym.b ?? "") ? '<i class="hoy-held" title="Bloque que ya tienes"></i>' : ""}</div>${name.cells.map((c, i) => cell(name, c, i)).join("")}`,
      )
      .join("");
    const s = grid.summary;
    const line = !s.withHistory
      ? "Todavía no hay cierres diarios guardados: sin ellos no se puede puntuar."
      : s.positive === 0
        ? "Hoy ninguna casilla cubre lo que se espera pagar."
        : `${s.top} ${s.top === 1 ? "casilla" : "casillas"} de nivel 3 o más${o.opts.safety === "off" ? "" : ` · ${s.firm} con ${o.opts.safety === "both" ? "los dos cálculos en positivo" : "margen"}`} · ${s.comparable} comparables`;
    return `${controls(o)}
      <p class="hoy-sum${s.withHistory && s.positive > 0 ? "" : " none"}">${line}</p>
      ${legend(o.opts)}
      <div class="hoy-grid" role="grid" aria-label="Nivel de cada nombre en cada vencimiento" style="grid-template-columns:54px repeat(${grid.expiries.length},minmax(0,1fr))">
        <span></span>${grid.expiries.map((exp) => `<button class="hoy-exp" data-hoy="exp" data-v="${exp.expiry}" aria-label="Ver la nube del ${esc(exp.label)}">${esc(exp.label)}</button>`).join("")}
        ${rows}
      </div>
      ${hidden.length ? `<p class="xs muted" style="margin-top:10px">Sin fila en ningún vencimiento: ${hidden.map((name) => esc(name.sym.s)).join(", ")}.</p>` : ""}
      <p class="xs muted" style="margin-top:8px">Toca una casilla para ver el deal. Toca una fecha para comparar los de ese vencimiento.</p>
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
    const pts = cells.filter((c) => c.state === "level" && c.checks.scored && c.checks.costShare != null).sort((a, b) => b.row.retExp - a.row.retExp);
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
      .sort((a, b) => b.r.expected - a.r.expected);
    const gated = cells.filter((c) => c.state === "gated").length;
    const expChips = `<div class="frow" role="group" aria-label="Vencimiento"><span class="small muted hoy-lab">Vencimiento</span>${o.expiries.map((e) => chip("exp", e, esc(labelOf(e)), e === expiry)).join("")}</div>`;
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
          const firm = c.level >= 1 && c.checks.safe;
          const errText = r.err == null ? "" : ` <small>± ${num(r.err, 1)}</small>`;
          return `<li><button class="hoy-brow" data-hoy="cell" data-s="${esc(c.sym.s)}" data-e="${expiry}" data-k="${c.row.shortStrike}|${c.row.longStrike}" aria-label="${esc(c.sym.s)}: cobra ${num(r.collected, 1)} %, se espera pagar ${num(r.pay, 1)} %, queda ${signedPct(r.expected)}${r.err == null ? "" : `, error ${num(r.err, 1)}`}">
            <span class="hoy-brow-top">${levelTag(c.level, ` sm${firm ? " firm" : ""}`)} <b>${esc(c.sym.s)}</b> <span class="muted">${fmtStrike(c.row.shortStrike)}/${fmtStrike(c.row.longStrike)}</span>
              <span class="hoy-brow-kpi num ${pos ? "plus" : "minus"}">${signedPct(r.expected)}${errText}</span></span>
            <svg viewBox="0 0 ${W} ${H}" aria-hidden="true">${gridLines}
              <line x1="${px.toFixed(1)}" x2="${gx.toFixed(1)}" y1="${cy}" y2="${cy}" class="b-pay"/>${whisker}${dot}
              <rect x="${(gx - 4.5).toFixed(1)}" y="${cy - 4.5}" width="9" height="9" transform="rotate(45 ${gx.toFixed(1)} ${cy})" class="b-got"/></svg>
            <span class="hoy-brow-sub xs muted">cobras ${usd2(c.row.net)} · se espera pagar ${usd2(c.row.expected)} · coste ${c.checks.costShare} %</span>
          </button></li>`;
        })
        .join("");
      const errLegend = k === 1 ? "± el error" : `± ${num(k, 1)} veces el error`;
      const pair = (icon, text) => `<span class="hoy-pair">${icon}${text}</span>`;
      body = `<p class="hoy-legend xs muted" aria-hidden="true">
          ${pair('<svg viewBox="0 0 14 14" width="14" height="14"><circle cx="7" cy="7" r="5" class="b-dot"/></svg>', "queda de media")}
          ${pair('<svg viewBox="0 0 22 14" width="22" height="14"><line x1="2" x2="20" y1="7" y2="7" class="b-err"/></svg>', errLegend)}
          ${pair('<svg viewBox="0 0 14 14" width="14" height="14"><rect x="3" y="3" width="8" height="8" transform="rotate(45 7 7)" class="b-got"/></svg>', "cobras")}
          ${pair('<svg viewBox="0 0 22 14" width="22" height="14"><line x1="2" x2="20" y1="7" y2="7" class="b-pay"/></svg>', "se espera pagar")}
        </p>
        <div class="hoy-bars">
          <div class="hoy-brow-axis"><p class="xs muted">% de lo que arriesgas («pierdes máx.»)</p><svg viewBox="0 0 ${W} 14" aria-hidden="true">${ticks}</svg></div>
          <ul>${rowsHtml}</ul>
        </div>
        <p class="xs muted" style="margin-top:8px">${pts.length} ${pts.length === 1 ? "deal comparable" : "deals comparables"}, por lo que queda de media. ${
          o.opts.safety === "margin" ? "Si la barra no toca el cero, lo que queda supera el error: tiene el punto de seguridad. " : ""
        }La flecha marca lo que cae por debajo de −${num(Math.abs(lo), 0)} %. Toca una fila para ver el deal.</p>`;
    }
    return `${controls(o)}${expChips}
      ${body}
      ${gated ? `<p class="xs muted" style="margin-top:10px">${gated} ${gated === 1 ? "nombre apartado" : "nombres apartados"} por horquilla ancha o por coste: se ven en el mapa con una H.</p>` : ""}
      ${notes(o)}
      ${help(o.opts)}`;
  }

  // ---------- 3 y 4. ficha del deal y resumen para el bróker ----------

  /** Lo que queda con cada cálculo, en una barra: de un extremo al otro y el cero. Corta y a la derecha del cero es firme. */
  function marginBar(row) {
    if (row.expected == null) return "";
    const a = row.marginRecent, b = row.marginHist, m = Math.round((row.net - row.expected) * 100) / 100;
    const lo = Math.min(a, b, 0), hi = Math.max(a, b, 0);
    const pad = Math.max((hi - lo) * 0.14, 1);
    const W = 320, L = 8, R = 8;
    const x = (v) => L + ((v - (lo - pad)) / (hi - lo + 2 * pad)) * (W - L - R);
    const tone = a > 0 && b > 0 ? "plus" : a <= 0 && b <= 0 ? "minus" : "mixed";
    const anchor = (px) => (px < 62 ? "start" : px > W - 62 ? "end" : "middle");
    const xa = x(a), xb = x(b);
    // Tres alturas para que nada se pise: arriba lo reciente, en medio la barra y el cero, abajo la historia.
    return `<div class="hoy-bar">
      <p class="small">Queda, de media, <b class="num ${m > 0 ? "up" : "down"}">${signedUsd(m)}</b>${row.err != null ? ` <span class="num muted">± ${dollars(row.err)}</span>` : ""} <span class="muted">· cobras neto menos lo que se espera pagar</span></p>
      <svg viewBox="0 0 ${W} 82" role="img" aria-label="Con la volatilidad reciente queda ${signedUsd(a)}; con 5 años de precios, ${signedUsd(b)}">
        <line x1="${L}" x2="${W - R}" y1="38" y2="38" class="grid"/>
        <line x1="${x(0).toFixed(1)}" x2="${x(0).toFixed(1)}" y1="25" y2="51" class="zero"/>
        <text x="${x(0).toFixed(1)}" y="62" text-anchor="middle" class="tick">0</text>
        <line x1="${Math.min(xa, xb).toFixed(1)}" x2="${Math.max(xa, xb).toFixed(1)}" y1="38" y2="38" class="span ${tone}"/>
        <circle cx="${xa.toFixed(1)}" cy="38" r="4" class="end ${tone}"/><circle cx="${xb.toFixed(1)}" cy="38" r="4" class="end ${tone}"/>
        <circle cx="${x(m).toFixed(1)}" cy="38" r="6.5" class="mean"/>
        <text x="${xa.toFixed(1)}" y="13" text-anchor="${anchor(xa)}" class="lab">reciente ${signedUsd(a)}</text>
        <text x="${xb.toFixed(1)}" y="77" text-anchor="${anchor(xb)}" class="lab">historia ${signedUsd(b)}</text>
      </svg>
    </div>`;
  }

  /** El punto de seguridad en la ficha, según la regla. Apagado no sale: queda la barra de los dos cálculos. */
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
      `Queda <b class="num">${signedUsd(left)}</b> y el cálculo se puede equivocar en ±${dollars(row.err)}: ${num(Math.max(0, checks.room), 1)} ${checks.room === 1 ? "vez" : "veces"}. Pides ${k}. ${calcs}`,
    );
  }

  /** Lo que rinde el deal: sin comisión, con comisión y tras lo que se espera pagar. Cada fila, en dólares, por día, sobre lo que arriesgas y sobre lo que arriesgas por día. */
  function yieldTable(row, fee) {
    const r = returnsOf(row, fee);
    if (!r) return "";
    const pct = (n, d) => (n == null ? "—" : `${n < 0 ? "−" : ""}${num(Math.abs(n), d)} %`);
    const usd = (n) => `${n > 0 ? "+" : n < 0 ? "−" : ""}$${num(Math.abs(n), 2)}`; // siempre con céntimos: aquí importan
    const cls = (n) => (n > 0 ? "up" : n < 0 ? "down" : "");
    const line = (label, sub, v) =>
      v
        ? `<tbody>${label ? `<tr class="lab"><th scope="rowgroup" colspan="4">${label}${sub ? ` <small>${sub}</small>` : ""}</th></tr>` : ""}
          <tr><td class="num ${cls(v.gain)}">${usd(v.gain)}</td><td class="num ${cls(v.perDay)}">${usd(v.perDay)}</td><td class="num ${cls(v.onRisk)}">${pct(v.onRisk, 2)}</td><td class="num ${cls(v.onRiskPerDay)}">${pct(v.onRiskPerDay, 3)}</td></tr></tbody>`
        : "";
    const open = hoy.yieldOpen;
    return `<div class="hoy-yield">
      <button class="hoy-yield-head" data-hoy="yield" aria-expanded="${open}"><span class="muted">${r.days} ${r.days === 1 ? "día" : "días"} al vencimiento</span><span class="muted">${open ? "Ocultar ▴" : "Ver más ▾"}</span></button>
      <table>
        <thead><tr><th scope="col" title="Gano">G</th><th scope="col" title="Gano por día">G/D</th><th scope="col" title="Gano sobre lo que arriesgas">G/S</th><th scope="col" title="Gano sobre lo que arriesgas, por día">G/S/D</th></tr></thead>
        ${open ? line("Sin comisión", hoy.price === "mid" ? "a precio medio" : "a precio visible", r.gross) : ""}
        ${line(open ? "Con comisión" : "", "", r.net)}
        ${open ? line("Esperada", "tras lo que se espera pagar", r.expected) : ""}
      </table>
      <p class="xs muted hoy-yield-key">Comisión de abrir: ${usd2(fee)}.${open ? " G = gano · D = día · S = spread, lo que arriesgas («pierdes máx.»). Por contrato." : ""}</p>
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

  function sheet() {
    if (!hoy.deal) return "";
    const o = options();
    const sym = (state.scan?.symbols ?? []).find((item) => item.s === hoy.deal.s);
    if (!sym) return "";
    const rows = dealRows(sym, hoy.deal, o.opts, o.today);
    const closes = state.hist?.symbols?.[sym.s]?.c;
    const year = yearRange(closes, sym.p), month = monthRange(closes, sym.p);
    const ends = (label, r) => (r ? `<div class="hoy-ends"><span class="muted">${label}</span><span class="num"><b>${usd2(r.min)}</b> mín.</span><span class="num">máx. <b>${usd2(r.max)}</b></span></div>` : "");
    const name = [sym.n, sym.b].filter((text, i, all) => text && text !== sym.s && all.indexOf(text) === i).join(" · ");
    const head = `<div class="sheet-head">
        <div style="min-width:0"><h2 style="font-size:2rem">${esc(sym.s)}</h2><p class="small muted">${esc(name)}</p></div>
        <button class="btn quiet" data-hoy="close">Cerrar</button>
      </div>
      <div class="hoy-quote">
        <p class="hoy-price num">${sym.p > 0 ? usd2(sym.p) : "sin precio"}</p>
        ${ends(year && year.sessions > 250 ? "52 semanas" : year ? `${year.sessions} sesiones` : "", year)}${ends("1 mes", month)}
      </div>`;
    if (!rows.row) {
      return `<div class="sheet-back" data-hoy="close"><div class="sheet hoy-sheet" role="dialog" aria-modal="true" aria-label="${esc(sym.s)}">${head}
        <p class="small muted" style="margin-top:14px">Ese bull put ya no tiene precio${rows.why ? `: ${esc(rows.why.toLowerCase())}` : ""}.</p></div></div>`;
    }
    const row = rows.row;
    const checks = dealChecks(row, o.opts);
    const gate = gateReason(rows.nat, o.opts.gapPct);
    const apart = hoy.price === "nat" && gate;
    const both = row.marginHist > 0 && row.marginRecent > 0;
    const anyOne = row.marginHist > 0 || row.marginRecent > 0;
    const item = (ok, text, sub = "") => `<li class="${ok ? "yes" : "no"}"><i aria-hidden="true">${ok ? "✓" : "✕"}</i><span>${text}${sub ? `<small>${sub}</small>` : ""}</span></li>`;
    const maxLevel = o.opts.safety === "off" ? 3 : 4;
    const list = checks.scored
      ? `<ul class="hoy-checks">
        ${item(checks.positive, `Rentab. esperada <b class="num">${signedPct(row.retExp)}</b>`, checks.positive ? "Lo cobrado supera lo que se espera pagar." : "Lo cobrado no cubre lo que se espera pagar. Sin esto, nivel 0.")}
        ${safetyItem(item, checks, row, o.opts, both, anyOne)}
        ${item(checks.cheap, checks.costShare == null ? "Coste sin precio medio" : `Coste de ida y vuelta: <b class="num">${checks.costShare} %</b> de lo cobrado`, `Tope para el punto: ${LEVEL_COST_PCT} %. Entrar y salir cuesta ${row.roundTrip == null ? "—" : usd2(row.roundTrip)}.`)}
        ${item(checks.fresh, checks.fresh ? `Bloque nuevo: ${esc(sym.b ?? "sin bloque")}` : `Repite un bloque que ya tienes: ${esc(sym.b ?? "")}`)}
      </ul>`
      : '<p class="small muted" style="margin-top:12px">Sin cierres diarios de este nombre no se puede puntuar.</p>';
    const pills = [];
    if (row.earnInside && sym.er) pills.push(`<span class="tag-earn">Resultados ${esc(labelOf(sym.er.d))}</span>`);
    if (row.fed?.length) pills.push(`<span class="tag-earn">Fed el ${row.fed.map((date) => esc(labelOf(date))).join(" y ")}</span>`);
    for (const note of row.trend ?? []) pills.push(`<span class="tag-note brass">${esc(note)}</span>`);
    if (row.shortHistory && row.histProb != null) pills.push('<span class="tag-note">poca historia</span>');
    if (row.distinct && !row.onlyOne) pills.push('<span class="tag-note">estimaciones muy distintas</span>');
    const badge = apart
      ? `<p class="hoy-badge"><span class="lv lvh big">H</span><span><b>Apartada de la comparación</b><small>${esc(gate)}. A precio visible no se puntúa.</small></span></p>`
      : `<p class="hoy-badge"><span class="lv lv${checks.level} big">${checks.level}</span><span><b>Nivel ${checks.level} de ${maxLevel}</b><small>${hoy.price === "mid" ? "Si te llenaran a precio medio: una hipótesis, no un precio garantizado." : checks.level === 0 ? "No cubre lo que se espera pagar." : "A precio visible."}</small></span></p>`;
    const pair = (label, value) => `<span class="eq-pair"><span class="eq-lab">${label}</span> <b class="num">${value}</b></span>`;
    const probs = [pair("asignación", row.prob == null ? "—" : `${num(row.prob, 1)} %${row.probSrc === "formula" ? " (fórmula)" : ""}`)];
    if (row.histProb != null) probs.push(pair("historia", `${num(row.histProb, 1)} %`));
    probs.push(pair("pérd. máx.", row.longProb == null ? "—" : `${num(row.longProb, 1)} %`));
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
        : `<div class="hoy-actions"><button class="btn" data-hoy="form-open">La he abierto</button><button class="btn" data-hoy="name" data-s="${esc(sym.s)}" data-k="${esc(dealKey(row))}">Ver todo de ${esc(sym.s)}</button></div>`;
    return `<div class="sheet-back" data-hoy="close">
      <div class="sheet hoy-sheet" role="dialog" aria-modal="true" aria-label="${esc(sym.s)}">
        ${head}
        <p class="chosen-title" style="margin-top:10px">${fmtStrike(row.shortStrike)}/${fmtStrike(row.longStrike)} · ${esc(row.expiryLabel)} · ${row.dte} d · ancho ${shortMoney(row.width)} · ${num(row.otm, 1)} % abajo</p>
        ${badge}
        <span class="eq-stakes" style="margin-top:12px"><span class="eq-stake"><span class="eq-lab">Cobras neto</span><b class="num up">${usd2(row.net)}</b></span><span class="eq-stake"><span class="eq-lab">Coste total</span><b class="num">${row.roundTrip == null ? "—" : usd2(row.roundTrip)}</b></span><span class="eq-stake"><span class="eq-lab">Pierdes máx.</span><b class="num down">${usd2(row.loss)}</b></span></span>
        ${pills.length ? `<span class="eq-tags small" style="margin-top:10px">${pills.join("")}</span>` : ""}
        ${yieldTable(row, o.opts.fee)}
        ${list}
        ${marginBar(row)}
        <span class="eq-mini" style="margin-top:12px"><span class="eq-line"><span class="eq-lab">Prob.</span>${probs.join("")}</span></span>
        <p class="small muted" style="margin-top:8px">Pierdes por debajo de ${usd2(row.breakeven)}. El precio está en ${usd2(sym.p)}.</p>
        <div class="hoy-order">
          <p class="small"><b style="font-weight:500">Resumen para tu bróker</b></p>
          <pre class="small" id="hoy-order">${esc(text)}</pre>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><button class="btn quiet" data-hoy="copy">Copiar</button>${hoy.copied ? `<span class="xs muted" role="status">${esc(hoy.copied)}</span>` : ""}</div>
          <p class="xs muted" style="margin-top:6px">La app no envía órdenes. No es una orden ni un consejo, y los precios van con retraso: compruébalos en tu bróker.</p>
        </div>
        ${form}
      </div>
    </div>`;
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
      ${ctx.header("Nuevo", "Hoy", false)}
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
    } else if (act === "prob" && PROBS.includes(Number(value))) {
      hoy.prob = Number(value);
      keep();
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
    } else if (act === "help") {
      hoy.help = !hoy.help;
    } else if (act === "yield") {
      hoy.yieldOpen = !hoy.yieldOpen;
      keep();
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
    } else if (act === "name") {
      // La ficha de siempre, con todos los bull puts del nombre.
      hoy.deal = null;
      state.detail = el.dataset.s;
      state.detailDeal = el.dataset.k ?? null;
      state.detailSrc = "igual";
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

  return { view, sheet, click, submit, escape };
}
