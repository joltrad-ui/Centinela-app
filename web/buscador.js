// El Buscador: los bull puts de todas las acciones con el esquema de la ficha (filtros con barras, barra de orden y lista).
// Sustituye a Lista y a Deals. Todo lo que se elige aquí vive solo en el dispositivo (`localStorage`):
// los filtros en `centinela.buscador.v1` y las acciones marcadas como "las tengo" en `centinela.tengo.v1`.
// Quitar o poner una acción es el mismo `config.off` de siempre: la oculta en toda la app.
import { emptyBox } from "./ui.js";
import { PR, W, choiceRow, filterBars, foldRow, moreHead, morePanel } from "./filtros.js";
import { TWINS, qualityDeals, nyToday, volatilities } from "./engine.js";

const LS = "centinela.buscador.v1";
const LS_TENGO = "centinela.tengo.v1";
const VOL_HIGH = 1.2; // IV alta: la IV a 30 días es al menos 1,2 veces la volatilidad realizada reciente
const VOL_LOW = 0.8; // IV baja: como mucho 0,8 veces
const LS_PRESETS = "centinela.buscador.guardados.v1";
const LS_HOY = "centinela.hoy.v1";
const LS_MISDEALS = "centinela.misdeals.v1";
const W_MIN = W.min;
const W_MAX = W.max;
const W_STEP = W.step;
const PR_MIN = PR.min;
const PR_MAX = PR.max;
const SHOW = 40;
const ORDERS = [
  ["lv", "Nivel"],
  ["ben", "Beneficio"],
  ["prob", "Prob."],
  ["floor", "Suelo"],
  ["day", "Por día"],
];
const DEFAULT_LV = [3, 4, 5];
const norm = (text) => String(text ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function createBuscador(ctx) {
  const { state, root, listSymbols, allSymbols, blockOrder, readLocal, writeLocal, esc, header, foot, hoy, changeConfig } = ctx;

  /** Los filtros que se guardan y se comparten con las combinaciones guardadas, saneados. */
  const cleanFilters = (f = {}) => ({
    lv: Array.isArray(f.lv) ? f.lv.filter((l) => Number.isInteger(l) && l >= 0 && l <= 5) : [...DEFAULT_LV],
    days: Number.isInteger(f.days) && f.days > 0 ? f.days : null, // vence en N días o menos; null = todos
    blocks: Array.isArray(f.blocks) ? f.blocks.filter((b) => typeof b === "string").slice(0, 40) : [],
    w: Number.isInteger(f.w) && f.w >= W_MIN && f.w < W_MAX && f.w % W_STEP === 0 ? f.w : null,
    pr: Number.isInteger(f.pr) && f.pr >= PR_MIN && f.pr < PR_MAX ? f.pr : null,
    hide: f.hide === true, // ocultar los que están fuera de Reglas
    earn: f.earn === true, // ocultar los que tienen resultados dentro del plazo
    trend: f.trend === true, // ocultar los que llevan aviso de tendencia
    margin: f.margin === true || f.margin === "yes" ? "yes" : f.margin === "no" ? "no" : "all", // punto de seguridad: todos, solo con margen o solo sin margen (antes era un booleano)
    tengo: f.tengo === "hide" || f.tengo === "only" ? f.tengo : "all",
    vol: f.vol === "high" || f.vol === "low" ? f.vol : "all", // IV frente a la volatilidad realizada: todas, IV alta o IV baja
  });
  const FILTER_KEYS = ["lv", "days", "blocks", "w", "pr", "hide", "earn", "trend", "margin", "tengo", "vol"];

  const saved = readLocal(LS) ?? {};
  const bs = {
    q: "",
    ...cleanFilters(saved),
    one: saved.one !== false, // uno por nombre
    tengo: saved.tengo === "hide" || saved.tengo === "only" ? saved.tengo : "all",
    ord: ORDERS.some(([id]) => id === saved.ord) ? saved.ord : "lv",
    shown: SHOW,
    namesOpen: false,
    fOpen: saved.fOpen === true, // "Más filtros": comprimidos de fábrica
    open: "", // la fila de filtros desplegada (blk, hide, guardados), como "Ya tengo" de Hoy
    help: false, // la explicación de los filtros abierta; solo en memoria
    mark: false, // en el panel de acciones, tocar marca "la tengo" en vez de quitar o poner
  };
  const keep = () => writeLocal(LS, { lv: bs.lv, days: bs.days, blocks: bs.blocks, w: bs.w, pr: bs.pr, hide: bs.hide, earn: bs.earn, trend: bs.trend, margin: bs.margin, one: bs.one, tengo: bs.tengo, ord: bs.ord, fOpen: bs.fOpen });

  let tengoList = (Array.isArray(readLocal(LS_TENGO)) ? readLocal(LS_TENGO) : []).filter((s) => typeof s === "string").slice(0, 200);
  const keepTengo = () => writeLocal(LS_TENGO, tengoList);

  // Combinaciones de filtros con nombre (solo en este dispositivo, como todo lo del dueño).
  const MAX_PRESETS = 8;
  let presets = (Array.isArray(readLocal(LS_PRESETS)) ? readLocal(LS_PRESETS) : [])
    .filter((p) => p && typeof p.n === "string" && p.n.trim())
    .slice(0, MAX_PRESETS)
    .map((p) => ({ n: p.n.trim().slice(0, 20), f: cleanFilters(p.f) }));
  const keepPresets = () => writeLocal(LS_PRESETS, presets);
  const snapshot = () => Object.fromEntries(FILTER_KEYS.map((k) => [k, structuredClone(bs[k])]));
  const sameFilters = (f) => JSON.stringify(cleanFilters(f)) === JSON.stringify(cleanFilters(snapshot()));

  // ---------- datos: se calculan una vez por barrido, reglas, precio y acciones ----------
  let cache = { key: "", out: null };
  function data() {
    const rules = state.config.rules;
    const hoyLs = readLocal(LS_HOY) ?? {};
    const price = hoyLs.price === "mid" ? "mid" : "nat";
    const mine = (readLocal(LS_MISDEALS) ?? []).filter((d) => d && typeof d.s === "string" && !d.closedAt);
    const held = [...new Set([...(Array.isArray(hoyLs.held) ? hoyLs.held.filter((b) => typeof b === "string") : []), ...mine.map((d) => d.b).filter(Boolean)])];
    const today = nyToday();
    const symbols = listSymbols();
    const key = JSON.stringify([state.scan?.at, state.hist?.at, rules, price, held, today, symbols.map((sym) => sym.s)]);
    if (cache.key !== key) {
      const out = qualityDeals(
        symbols,
        { rules, fee: rules.equalFee, gapPct: rules.equalGapPct, safety: rules.levelSafety, marginK: rules.levelMargin, errVolPct: rules.errVolPct, errHistK: rules.errHistK, hist: state.hist?.symbols ?? null, held, price, maxProb: PR_MAX, maxWidth: 10 },
        today,
      );
      cache = { key, out };
    }
    if (!cache.volRatio || cache.volKey !== key) {
      // IV a 30 días frente a la volatilidad realizada reciente (la mayor de 20 y 60 sesiones): por encima de 1, el mercado pide más de lo que se ha movido.
      const ratios = new Map();
      for (const sym of symbols) {
        const recent = volatilities(state.hist?.symbols?.[sym.s]?.c)?.recentPct;
        if (sym.iv30 > 0 && recent > 0) ratios.set(sym.s, sym.iv30 / recent);
      }
      cache.volRatio = ratios;
      cache.volKey = key;
    }
    return { deals: cache.out.deals, price, volRatio: cache.volRatio, openNames: new Set(mine.map((d) => d.s)) };
  }

  /** Las acciones que "tengo": las que tienen un deal abierto en Mis deals y las marcadas a mano. */
  const tengoSet = (openNames) => new Set([...tengoList, ...openNames]);

  function matches(sym, q) {
    if (!q) return true;
    const hay = norm(`${sym.s} ${sym.n ?? ""} ${sym.b ?? ""}`);
    return q.split(/\s+/).every((word) => hay.includes(word));
  }

  /** Los días máximos de la barra "Vence hasta": los de las Reglas. */
  const daysRange = () => {
    const rules = state.config.rules;
    return { min: rules.minDte, max: Math.max(rules.minDte + 1, rules.maxDte) };
  };
  const activeDays = () => (bs.days != null && bs.days >= daysRange().min && bs.days < daysRange().max ? bs.days : null);

  /** Los filtros puestos, cada uno con su prueba. `drop` lo quita (lo usa "Ningún deal con estos filtros" para sugerir qué quitar). */
  const ALL_LV = [0, 1, 2, 3, 4, 5];
  function criteria(d0) {
    const q = norm(bs.q.trim());
    const tengo = tengoSet(d0.openNames);
    const days = activeDays();
    return [
      { key: "q", on: q !== "", label: "la búsqueda", test: (d) => matches(d.sym, q), drop: () => (bs.q = "") },
      { key: "lv", on: bs.lv.length < ALL_LV.length, label: "el filtro de Nivel", test: (d) => bs.lv.includes(d.level), drop: () => (bs.lv = [...ALL_LV]) },
      { key: "days", on: Boolean(days), label: `Vence hasta ${days} d`, test: (d) => d.row.dte <= days, drop: () => (bs.days = null) },
      { key: "blk", on: bs.blocks.length > 0, label: "el filtro de Bloque", test: (d) => bs.blocks.includes(d.sym.b ?? ""), drop: () => (bs.blocks = []) },
      { key: "w", on: Boolean(bs.w), label: `Ancho hasta $${bs.w}`, test: (d) => d.row.width * 100 <= bs.w + 1e-6, drop: () => (bs.w = null) },
      { key: "pr", on: Boolean(bs.pr), label: `Prob. hasta ${bs.pr} %`, test: (d) => (d.row.prob ?? 100) <= bs.pr + 1e-9, drop: () => (bs.pr = null) },
      { key: "hide", on: bs.hide, label: "Ocultar fuera de Reglas", test: (d) => d.ok, drop: () => (bs.hide = false) },
      { key: "earn", on: bs.earn, label: "Ocultar resultados", test: (d) => !(d.row.earnInside && d.sym.er), drop: () => (bs.earn = false) },
      { key: "trend", on: bs.trend, label: "Ocultar tendencia", test: (d) => !(d.row.trend ?? []).length, drop: () => (bs.trend = false) },
      { key: "margin", on: bs.margin !== "all", label: "el filtro de Margen", test: (d) => (bs.margin === "yes") === Boolean(d.checks.safe), drop: () => (bs.margin = "all") },
      { key: "vol", on: bs.vol !== "all", label: "el filtro de Volatilidad", test: (d) => { const r = d0.volRatio.get(d.sym.s); return r != null && (bs.vol === "high" ? r >= VOL_HIGH : r <= VOL_LOW); }, drop: () => (bs.vol = "all") },
      { key: "tengo", on: bs.tengo !== "all", label: "Las que tengo", test: (d) => (bs.tengo === "hide" ? !tengo.has(d.sym.s) : tengo.has(d.sym.s)), drop: () => (bs.tengo = "all") },
    ].filter((c) => c.on);
  }

  function filtered(d0, skipLevel = false, skipKey = null) {
    const tests = criteria(d0).filter((c) => !(skipLevel && c.key === "lv") && c.key !== skipKey);
    return d0.deals.filter((d) => tests.every((c) => c.test(d)));
  }

  /** Para cuando no sale nada: cuántos deals saldrían quitando cada filtro por separado, de más a menos. */
  function blockers(d0) {
    return criteria(d0)
      .map((c) => ({ key: c.key, label: c.label, count: filtered(d0, false, c.key).length }))
      .filter((c) => c.count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, 3);
  }

  // ---------- pintado ----------
  const chip = (act, value, label, on, extra = "") => `<button class="chip quiet" data-bs="${act}" data-v="${esc(value)}" aria-pressed="${on}"${extra}>${label}</button>`;
  const bar = (act, options, current, label) => `<div class="sortbar eq" role="group" aria-label="${label}">${options.map(([id, text]) => `<button data-bs="${act}" data-v="${id}" aria-pressed="${current === id}">${text}</button>`).join("")}</div>`;

  const HELP = [
    ["Nivel", "0 = la rentab. esperada no es positiva. Si lo es, parte de 1 y suma un punto por cada comprobación: margen (lo que queda supera el error del cálculo), costes razonables (ida y vuelta hasta el 40 % de lo cobrado) y bloque nuevo (no tienes ya uno abierto de ese bloque). El 5 exige además el doble de margen."],
    ["Margen", "Con = lo que queda tras restar lo que se espera pagar supera el error del cálculo (1 vez de fábrica; se cambia en Reglas, pestaña Hoy). Sin = no lo supera. Puede salir bien igualmente, pero su beneficio esperado es menor que la incertidumbre de la cuenta."],
    ["Volatilidad", "IV alta = la volatilidad implícita a 30 días es al menos 1,2 veces lo que el valor se ha movido de verdad (la realizada reciente, de 20 a 60 sesiones): las opciones están caras frente a su movimiento. IV baja = como mucho 0,8 veces. Sin cierres guardados, el valor no tiene dato y no sale en ninguna."],
    ["Las que tengo", "Acciones con un deal abierto en Mis deals, más las que marques a mano en Acciones, Marcar las que tengo. Ocultar las quita de la lista; Solo deja únicamente esas. Se guardan solo en este dispositivo."],
  ];
  const helpPanel = () => (bs.help ? `<div class="fi-help-panel">${HELP.map(([name, text]) => `<p class="xs muted"><b>${name}</b> ${text}</p>`).join("")}</div>` : "");

  function namesPanel(d0) {
    const all = allSymbols();
    const off = state.config.off ?? [];
    const tengo = tengoSet(d0.openNames);
    const open = bs.namesOpen;
    const head = `<button class="chip quiet bs-names-b" data-bs="names" aria-expanded="${open}">Acciones · ${all.length - all.filter((s) => off.includes(s.s)).length} de ${all.length} ${open ? "▴" : "▾"}</button>`;
    if (!open) return `<div class="bs-names">${head}</div>`;
    const blocks = [...blockOrder(), ""].filter((b, i, list) => list.indexOf(b) === i);
    const groups = blocks
      .map((block) => {
        const names = all.filter((s) => (s.b ?? "") === block);
        if (!names.length) return "";
        return `<div class="bs-block"><p class="xs muted">${esc(block || "Sin bloque")}</p><div class="bs-chips">${names
          .map((s) => {
            const mine = tengo.has(s.s);
            const on = bs.mark ? tengoList.includes(s.s) : !off.includes(s.s);
            return `<button class="chip quiet bs-name${mine ? " mine" : ""}${off.includes(s.s) ? " gone" : ""}" data-bs="name" data-v="${esc(s.s)}" aria-pressed="${on}" title="${esc(s.n ?? s.s)}">${esc(s.s)}</button>`;
          })
          .join("")}</div></div>`;
      })
      .join("");
    const actions = bs.mark
      ? `<button class="btn quiet" data-bs="clear-tengo">Quitar mis marcas</button>`
      : `<button class="btn quiet" data-bs="all-on">Todas</button><button class="btn quiet" data-bs="all-off">Ninguna</button>`;
    return `<div class="bs-names">${head}
      <div class="bs-panel">
        ${bar("mode", [["off", "Quitar o poner"], ["tengo", "Marcar las que tengo"]], bs.mark ? "tengo" : "off", "Qué hace tocar una acción")}
        <p class="xs muted">${bs.mark ? "Toca para marcar o desmarcar las que tienes. El punto ● marca las que ya tienes (también las que tienen un deal abierto en Mis deals). Se queda solo en este dispositivo." : "Toca para quitar o poner una acción. Una acción quitada desaparece de toda la app."}</p>
        <div class="bs-actions">${actions}</div>
        ${groups}
      </div>
    </div>`;
  }

  /** Cuántos filtros hay puestos (el nivel de fábrica no cuenta). */
  function activeFilters() {
    return [bs.blocks.length > 0, bs.w != null, bs.pr != null, activeDays() != null, bs.hide, bs.earn, bs.trend, bs.margin !== "all", bs.vol !== "all", bs.tengo !== "all", bs.q.trim() !== "", JSON.stringify(bs.lv) !== JSON.stringify(DEFAULT_LV)].filter(Boolean).length;
  }

  /** Los filtros, en el orden de la pantalla Deals de antes: lo que más se toca arriba (nivel y las tres barras) y el resto plegado. */
  function filters(d0) {
    const present = new Set(d0.deals.map((d) => d.sym.b ?? ""));
    const blocks = blockOrder().filter((b) => present.has(b));
    const days = daysRange();
    const n = activeFilters();
    // Como "Ya tengo" de Hoy: plegada enseña lo marcado (o "ninguno"); al tocar se abren todas las opciones y "Listo".
    // Plegable con el mismo aspecto que las demás filas (`foldRow`): enseña lo marcado, o "ninguno".
    const fold = (id, label, options, note = "") =>
      foldRow(label, `data-bs="open" data-v="${id}"`, bs.open === id, options.filter((o) => o.on).map((o) => o.label).join(" · "), options.map((o) => o.html).join(""), { none: options.none ?? "ninguno", note });
    const opt = (act, value, label, pressed) => ({ label, on: pressed, html: chip(act, value, label, pressed) });
    const blockOpts = [opt("blk", "", "Todos", !bs.blocks.length), ...blocks.map((b) => opt("blk", b, esc(b), bs.blocks.includes(b)))];
    blockOpts.none = "todos";
    blockOpts[0].on = false;
    const hideOpts = [opt("earn", "", "Resultados", bs.earn), opt("trend", "", "Tendencia", bs.trend), opt("hide", "", "Fuera de Reglas", bs.hide)];
    const presetOpts = presets.map((p, i) => ({ label: esc(p.n), on: sameFilters(p.f), html: `<span class="bs-preset">${chip("preset", i, esc(p.n), sameFilters(p.f))}<button class="chip quiet bs-preset-x" data-bs="preset-del" data-v="${i}" aria-label="Borrar ${esc(p.n)}">×</button></span>` }));
    if (presets.length < MAX_PRESETS) presetOpts.push({ label: "", on: false, html: `<form class="bs-save" data-bs-form="preset"><input name="n" maxlength="20" placeholder="Nombre" aria-label="Nombre de la combinación" autocomplete="off"><button class="chip quiet" type="submit">Guardar estos filtros</button></form>` });
    const presetRow = fold("preset", "Guardados", presetOpts);
    const rest = morePanel(`${presetRow}
        ${blocks.length > 1 ? fold("blk", "Bloque", blockOpts) : ""}
        ${choiceRow("Margen", 'data-bs="margin"', [["all", "Todos"], ["yes", "Con"], ["no", "Sin"]], bs.margin)}
        ${choiceRow("Volatilidad", 'data-bs="vol"', [["all", "Todas"], ["high", "IV alta"], ["low", "IV baja"]], bs.vol)}
        ${choiceRow("Las que tengo", 'data-bs="tengo"', [["all", "Todas"], ["hide", "Ocultar"], ["only", "Solo"]], bs.tengo)}
        ${choiceRow("Precio", 'data-hoy="price"', [["nat", "Bid/Ask"], ["mid", "Mid"]], d0.price)}
        ${fold("hide", "Ocultar", hideOpts)}`);
    const head = moreHead('data-bs="filters-open"', bs.fOpen, n, { help: { attr: 'data-bs="help"', open: bs.help }, reset: 'data-bs="reset"' });
    return `<div class="fi-filters">
        ${filterBars({ prefix: "bs", lv: { attr: 'data-bs="lv"', selected: bs.lv }, days: { min: days.min, max: days.max, value: activeDays() }, w: bs.w ?? W_MAX, pr: bs.pr ?? PR_MAX })}
        ${head}
        ${helpPanel()}
        ${bs.fOpen ? rest : ""}
      </div>`;
  }

  /** "Nivel 5: 2 · Nivel 4: 0 · Nivel 3: 9 · Con margen: 9", como en Hoy: cuántos hay de cada nivel con los demás filtros puestos. */
  function levelSummary(d0) {
    const pool = filtered(d0, true);
    const by = (l) => pool.filter((d) => d.level === l).length;
    return hoy.stats([["Nivel 5", by(5)], ["Nivel 4", by(4)], ["Nivel 3", by(3)], ["Margen", pool.filter((d) => d.checks.safe).length]], "Deals por nivel");
  }

  function listHtml(d0) {
    const list = hoy.sortDeals(filtered(d0), bs.ord);
    let rows = list;
    const variants = new Map();
    if (bs.one) {
      const seen = new Set();
      rows = [];
      for (const d of list) {
        if (seen.has(d.sym.s)) {
          variants.set(d.sym.s, (variants.get(d.sym.s) ?? 0) + 1);
          continue;
        }
        seen.add(d.sym.s);
        rows.push(d);
      }
    }
    // SPY y XSP son la misma apuesta: el que sale antes con el orden de ahora es el candidato; el otro, "mismo bloque".
    const lead = list.find((d) => TWINS[d.sym.s])?.sym.s;
    const twinNote = (d) => (lead && TWINS[lead] === d.sym.s ? `mismo bloque que ${lead}` : "");
    const shown = rows.slice(0, bs.shown);
    if (!rows.length) {
      const ideas = blockers(d0).map((c) => ({ attrs: `data-bs="drop" data-v="${c.key}"`, label: `Quitar ${esc(c.label)} · saldrían ${c.count}` }));
      return emptyBox("Ningún deal con estos filtros.", ideas.length ? "Esto es lo que saldría quitando cada filtro por separado:" : "", [...ideas, { attrs: 'data-bs="reset"', label: "Quitar todos los filtros" }]);
    }
    const more = rows.length > shown.length ? `<button class="btn quiet fi-more" data-bs="more-rows">Ver más (${rows.length - shown.length})</button>` : "";
    return `<ul class="fi-dlist">${shown.map((d) => hoy.dealRow(d, { withName: true, note: [twinNote(d), variants.get(d.sym.s) ? `+${variants.get(d.sym.s)} más de ${esc(d.sym.s)}` : ""].filter(Boolean).join(" · ") })).join("")}</ul>${more}`;
  }

  /** La barra de encima de la lista: "Uno por nombre" y cuántos hay. Se repinta al escribir en la caja. */
  function countHtml(d0) {
    const list = filtered(d0);
    const names = new Set(list.map((d) => d.sym.s)).size;
    const total = d0.deals.length;
    const deals = `${list.length} de ${total} ${total === 1 ? "deal" : "deals"}`;
    const count = bs.one ? `${names} ${names === 1 ? "nombre" : "nombres"} · ${deals}` : deals;
    return `<span class="small muted num">${count}</span>${chip("one", "", "Uno por nombre", bs.one)}`;
  }

  function view() {
    if (!state.scan?.symbols?.length) return `<div class="bs">${header("Buscador", false)}${emptyBox("Esperando el primer barrido de la lista.", "Sale cada media hora en horario de mercado.")}</div>`;
    const d0 = data();
    return `<div class="bs">
      ${header("Buscador", false)}
      <div class="bs-search"><input id="bs-q" class="bs-q" type="search" placeholder="Buscar acción: COST, Costco, energía…" value="${esc(bs.q)}" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Buscar acción"></div>
      ${namesPanel(d0)}
      ${filters(d0)}
      <div id="bs-sum">${levelSummary(d0)}</div>
      <div class="bs-bar" id="bs-bar">${countHtml(d0)}</div>
      <div class="fi-sort sortbar eq" role="group" aria-label="Orden">${ORDERS.map(([id, label]) => `<button data-bs="ord" data-v="${id}" aria-pressed="${bs.ord === id}">${label}</button>`).join("")}</div>
      <div id="bs-list">${listHtml(d0)}</div>
      ${foot()}
    </div>`;
  }

  // ---------- eventos ----------
  /** Al escribir en la caja solo se repinta la lista: el cursor y el teclado no se tocan. */
  function setQuery(value) {
    bs.q = String(value ?? "").slice(0, 60);
    bs.shown = SHOW;
    if (state.tab !== "buscador") return;
    const d0 = data();
    for (const [id, html] of [["#bs-sum", levelSummary(d0)], ["#bs-bar", countHtml(d0)], ["#bs-list", listHtml(d0)]]) {
      const box = root.querySelector(id);
      if (box) box.innerHTML = html;
    }
  }

  /** Las tres barras: "hasta" ese valor; el máximo de la barra no filtra. */
  function setRange(kind, value) {
    if (!Number.isInteger(value)) return false;
    const days = daysRange();
    if (kind === "w" && value >= W_MIN && value <= W_MAX) bs.w = value >= W_MAX ? null : value;
    else if (kind === "pr" && value >= PR_MIN && value <= PR_MAX) bs.pr = value >= PR_MAX ? null : value;
    else if (kind === "days" && value >= days.min && value <= days.max) bs.days = value >= days.max ? null : value;
    else return false;
    bs.shown = SHOW;
    keep();
    return true;
  }

  const toggleIn = (list, value) => (list.includes(value) ? list.filter((x) => x !== value) : [...list, value]);

  /** Devuelve true si hay que repintar. */
  function click(el) {
    const act = el.dataset.bs;
    const value = el.dataset.v ?? "";
    let touched = true;
    if (act === "names") bs.namesOpen = !bs.namesOpen;
    else if (act === "mode") bs.mark = value === "tengo";
    else if (act === "name") {
      if (bs.mark) {
        tengoList = toggleIn(tengoList, value);
        keepTengo();
      } else {
        changeConfig((config) => {
          config.off = toggleIn(config.off ?? [], value);
        });
      }
    } else if (act === "all-on") changeConfig((config) => void (config.off = []));
    else if (act === "all-off") changeConfig((config) => void (config.off = allSymbols().map((s) => s.s)));
    else if (act === "clear-tengo") {
      tengoList = [];
      keepTengo();
    } else if (act === "lv") {
      const l = Number(value);
      if (Number.isInteger(l) && l >= 0 && l <= 5) bs.lv = toggleIn(bs.lv, l).sort();
    } else if (act === "blk") bs.blocks = value ? toggleIn(bs.blocks, value) : [];
    else if (act === "filters-open") {
      bs.fOpen = !bs.fOpen;
      keep();
    }
    else if (act === "open") bs.open = bs.open === value ? "" : value;
    else if (act === "help") bs.help = !bs.help;
    else if (act === "preset") {
      const p = presets[Number(value)];
      if (p) Object.assign(bs, cleanFilters(p.f));
    } else if (act === "preset-del") {
      presets = presets.filter((_, i) => i !== Number(value));
      keepPresets();
    }
    else if (act === "tengo") bs.tengo = ["all", "hide", "only"].includes(value) ? value : "all";
    else if (act === "hide") bs.hide = !bs.hide;
    else if (act === "earn") bs.earn = !bs.earn;
    else if (act === "trend") bs.trend = !bs.trend;
    else if (act === "vol") bs.vol = ["all", "high", "low"].includes(value) ? value : "all";
    else if (act === "margin") bs.margin = ["all", "yes", "no"].includes(value) ? value : "all";
    else if (act === "one") bs.one = !bs.one;
    else if (act === "ord") bs.ord = ORDERS.some(([id]) => id === value) ? value : "lv";
    else if (act === "more-rows") {
      bs.shown += SHOW;
      return true;
    } else if (act === "drop") {
      criteria(data()).find((c) => c.key === value)?.drop();
    } else if (act === "reset") {
      Object.assign(bs, { q: "", lv: [...DEFAULT_LV], days: null, blocks: [], w: null, pr: null, hide: false, earn: false, trend: false, margin: "all", vol: "all", tengo: "all" });
    } else touched = false;
    if (touched && act !== "names" && act !== "open" && act !== "help" && act !== "preset-del" && act !== "filters-open" && act !== "mode" && act !== "name" && act !== "all-on" && act !== "all-off" && act !== "clear-tengo") {
      bs.shown = SHOW;
      keep();
    }
    return touched;
  }

  /** Guardar la combinación de filtros de ahora con un nombre. Devuelve true si hay que repintar. */
  function submit(form) {
    if (!form.matches("[data-bs-form]")) return false;
    const name = String(new FormData(form).get("n") ?? "").trim().slice(0, 20);
    if (!name || presets.length >= MAX_PRESETS) return true;
    const entry = { n: name, f: snapshot() };
    const at = presets.findIndex((p) => p.n.toLowerCase() === name.toLowerCase());
    if (at >= 0) presets[at] = entry;
    else presets.push(entry);
    keepPresets();
    return true;
  }

  /** Calcula los deals de antemano (en un rato libre), para que al abrir el Buscador por primera vez ya estén. */
  function warm() {
    if (state.scan?.symbols?.length) data();
  }

  return { view, click, submit, setQuery, setRange, warm };
}
