// El Buscador: los bull puts de todas las acciones con el esquema de la ficha (filtros con barras, barra de orden y lista).
// Sustituye a Lista y a Deals. Todo lo que se elige aquí vive solo en el dispositivo (`localStorage`):
// los filtros en `centinela.buscador.v1` y las acciones marcadas como "las tengo" en `centinela.tengo.v1`.
// Quitar o poner una acción es el mismo `config.off` de siempre: la oculta en toda la app.
import { qualityDeals, nyToday, labelOf } from "./engine.js";

const LS = "centinela.buscador.v1";
const LS_TENGO = "centinela.tengo.v1";
const LS_HOY = "centinela.hoy.v1";
const LS_MISDEALS = "centinela.misdeals.v1";
const W_MIN = 1; // ancho hasta: de $1 a $10; el máximo no filtra
const W_MAX = 10;
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
const TENGO = [
  ["all", "Todas"],
  ["hide", "Ocultar"],
  ["only", "Solo"],
];
const DEFAULT_LV = [3, 4, 5];
const norm = (text) => String(text ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function createBuscador(ctx) {
  const { state, root, listSymbols, allSymbols, blockOrder, readLocal, writeLocal, esc, header, foot, hoy, changeConfig } = ctx;

  const saved = readLocal(LS) ?? {};
  const bs = {
    q: "",
    lv: Array.isArray(saved.lv) ? saved.lv.filter((l) => Number.isInteger(l) && l >= 0 && l <= 5) : [...DEFAULT_LV],
    exp: typeof saved.exp === "string" ? saved.exp : null,
    blocks: Array.isArray(saved.blocks) ? saved.blocks.filter((b) => typeof b === "string").slice(0, 40) : [],
    w: Number.isInteger(saved.w) && saved.w >= W_MIN && saved.w < W_MAX ? saved.w : null,
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
    mark: false, // en el panel de acciones, tocar marca "la tengo" en vez de quitar o poner
  };
  const keep = () => writeLocal(LS, { lv: bs.lv, exp: bs.exp, blocks: bs.blocks, w: bs.w, pr: bs.pr, hide: bs.hide, earn: bs.earn, trend: bs.trend, margin: bs.margin, one: bs.one, tengo: bs.tengo, ord: bs.ord });

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

  function filtered(d0) {
    const q = norm(bs.q.trim());
    const tengo = tengoSet(d0.openNames);
    const exps = [...new Set(d0.deals.map((d) => d.row.expiry))];
    const exp = exps.includes(bs.exp) ? bs.exp : null;
    return d0.deals.filter(
      (d) =>
        matches(d.sym, q) &&
        bs.lv.includes(d.level) &&
        (!exp || d.row.expiry === exp) &&
        (!bs.blocks.length || bs.blocks.includes(d.sym.b ?? "")) &&
        (!bs.w || d.row.width <= bs.w + 1e-6) &&
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
  const slider = (id, min, max, value, label, text) => `<input type="range" class="range" id="${id}" min="${min}" max="${max}" step="1" value="${value}" aria-label="${label}"><b class="num fi-range-v" id="${id}-val">${text(value)}</b>`;
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

  function filters(d0) {
    const exps = [...new Set(d0.deals.map((d) => d.row.expiry))].sort();
    const exp = exps.includes(bs.exp) ? bs.exp : null;
    const present = new Set(d0.deals.map((d) => d.sym.b ?? ""));
    const blocks = blockOrder().filter((b) => present.has(b));
    const lvChips = [0, 1, 2, 3, 4, 5].map((l) => `<button class="lv lv${l} fi-lvb" data-bs="lv" data-v="${l}" aria-pressed="${bs.lv.includes(l)}" aria-label="Nivel ${l}">${l}</button>`).join("");
    return `<div class="fi-filters">
        ${chipRow("Nivel", lvChips)}
        ${blocks.length > 1 ? chipRow("Bloque", chip("blk", "", "Todos", !bs.blocks.length) + blocks.map((b) => chip("blk", b, esc(b), bs.blocks.includes(b))).join("")) : ""}
        ${exps.length > 1 ? chipRow("Vence", chip("exp", "", "Todos", !exp) + exps.map((e) => chip("exp", e, esc(labelOf(e)), exp === e)).join("")) : ""}
        ${chipRow("Ancho hasta", slider("bs-w-range", W_MIN, W_MAX, bs.w ?? W_MAX, "Ancho máximo", (v) => `$${v}`), " sl")}
        ${chipRow("Prob. hasta", slider("bs-pr-range", PR_MIN, PR_MAX, bs.pr ?? PR_MAX, "Prob. de asignación máxima", (v) => `${v} %`), " sl")}
        ${chipRow("Las que tengo", bar("tengo", TENGO, bs.tengo, "Las acciones que tengo"), " sl")}
        ${chipRow("Precio", `<button class="chip quiet" data-hoy="price" data-v="nat" aria-pressed="${d0.price === "nat"}">Bid/Ask</button><button class="chip quiet" data-hoy="price" data-v="mid" aria-pressed="${d0.price === "mid"}">Mid</button>`)}
        ${chipRow(
          "Filtros",
          chip("hide", "", "Ocultar fuera de Reglas", bs.hide) +
            chip("earn", "", "Ocultar con resultados", bs.earn) +
            chip("trend", "", "Sin avisos de tendencia", bs.trend) +
            chip("margin", "", "Solo con margen", bs.margin) +
            chip("one", "", "Uno por nombre", bs.one),
          " wrap",
        )}
      </div>`;
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
    const count = bs.one ? `${rows.length} ${rows.length === 1 ? "nombre" : "nombres"} · ${list.length} ${list.length === 1 ? "deal" : "deals"}` : `${list.length} ${list.length === 1 ? "deal" : "deals"}`;
    const head = `<div class="bs-count small muted num">${count} · de ${d0.deals.length}</div>`;
    if (!rows.length) return `${head}<p class="small muted">Ningún deal con estos filtros.</p><button class="btn quiet" data-bs="reset">Quitar filtros</button>`;
    const more = rows.length > shown.length ? `<button class="btn quiet fi-more" data-bs="more">Ver más (${rows.length - shown.length})</button>` : "";
    return `${head}<ul class="fi-dlist">${shown.map((d) => hoy.dealRow(d, { withName: true, note: variants.get(d.sym.s) ? `+${variants.get(d.sym.s)} más de ${esc(d.sym.s)}` : "" })).join("")}</ul>${more}`;
  }

  function view() {
    if (!state.scan?.symbols?.length) return `<div class="bs">${header("Buscador", false)}<div class="empty"><h2>Esperando el primer barrido de la lista</h2><p class="small muted" style="margin-top:8px">Sale cada media hora en horario de mercado.</p></div></div>`;
    const d0 = data();
    return `<div class="bs">
      ${header("Buscador", false)}
      <div class="bs-search"><input id="bs-q" class="bs-q" type="search" placeholder="Buscar acción: COST, Costco, energía…" value="${esc(bs.q)}" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Buscar acción"></div>
      ${namesPanel(d0)}
      ${filters(d0)}
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
    const box = root.querySelector("#bs-list");
    if (box && state.tab === "buscador") box.innerHTML = listHtml(data());
  }

  /** Barras de ancho y de prob.: "hasta" ese valor; el máximo de la barra no filtra. */
  function setRange(kind, value) {
    if (!Number.isInteger(value)) return false;
    if (kind === "w" && value >= W_MIN && value <= W_MAX) bs.w = value >= W_MAX ? null : value;
    else if (kind === "pr" && value >= PR_MIN && value <= PR_MAX) bs.pr = value >= PR_MAX ? null : value;
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
    else if (act === "exp") bs.exp = value || null;
    else if (act === "tengo") bs.tengo = TENGO.some(([id]) => id === value) ? value : "all";
    else if (act === "hide") bs.hide = !bs.hide;
    else if (act === "earn") bs.earn = !bs.earn;
    else if (act === "trend") bs.trend = !bs.trend;
    else if (act === "margin") bs.margin = !bs.margin;
    else if (act === "one") bs.one = !bs.one;
    else if (act === "ord") bs.ord = ORDERS.some(([id]) => id === value) ? value : "lv";
    else if (act === "more") {
      bs.shown += SHOW;
      return true;
    } else if (act === "reset") {
      Object.assign(bs, { q: "", lv: [...DEFAULT_LV], exp: null, blocks: [], w: null, pr: null, hide: false, earn: false, trend: false, margin: false, tengo: "all" });
    } else touched = false;
    if (touched && act !== "names" && act !== "mode" && act !== "name" && act !== "all-on" && act !== "all-off" && act !== "clear-tengo") {
      bs.shown = SHOW;
      keep();
    }
    return touched;
  }

  return { view, click, setQuery, setRange };
}
