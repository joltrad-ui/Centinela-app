// El Buscador: los bull puts de todas las acciones con el esquema de la ficha (filtros con barras, barra de orden y lista).
// Sustituye a Lista y a Deals. Todo lo que se elige aquí vive solo en el dispositivo (`localStorage`):
// los filtros en `centinela.buscador.v1` y las acciones marcadas como "las tengo" en `centinela.tengo.v1`.
// Quitar o poner una acción es el mismo `config.off` de siempre: la oculta en toda la app.
import { emptyBox } from "./ui.js";
import { qualityDeals, nyToday } from "./engine.js";

const LS = "centinela.buscador.v1";
const LS_TENGO = "centinela.tengo.v1";
const LS_HOY = "centinela.hoy.v1";
const LS_MISDEALS = "centinela.misdeals.v1";
const W_MIN = 100; // ancho hasta, en dólares por contrato (como "ancho $600" en las filas): de $100 a $1000; el máximo no filtra
const W_MAX = 1000;
const W_STEP = 50;
const PR_MIN = 3; // prob. hasta: de 3 a 30 %; el máximo no filtra
const PR_MAX = 30;
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

  const saved = readLocal(LS) ?? {};
  const bs = {
    q: "",
    lv: Array.isArray(saved.lv) ? saved.lv.filter((l) => Number.isInteger(l) && l >= 0 && l <= 5) : [...DEFAULT_LV],
    days: Number.isInteger(saved.days) && saved.days > 0 ? saved.days : null, // vence en N días o menos; null = todos
    blocks: Array.isArray(saved.blocks) ? saved.blocks.filter((b) => typeof b === "string").slice(0, 40) : [],
    w: Number.isInteger(saved.w) && saved.w >= W_MIN && saved.w < W_MAX && saved.w % W_STEP === 0 ? saved.w : null,
    pr: Number.isInteger(saved.pr) && saved.pr >= PR_MIN && saved.pr < PR_MAX ? saved.pr : null,
    hide: saved.hide === true, // ocultar los que están fuera de Reglas
    earn: saved.earn === true, // ocultar los que tienen resultados dentro del plazo
    trend: saved.trend === true, // ocultar los que llevan aviso de tendencia
    margin: saved.margin === true, // solo los que cumplen el punto de seguridad
    one: saved.one !== false, // uno por nombre
    tengo: saved.tengo === "hide" || saved.tengo === "only" ? saved.tengo : "all",
    ord: ORDERS.some(([id]) => id === saved.ord) ? saved.ord : "lv",
    shown: SHOW,
    namesOpen: false,
    fOpen: saved.fOpen === true, // "Más filtros": comprimidos de fábrica
    open: "", // la fila de filtros desplegada (blk, solo, hide), como "Ya tengo" de Hoy
    mark: false, // en el panel de acciones, tocar marca "la tengo" en vez de quitar o poner
  };
  const keep = () => writeLocal(LS, { lv: bs.lv, days: bs.days, blocks: bs.blocks, w: bs.w, pr: bs.pr, hide: bs.hide, earn: bs.earn, trend: bs.trend, margin: bs.margin, one: bs.one, tengo: bs.tengo, ord: bs.ord, fOpen: bs.fOpen });

  let tengoList = (Array.isArray(readLocal(LS_TENGO)) ? readLocal(LS_TENGO) : []).filter((s) => typeof s === "string").slice(0, 200);
  const keepTengo = () => writeLocal(LS_TENGO, tengoList);

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
    return { deals: cache.out.deals, price, openNames: new Set(mine.map((d) => d.s)) };
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

  function filtered(d0, skipLevel = false) {
    const q = norm(bs.q.trim());
    const tengo = tengoSet(d0.openNames);
    const days = activeDays();
    return d0.deals.filter(
      (d) =>
        matches(d.sym, q) &&
        (skipLevel || bs.lv.includes(d.level)) &&
        (!days || d.row.dte <= days) &&
        (!bs.blocks.length || bs.blocks.includes(d.sym.b ?? "")) &&
        (!bs.w || d.row.width * 100 <= bs.w + 1e-6) &&
        (!bs.pr || (d.row.prob ?? 100) <= bs.pr + 1e-9) &&
        !(bs.hide && !d.ok) &&
        !(bs.earn && d.row.earnInside && d.sym.er) &&
        !(bs.trend && (d.row.trend ?? []).length) &&
        !(bs.margin && !d.checks.safe) &&
        (bs.tengo === "all" || (bs.tengo === "hide" ? !tengo.has(d.sym.s) : tengo.has(d.sym.s))),
    );
  }

  // ---------- pintado ----------
  const chip = (act, value, label, on, extra = "") => `<button class="chip quiet" data-bs="${act}" data-v="${esc(value)}" aria-pressed="${on}"${extra}>${label}</button>`;
  const chipRow = (label, inner, cls = "") => `<div class="fi-f"><span class="fi-f-l small muted">${label}</span><div class="fi-f-c${cls}">${inner}</div></div>`;
  const slider = (id, min, max, step, value, label, text) => `<input type="range" class="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${value}" aria-label="${label}"><b class="num fi-range-v" id="${id}-val">${text(value)}</b>`;
  const bar = (act, options, current, label) => `<div class="sortbar eq" role="group" aria-label="${label}">${options.map(([id, text]) => `<button data-bs="${act}" data-v="${id}" aria-pressed="${current === id}">${text}</button>`).join("")}</div>`;

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
    return [bs.blocks.length > 0, bs.w != null, bs.pr != null, activeDays() != null, bs.hide, bs.earn, bs.trend, bs.margin, bs.tengo !== "all", bs.q.trim() !== "", JSON.stringify(bs.lv) !== JSON.stringify(DEFAULT_LV)].filter(Boolean).length;
  }

  /** Los filtros, en el orden de la pantalla Deals de antes: lo que más se toca arriba (nivel y las tres barras) y el resto plegado. */
  function filters(d0) {
    const present = new Set(d0.deals.map((d) => d.sym.b ?? ""));
    const blocks = blockOrder().filter((b) => present.has(b));
    const days = daysRange();
    const lvChips = [0, 1, 2, 3, 4, 5].map((l) => `<button class="lv lv${l} fi-lvb" data-bs="lv" data-v="${l}" aria-pressed="${bs.lv.includes(l)}" aria-label="Nivel ${l}">${l}</button>`).join("");
    const n = activeFilters();
    // Como "Ya tengo" de Hoy: plegada enseña lo marcado (o "ninguno"); al tocar se abren todas las opciones y "Listo".
    const fold = (id, label, options, note = "") => {
      const sel = options.filter((o) => o.on);
      if (bs.open !== id) {
        const shown = sel.length ? sel.map((o) => `<button class="chip quiet" data-bs="open" data-v="${id}" aria-pressed="true">${o.label}</button>`).join("") : `<button class="chip quiet" data-bs="open" data-v="${id}">${options.none ?? "ninguno"}</button>`;
        return `<div class="fi-f"><button class="small muted fi-f-l fi-f-lb" data-bs="open" data-v="${id}" aria-expanded="false">${label} ▾</button><div class="fi-f-c">${shown}</div></div>`;
      }
      return `<div class="fi-f fi-open"><button class="small muted fi-f-l fi-f-lb" data-bs="open" data-v="${id}" aria-expanded="true">${label} ▴</button><div class="fi-f-c fi-wrap">${options.map((o) => o.html).join("")}<button class="chip quiet hoy-edit" data-bs="open" data-v="${id}">Listo</button></div></div>${note ? `<p class="xs muted fi-f-note">${note}</p>` : ""}`;
    };
    const opt = (act, value, label, pressed) => ({ label, on: pressed, html: chip(act, value, label, pressed) });
    const blockOpts = [opt("blk", "", "Todos", !bs.blocks.length), ...blocks.map((b) => opt("blk", b, esc(b), bs.blocks.includes(b)))];
    blockOpts.none = "todos";
    blockOpts[0].on = false;
    const soloOpts = [opt("margin", "", "Con margen", bs.margin), opt("tengo-only", "", "Las que tengo", bs.tengo === "only")];
    const hideOpts = [opt("earn", "", "Resultados", bs.earn), opt("trend", "", "Tendencia", bs.trend), opt("hide", "", "Fuera de Reglas", bs.hide), opt("tengo-hide", "", "Las que tengo", bs.tengo === "hide")];
    const rest = `${blocks.length > 1 ? fold("blk", "Bloque", blockOpts) : ""}
        ${fold("solo", "Solo", soloOpts)}
        ${fold("hide", "Ocultar", hideOpts)}
        ${chipRow("Precio", `<button class="chip quiet" data-hoy="price" data-v="nat" aria-pressed="${d0.price === "nat"}">Bid/Ask</button><button class="chip quiet" data-hoy="price" data-v="mid" aria-pressed="${d0.price === "mid"}">Mid</button>`)}`;
    const head = `<div class="fhead"><button class="fhead-b" data-bs="filters-open" aria-expanded="${bs.fOpen}">${bs.fOpen ? "Menos filtros ▴" : "Más filtros ▾"}</button><span class="small">· ${n ? `${n} ${n === 1 ? "activo" : "activos"}` : "ninguno activo"}</span></div>`;
    return `<div class="fi-filters">
        ${chipRow("Nivel", lvChips)}
        ${chipRow("Vence hasta", slider("bs-days-range", days.min, days.max, 1, activeDays() ?? days.max, "Vence en estos días o menos", (v) => `${v} d`), " sl")}
        ${chipRow("Ancho hasta", slider("bs-w-range", W_MIN, W_MAX, W_STEP, bs.w ?? W_MAX, "Ancho máximo del spread, en dólares por contrato", (v) => `$${v}`), " sl")}
        ${chipRow("Prob. hasta", slider("bs-pr-range", PR_MIN, PR_MAX, 1, bs.pr ?? PR_MAX, "Prob. de asignación máxima", (v) => `${v} %`), " sl")}
        ${head}
        ${bs.fOpen ? rest : ""}
        ${bs.fOpen && n ? `<div class="bs-more"><button class="btn quiet" data-bs="reset">Quitar filtros</button></div>` : ""}
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
    const shown = rows.slice(0, bs.shown);
    if (!rows.length) return emptyBox("Ningún deal con estos filtros.", "", { attrs: 'data-bs="reset"', label: "Quitar filtros" });
    const more = rows.length > shown.length ? `<button class="btn quiet fi-more" data-bs="more-rows">Ver más (${rows.length - shown.length})</button>` : "";
    return `<ul class="fi-dlist">${shown.map((d) => hoy.dealRow(d, { withName: true, note: variants.get(d.sym.s) ? `+${variants.get(d.sym.s)} más de ${esc(d.sym.s)}` : "" })).join("")}</ul>${more}`;
  }

  /** La barra de encima de la lista: "Uno por nombre" y cuántos hay. Se repinta al escribir en la caja. */
  function countHtml(d0) {
    const list = filtered(d0);
    const names = new Set(list.map((d) => d.sym.s)).size;
    const count = bs.one ? `${names} ${names === 1 ? "nombre" : "nombres"} · ${list.length} ${list.length === 1 ? "deal" : "deals"}` : `${list.length} ${list.length === 1 ? "deal" : "deals"}`;
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
    else if (act === "tengo-only") bs.tengo = bs.tengo === "only" ? "all" : "only";
    else if (act === "tengo-hide") bs.tengo = bs.tengo === "hide" ? "all" : "hide";
    else if (act === "hide") bs.hide = !bs.hide;
    else if (act === "earn") bs.earn = !bs.earn;
    else if (act === "trend") bs.trend = !bs.trend;
    else if (act === "margin") bs.margin = !bs.margin;
    else if (act === "one") bs.one = !bs.one;
    else if (act === "ord") bs.ord = ORDERS.some(([id]) => id === value) ? value : "lv";
    else if (act === "more-rows") {
      bs.shown += SHOW;
      return true;
    } else if (act === "reset") {
      Object.assign(bs, { q: "", lv: [...DEFAULT_LV], days: null, blocks: [], w: null, pr: null, hide: false, earn: false, trend: false, margin: false, tengo: "all" });
    } else touched = false;
    if (touched && act !== "names" && act !== "open" && act !== "filters-open" && act !== "mode" && act !== "name" && act !== "all-on" && act !== "all-off" && act !== "clear-tengo") {
      bs.shown = SHOW;
      keep();
    }
    return touched;
  }

  return { view, click, setQuery, setRange };
}
