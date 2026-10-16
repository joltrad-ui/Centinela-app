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

import { emptyBox, notice, sectionHead } from "./ui.js";
import { createVistas } from "./hoy-vistas.js";
import { PR, W, filterBars, filterRow } from "./filtros.js";
import { PROBS, probOk, priceChart, WIDTHS, FL_W_MIN, FL_W_MAX, FL_PR_MIN, FL_PR_MAX, FOLDS, VIEWS, MAX_DEALS, usd2, signedUsd, signedPct, nearest, dealKey, parseNumber, safetyItem, failShort, spanText, usdS, tone, yieldTable, orderText, benefit, sortDeals, dollars } from "./hoy-calc.js";
import {
  LEVEL_COST_PCT,
  PROB_OFF,
  atMid,
  dealChecks,
  dealStatus,
  fmtStrike,
  gateReason,
  labelOf,
  levelRecord,
  mapExpiries,
  monthRange,
  num,
  nyToday,
  pricesOutsideMarket,
  qualityDeals,
  changeOver,
  sma,
  spreadRow,
  volatilities,
  withHistory,
  yearRange,
} from "./engine.js";

const LS_HOY = "centinela.hoy.v1";
const LS_DEALS = "centinela.misdeals.v1";

export function createHoy(ctx) {
  const { state, esc } = ctx;

  // ---------- lo guardado en el dispositivo ----------

  const saved = ctx.readLocal(LS_HOY) ?? {};
  const hoy = {
    view: VIEWS.includes(saved.view) ? saved.view : "mapa",
    prob: probOk(saved.prob) ? saved.prob : null,
    width: Number.isFinite(saved.width) && saved.width >= FL_W_MIN / 100 && saved.width <= FL_W_MAX / 100 ? saved.width : null,
    price: saved.price === "mid" ? "mid" : "nat",
    held: Array.isArray(saved.held) ? saved.held.filter((name) => typeof name === "string").slice(0, 40) : [],
    expiry: typeof saved.expiry === "string" ? saved.expiry : null,
    fOpen: saved.fOpen === true, // "Más filtros": comprimidos de fábrica
    barSort: saved.barSort === "floor" ? "floor" : "left", // orden de la vista Barras: por lo que queda o por el suelo
    folds: Array.isArray(saved.folds) ? saved.folds.filter((id) => FOLDS.includes(id)) : [], // bloques de la ficha que estaban abiertos
    // solo en memoria
    deal: null, // ficha abierta: { s, expiry, short, long } o { s, none: true } si el nombre no tiene deals puntuados
    fl: { lv: [0, 1, 2, 3, 4, 5], days: null, w: null, pr: null, hide: false, ord: "lv", shown: 30 }, // filtros de la lista de deals de la ficha
    heldOpen: false,
    mapExp: null, // el mapa enfocado en un vencimiento (null = todas las fechas)
    legendOpen: false, // la leyenda del mapa, plegada al final de la matriz
    help: false,
    form: null, // "abrir" o { close: id }
    error: "",
    copied: "",
    confirm: null, // id del deal que se va a borrar
    draft: null, // lo escrito en «Apuntar uno que ya tengo», para no perderlo si hay un error
  };
  const keep = () => ctx.writeLocal(LS_HOY, { view: hoy.view, prob: hoy.prob, width: hoy.width, price: hoy.price, held: hoy.held, expiry: hoy.expiry, folds: hoy.folds, barSort: hoy.barSort, fOpen: hoy.fOpen });

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
      prob0: n(row.prob0),
      price0: n(row.price0),
      closedAt: n(row.closedAt),
      result: n(row.result),
      manual: row.manual === true,
    };
  };
  const rawDeals = ctx.readLocal(LS_DEALS);
  let deals = (Array.isArray(rawDeals) ? rawDeals : []).map(cleanDeal).filter(Boolean).slice(0, MAX_DEALS);
  const keepDeals = () => ctx.writeLocal(LS_DEALS, deals);
  const openDeals = () => deals.filter((deal) => !deal.closedAt);
  const cobrado = (deal) => deal.credit * 100 * deal.qty - deal.fee * deal.qty;

  // ---------- opciones y cuentas ----------

  /** Bloques que ya están abiertos: los que él marca a mano y los de sus deals apuntados sin cerrar. */
  const heldBlocks = (except = null) => [...new Set([...hoy.held, ...openDeals().filter((deal) => deal !== except).map((deal) => deal.b).filter(Boolean)])];

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
  /** Los recuentos de una línea (Hoy y Buscador): rótulo apagado y número, sin caja. items = [[rótulo, n], ...] */
  const stats = (items, label = "Recuentos") => `<div class="stats" role="group" aria-label="${label}">${items.map(([name, n]) => `<span class="stat"><span class="xs muted">${name}</span><b class="num">${n}</b></span>`).join("")}</div>`;
  const levelTag = (level, extra = "") => `<span class="lv lv${level}${extra}">${level}</span>`;

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
        { rules, fee: o.opts.fee, gapPct: o.opts.gapPct, safety: o.opts.safety, marginK: o.opts.marginK, errVolPct: rules.errVolPct, errHistK: rules.errHistK, hist: o.opts.hist, held: o.opts.held, price: hoy.price, maxProb: 30, maxWidth: 10 },
        o.today,
      );
      nameCache = { key, deals: out.deals };
    }
    return nameCache.deals;
  }

  /** Un bloque plegable: título, una frase a la derecha y un chevron. Cerrado de fábrica; lo abierto se recuerda en el dispositivo. */
  const foldBlock = (action, value, title, sub, open, body) =>
    `<section class="fi-fold${action === "fold" ? "" : " solo"}"><button class="fi-fold-h" data-hoy="${action}"${value ? ` data-v="${value}"` : ""} aria-expanded="${open}"><span class="fi-fold-t">${title}</span>${sub ? `<span class="fi-fold-s">${sub}</span>` : ""}<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M4 6l4 4 4-4"/></svg></button>${open ? `<div class="fi-fold-b">${body}</div>` : ""}</section>`;
  const fold = (id, title, sub, body) => foldBlock("fold", id, title, sub, hoy.folds.includes(id), body);
  const { segmented, viewMapa, viewNube, viewBarras } = createVistas({ hoy, ctx, esc, chip, stats, levelTag, openDeals, foldBlock });

  const fiHead = (sym) => {
    const name = [sym.n, sym.b].filter((text, i, all) => text && text !== sym.s && all.indexOf(text) === i).join(" · ");
    const chg = typeof sym.c === "number" && Number.isFinite(sym.c) ? `<span class="fi-chg num ${tone(sym.c)}">${sym.c > 0 ? "+" : sym.c < 0 ? "−" : ""}${num(Math.abs(sym.c), 2)} %</span>` : "";
    return `<div class="fi-head">
        <div class="fi-id"><h2>${esc(sym.s)}</h2><b class="fi-price num">${sym.p > 0 ? usd2(sym.p) : "sin precio"}</b>${chg}</div>
        <button class="fi-x" data-hoy="close" aria-label="Cerrar">✕</button>
      </div>
      <p class="small muted fi-sub">${esc(name)}</p>`;
  };

  /** Una fila de la lista de deals. En la ficha (`withName` falso) elige ese deal; en el Buscador lleva el nombre y abre la ficha. */
  function dealRow(d, { selectedKey = null, withName = false, note = "" } = {}) {
      const r = d.row;
      const left = r.net - r.expected;
      const p = benefit(d);
      const key = dealKey(r);
      const sel = key === selectedKey;
      const out = d.ok ? "" : `<small class="xs fi-out">fuera de Reglas${d.fails.length ? `: ${esc([...new Set(d.fails.map(failShort))].join(", "))}` : ""}</small>`;
      return `<li><button class="fi-dr${sel ? " on" : ""}" data-hoy="${withName ? "cell" : "pick"}"${withName ? ` data-s="${esc(d.sym.s)}"` : ""} data-e="${r.expiry}" data-k="${r.shortStrike}|${r.longStrike}" aria-pressed="${sel}">
          <span class="lv lv${d.level} fi-dr-lv">${d.level}</span>
          <span class="fi-dr-m"><span class="fi-dr-t">${withName ? `<b>${esc(d.sym.s)}</b> ` : ""}<b class="num">${fmtStrike(r.shortStrike)}/${fmtStrike(r.longStrike)}</b> <span class="muted">· ${esc(r.expiryLabel)}</span></span>
            <small class="xs muted num">prob. ${r.prob == null ? "—" : `${num(r.prob, 1)} %`} · ancho $${num(r.width * 100, 0)}</small>${out}${note ? `<small class="xs muted">${note}</small>` : ""}</span>
          <span class="fi-dr-r num"><span class="fi-dr-v"><b class="${tone(left)}">${usdS(left)}</b>${p == null ? "" : ` <span class="${tone(left)}">${p < 0 ? "−" : ""}${num(Math.abs(p), 0)} %</span>`}</span><small class="xs muted">queda</small></span>
        </button></li>`;
  }

  /** Todos los deals puntuados del nombre, con sus filtros. La fila elegida lleva una barra a la izquierda. */
  function dealsSection(sym, o, selectedKey) {
    const all = nameDeals(sym, o);
    const f = hoy.fl;
    const dtes = all.map((d) => d.row.dte).filter(Number.isFinite);
    const dMin = dtes.length ? Math.min(...dtes) : 0;
    const dMax = dtes.length ? Math.max(...dtes) : 0;
    const rest = (d) => (!f.days || d.row.dte <= f.days) && (!f.w || d.row.width * 100 <= f.w + 1e-6) && (!f.pr || (d.row.prob ?? 100) <= f.pr + 1e-9) && !(f.hide && !d.ok);
    const pool = all.filter(rest);
    const by = (l) => pool.filter((d) => d.level === l).length;
    const sum = stats([["Nivel 5", by(5)], ["Nivel 4", by(4)], ["Nivel 3", by(3)], ["Margen", pool.filter((d) => d.checks.safe).length]], "Deals por nivel");
    let list = all.filter(
      (d) => f.lv.includes(d.level) && (!f.days || d.row.dte <= f.days) && (!f.w || d.row.width * 100 <= f.w + 1e-6) && (!f.pr || (d.row.prob ?? 100) <= f.pr + 1e-9) && !(f.hide && !d.ok),
    );
    list = sortDeals(list, f.ord);
    const shown = list.slice(0, f.shown);
    const chipRow = filterRow;
    const filters = `<div class="fi-filters">
        ${filterBars({ prefix: "fi", lv: { attr: 'data-hoy="fl-lv"', selected: f.lv }, days: { min: dMin, max: dMax, value: f.days }, w: f.w ?? W.max, pr: f.pr ?? PR.max })}
        ${chipRow("Ocultar", chip("fl-hide", "", "Fuera de Reglas", f.hide))}
      </div>`;
    // El orden va abajo del todo de los filtros, pegado a la lista y a todo el ancho, sin rótulo.
    const sortBar = `<div class="fi-sort sortbar eq" role="group" aria-label="Orden">${[["lv", "Nivel"], ["ben", "Beneficio"], ["prob", "Prob."], ["floor", "Suelo"], ["day", "Por día"]].map(([id, label]) => `<button data-hoy="fl-ord" data-v="${id}" aria-pressed="${f.ord === id}">${label}</button>`).join("")}</div>`;
    const rowHtml = (d) => dealRow(d, { selectedKey });
    return `<section class="fi-deals">
        ${sectionHead(`Deals de ${esc(sym.s)}`, `${list.length} de ${all.length}`)}
        ${all.length ? filters + sum + sortBar : ""}
        ${
          all.length === 0
            ? `<p class="small muted">Ahora no hay ningún bull put puntuado de ${esc(sym.s)} en el plazo de Reglas.</p>`
            : list.length === 0
              ? emptyBox("Ningún deal con estos filtros.", "", { attrs: 'data-hoy="fl-reset"', label: "Quitar filtros" })
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
    const m50 = sma(closes, 50);
    const ch5 = changeOver(closes, 5, sym.p);
    const kvr = (label, value, note, cls = "") => `<div class="fi-kv"><div><span>${label}</span><small class="xs muted">${note}</small></div><b class="num ${cls}">${value}</b></div>`;
    const chart = priceChart(closes, sym.p, row?.shortStrike);
    const trendRows =
      (m50 ? kvr("Media de 50 días", usd2(m50), `El precio está un ${num(Math.abs((sym.p / m50 - 1) * 100), 1)} % ${sym.p >= m50 ? "por encima" : "por debajo"}.`) : "") +
      (ch5 != null ? kvr("Últimas 5 sesiones", signedPct(ch5), "Cambio del precio frente al cierre de hace 5 sesiones.", tone(ch5)) : "");
    const vol = `${chart}${trendRows}${ends(year && year.sessions > 250 ? "52 sem." : year ? `${year.sessions} ses.` : "", year)}${ends("1 mes", month)}
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
        ${fold("ren", "Rentabilidad por día y costes", "", yieldTable(row, o.opts.fee, hoy.price))}
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
    const md = hoy.draft ?? {};
    const mv = (name, fallback = "") => ` value="${esc(md[name] ?? fallback)}"`;
    const manual =
      hoy.form === "manual"
        ? `<form class="hoy-form" data-hoy-form="manual" novalidate>
            <label class="small muted" for="hoy-m-s">Símbolo</label>
            <input class="textfield" id="hoy-m-s" name="s" autocapitalize="characters" autocomplete="off" maxlength="8"${mv("s")}>
            <label class="small muted" for="hoy-m-e" style="display:block;margin-top:10px">Vencimiento</label>
            <input class="textfield" id="hoy-m-e" name="expiry" type="date"${mv("expiry")}>
            <label class="small muted" for="hoy-m-k" style="display:block;margin-top:10px">Strike corto (el que vendes)</label>
            <input class="textfield" id="hoy-m-k" name="short" inputmode="decimal" autocomplete="off"${mv("short")}>
            <label class="small muted" for="hoy-m-l" style="display:block;margin-top:10px">Strike largo (el que compras)</label>
            <input class="textfield" id="hoy-m-l" name="long" inputmode="decimal" autocomplete="off"${mv("long")}>
            <label class="small muted" for="hoy-m-c" style="display:block;margin-top:10px">Crédito que cobraste, por acción</label>
            <input class="textfield" id="hoy-m-c" name="credit" inputmode="decimal" autocomplete="off"${mv("credit")}>
            <label class="small muted" for="hoy-m-q" style="display:block;margin-top:10px">Contratos</label>
            <input class="textfield" id="hoy-m-q" name="qty" inputmode="numeric" autocomplete="off"${mv("qty", "1")}>
            ${hoy.error ? `<p class="small down" role="alert" style="margin-top:8px">${esc(hoy.error)}</p>` : ""}
            <div style="display:flex;gap:8px;margin-top:12px"><button class="btn primary" type="submit">Apuntar</button><button class="btn" type="button" data-hoy="form-cancel">Cancelar</button></div>
            <p class="xs muted" style="margin-top:8px">Va a Mis deals sin nivel (M) y no entra en el recuento por nivel. Solo en este dispositivo.</p>
          </form>`
        : `<div class="hoy-actions" style="margin-top:14px"><button class="btn" data-hoy="form-manual">Apuntar uno que ya tengo</button></div>`;
    if (!deals.length) {
      return emptyBox("Todavía no has apuntado ningún deal.", ["Se apuntan desde la ficha de un deal, con «La he abierto», o a mano si ya lo tienes abierto en tu bróker. Aquí verás cuánto le queda y lo lejos que está el precio del corto y, al cerrarlo, lo que pasó con cada nivel.", "Se guardan solo en este dispositivo."]) + manual;
    }
    const LABEL = { lejos: "lejos del corto", cerca: "cerca del corto", debajo: "por debajo del corto", vencido: "vencido", "sin-precio": "sin precio" };
    const title = (deal) => `<b>${esc(deal.s)}</b> <span class="muted">${fmtStrike(deal.short)}/${fmtStrike(deal.long)} · ${esc(labelOf(deal.expiry))}${deal.qty > 1 ? ` · ${deal.qty} contratos` : ""}</span>`;
    const levelOf = (deal) => (deal.manual ? '<span class="lv lvh sm" role="img" aria-label="Sin nivel: apuntado a mano">M</span>' : deal.level == null ? '<span class="lv lvh sm">H</span>' : levelTag(deal.level, " sm"));
    const o = options();
    const RANK = { vencido: 0, debajo: 1, cerca: 2, lejos: 3, "sin-precio": 4 };
    const live = (deal) => {
      const sym = bySymbol.get(deal.s);
      if (!sym) return null;
      const opts = { ...o.opts, held: heldBlocks(deal) }; // su propio bloque no cuenta contra él
      const rows = dealRows(sym, deal, opts, today);
      if (!rows.nat) return null;
      const checks = dealChecks(rows.nat, opts);
      return { level: gateReason(rows.nat, opts.gapPct) || !checks.scored ? null : checks.level, prob: rows.nat.prob, mid: rows.nat.midCredit };
    };
    const cards = open
      .map((deal) => ({ deal, st: dealStatus(deal, bySymbol.get(deal.s)?.p ?? null, today), lv: live(deal) }))
      .sort((x, y) => RANK[x.st.state] - RANK[y.st.state] || (x.deal.expiry < y.deal.expiry ? -1 : x.deal.expiry > y.deal.expiry ? 1 : x.deal.s.localeCompare(y.deal.s)));
    const openList = cards
      .map(({ deal, st, lv }) => {
        const closing = hoy.form && hoy.form.close === deal.id;
        const cur = lv?.level ?? null;
        const badge = cur != null ? levelTag(cur, " mid") : deal.manual ? '<span class="lv lvh mid" role="img" aria-label="Sin nivel: apuntado a mano">M</span>' : deal.level == null ? '<span class="lv lvh mid">H</span>' : levelTag(deal.level, " mid");
        const before = cur != null && deal.level != null && deal.level !== cur ? ` · antes ${deal.level}` : "";
        const loss = (deal.short - deal.long) * 100 * deal.qty - cobrado(deal);
        const now = lv?.mid != null ? cobrado(deal) - lv.mid * 100 * deal.qty : null;
        let scale = "";
        if (st.price != null) {
          const lo = deal.long * 0.97;
          const hi = Math.max(st.price, deal.short) * 1.02;
          const at = (v) => (((v - lo) / (hi - lo)) * 100).toFixed(1);
          scale = `<div class="dl-scale" role="img" aria-label="Largo ${fmtStrike(deal.long)}, corto ${fmtStrike(deal.short)}, precio ${usd2(st.price)}"><i class="z" style="left:${at(deal.long)}%;width:${(at(deal.short) - at(deal.long)).toFixed(1)}%"></i><i class="k" style="left:${at(deal.short)}%"></i><i class="p" style="left:${at(st.price)}%"></i></div>
            <div class="dl-ends small muted num"><span>largo ${fmtStrike(deal.long)}</span><span>precio ${usd2(st.price)}</span></div>`;
        }
        const box = (label, value, cls = "", note = "") => `<div class="fi-box"><span class="fi-lab">${label}</span><b class="num ${cls}">${value}</b>${note}</div>`;
        const boxes = `<div class="fi-boxes dl-boxes">
          ${box("Prob.", lv?.prob == null ? "—" : `${num(lv.prob, 1)} %`, "", deal.prob0 != null && lv?.prob != null && deal.prob0 !== lv.prob ? `<span class="xs muted">antes ${num(deal.prob0, 1)} %</span>` : "")}
          ${box("Llevas", now == null ? "—" : signedUsd(now), now == null ? "" : tone(now))}
          ${box("Pierdes máx.", dollars(loss), "down")}
        </div>`;
        return `<li class="dl-card">
          <div class="dl-top">${badge}<div class="dl-t">
            <span class="dl-n"><b class="dl-sym">${esc(deal.s)}</b> <span class="num dl-k">${fmtStrike(deal.short)}/${fmtStrike(deal.long)}</span>${deal.qty > 1 ? ` <span class="small muted">×${deal.qty}</span>` : ""}</span>
            <b class="num dl-days">${st.dte < 0 ? "venció" : `${st.dte} <small>d</small>`}</b>
            <span class="pill st-${st.state}">${LABEL[st.state]}</span>
            <span class="small muted dl-date">${esc(labelOf(deal.expiry))}${before}</span>
          </div></div>
          ${scale}${boxes}
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
      ${manual}
      ${open.length ? `${sectionHead("Abiertos", open.length)}<ul class="dl-list">${openList}</ul>` : '<p class="small muted" style="margin-top:14px">No tienes ningún deal abierto apuntado.</p>'}
      ${
        closed.length
          ? `${sectionHead("Lo que pasó, por nivel", `${closed.length} ${closed.length === 1 ? "cerrado" : "cerrados"}`)}
             <ul class="rows">${recordRows}</ul>
             <p class="xs muted" style="margin-top:8px">El nivel es el que tenía cada deal al apuntarlo. Con pocos deals no dice nada; con unos meses dirá si un nivel alto de verdad sale mejor.</p>
             ${sectionHead("Cerrados")}<ul class="rows">${closedList}</ul>`
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
      ${closed && hoy.view !== "mis" ? notice("watch", "Precios tomados con el mercado cerrado: las horquillas son más anchas y salen menos casillas.") : ""}
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
    } else if (act === "price") {
      hoy.price = value === "mid" ? "mid" : "nat";
      keep();
    } else if (act === "filters-open") {
      hoy.fOpen = !hoy.fOpen;
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
    } else if (act === "fl-ord") {
      hoy.fl.ord = ["ben", "prob", "floor", "day"].includes(value) ? value : "lv";
    } else if (act === "fl-hide") {
      hoy.fl.hide = !hoy.fl.hide;
      hoy.fl.shown = 30;
    } else if (act === "fl-more") {
      hoy.fl.shown += 30;
    } else if (act === "fl-reset") {
      hoy.fl = { lv: [0, 1, 2, 3, 4, 5], days: null, w: null, pr: null, hide: false, ord: hoy.fl.ord, shown: 30 };
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
    } else if (act === "form-manual") {
      hoy.form = "manual";
      hoy.error = "";
    } else if (act === "form-cancel") {
      hoy.form = null;
      hoy.draft = null;
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
          prob0: rows.nat.prob ?? null,
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
    } else if (form.dataset.hoyForm === "manual") {
      const symbol = String(data.get("s") ?? "").trim().toUpperCase();
      const expiry = String(data.get("expiry") ?? "");
      const short = parseNumber(data.get("short"));
      const long = parseNumber(data.get("long"));
      const credit = parseNumber(data.get("credit"));
      const qty = parseNumber(data.get("qty"));
      hoy.draft = Object.fromEntries(["s", "expiry", "short", "long", "credit", "qty"].map((k) => [k, String(data.get(k) ?? "")]));
      if (!/^[A-Z][A-Z.]{0,7}$/.test(symbol)) hoy.error = "Escribe el símbolo, por ejemplo AAPL.";
      else if (!/^\d{4}-\d{2}-\d{2}$/.test(expiry) || Number.isNaN(Date.parse(expiry))) hoy.error = "Elige la fecha de vencimiento.";
      else if (!(short > 0) || !(long > 0) || !(long < short)) hoy.error = "Escribe los dos strikes: el largo tiene que ser menor que el corto.";
      else if (!(credit > 0) || !(credit < short - long)) hoy.error = `Escribe el crédito por acción, entre 0,01 y ${num(short - long, 2)}.`;
      else if (!Number.isInteger(qty) || qty < 1 || qty > 50) hoy.error = "Escribe cuántos contratos, de 1 a 50.";
      else if (deals.length >= MAX_DEALS) hoy.error = "Hay demasiados deals apuntados. Borra alguno cerrado.";
      else {
        const sym = (state.scan?.symbols ?? []).find((item) => item.s === symbol);
        const o = options();
        const now = sym ? dealRows(sym, { expiry, short, long }, o.opts, o.today).nat : null;
        deals.push({
          id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
          s: symbol,
          b: sym?.b ?? "",
          expiry,
          short: Math.round(short * 1000) / 1000,
          long: Math.round(long * 1000) / 1000,
          credit: Math.round(credit * 1000) / 1000,
          qty,
          fee: options().opts.fee,
          openedAt: Date.now(),
          level: null,
          retExp: null,
          prob0: now?.prob ?? null,
          price0: sym?.p ?? null,
          closedAt: null,
          result: null,
          manual: true,
        });
        keepDeals();
        hoy.form = null;
        hoy.draft = null;
        hoy.error = "";
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

  /** Barra de ancho de Hoy: "hasta" ese ancho, en dólares por contrato (se guarda en puntos). */
  function setWidth(dollars) {
    if (!(dollars >= FL_W_MIN && dollars <= FL_W_MAX)) return false;
    hoy.width = dollars / 100;
    keep();
    return true;
  }

  /** Barras de ancho y de prob. de la ficha: "hasta" ese valor; el máximo de la barra no filtra. */
  function setFl(kind, value, max) {
    if (!Number.isInteger(value)) return false;
    if (kind === "w" && value >= FL_W_MIN && value <= FL_W_MAX) hoy.fl.w = value >= FL_W_MAX ? null : value;
    else if (kind === "days" && value >= 0 && value <= max) hoy.fl.days = value >= max ? null : value;
    else if (kind === "pr" && value >= FL_PR_MIN && value <= FL_PR_MAX) hoy.fl.pr = value >= FL_PR_MAX ? null : value;
    else return false;
    hoy.fl.shown = 30;
    return true;
  }

  return { view, sheet, click, submit, escape, setProb, setWidth, setFl, openName, dealRow, sortDeals, stats };
}
