// Pestaña "Registro": lo que Centinela ha ido proponiendo, comprobado al vencer. Lee registro/ (CSV de la rama de datos)
// y lo analiza en el dispositivo (registro-calc.js). Solo enseña y avisa: no cambia ninguna regla.
import { analyze, parseCsv } from "./registro-calc.js";
import { emptyBox } from "./ui.js";

const FRESH_MS = 10 * 60_000; // no se vuelve a descargar si se bajó hace menos

export function createRegistro({ state, render, esc, num, sectionHead, header, foot, embed = false }) {
  const reg = { status: "idle", rows: [], at: 0, example: false, all: false };

  async function text(url) {
    const res = await fetch(`${url}${url.includes("?") ? "&" : "?"}t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error(String(res.status));
    return res.text();
  }

  /** Descarga el índice y los meses. Se llama al abrir la pestaña. */
  async function load(force = false) {
    if (embed) {
      reg.status = "sin-registro";
      reg.at = Date.now();
      return;
    }
    if (reg.status === "loading" || (!force && reg.status !== "idle" && Date.now() - reg.at < FRESH_MS)) return;
    const first = reg.status === "idle";
    reg.status = "loading";
    if (first) render();
    try {
      const index = JSON.parse(await text("registro/indice.json"));
      const months = Array.isArray(index.meses) ? index.meses.filter((m) => /^\d{4}-\d{2}$/.test(m)) : [];
      const parts = await Promise.all(months.map((m) => text(`registro/${m}.csv`).then(parseCsv)));
      reg.rows = parts.flat();
      reg.example = Boolean(index.example);
      reg.status = "ok";
    } catch (error) {
      reg.status = String(error?.message) === "404" ? "sin-registro" : "error";
    }
    reg.at = Date.now();
    if (state.tab === "registro") render();
  }

  // ---------- piezas ----------

  const usd = (n) => (n == null ? "—" : `${n > 0.5 ? "+" : n < -0.5 ? "−" : ""}$${num(Math.abs(n), 0)}`);
  const tone = (n) => (n == null ? "" : n > 0.5 ? "up" : n < -0.5 ? "down" : "");
  const count = (n) => `${num(n, 0)} ${n === 1 ? "deal" : "deals"}`;

  /** Una regla horizontal: raya = esperado, punto = real, marca en $0 y un tramo entre los dos
   *  (rojo si lo real queda por debajo, verde si por encima). Todas las filas de una tabla comparten escala. */
  function track(real, exp, scale) {
    if (real == null || exp == null) return '<div class="rg-track"><i class="ax"></i></div>';
    const at = (v) => (4 + ((v - scale.min) / (scale.max - scale.min)) * 92).toFixed(1);
    const [a, b] = real < exp ? [real, exp] : [exp, real];
    return `<div class="rg-track" role="img" aria-label="Esperado ${usd(exp)}, real ${usd(real)}"><i class="ax"></i><i class="zero" style="left:${at(0)}%"></i><i class="seg ${real < exp ? "lo" : "hi"}" style="left:${at(a)}%;width:${(at(b) - at(a)).toFixed(1)}%"></i><i class="ex" style="left:${at(exp)}%"></i><i class="re" style="left:${at(real)}%"></i></div>`;
  }

  const scaleOf = (list) => {
    const vals = [0, ...list.flatMap((row) => [row.real, row.exp]).filter((v) => v != null)];
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    return { min: min - 0.08 * (max - min || 1), max: max + 0.08 * (max - min || 1) };
  };

  const row = (label, small, st, scale) =>
    `<li class="rg-row"><div class="rg-k">${label}<small>${small}</small></div>${track(st.real, st.exp, scale)}<div class="rg-v"><b class="num ${tone(st.real)}">${usd(st.real)}</b><small>${st.pctWon == null ? "—" : `${num(st.pctWon, 0)} % gan.`}</small></div></li>`;

  const legend = `<p class="rg-leg xs muted"><span><i class="ex"></i>esperado</span><span><i class="re"></i>real</span><span><i class="zero"></i>$0</span></p>`;

  function body(a, rules) {
    const dots = { g: "g", a: "a", r: "r", x: "x" };
    const signals = `<ul class="rg-sig">${a.signals.map((s) => `<li><i class="rg-dot ${dots[s.color]}"></i><div><b>${esc(s.title)}</b><span>${esc(s.text)}</span></div></li>`).join("")}</ul>`;
    const lvScale = scaleOf(a.byLevel);
    const byLevel = `<ul class="rg-tb">${a.byLevel.map((st) => row(`<span class="lv lv${st.level} sm">${st.level}</span>`, count(st.n), st, lvScale)).join("")}</ul>`;
    const disScale = scaleOf(a.byDis);
    const byDis = `<ul class="rg-tb">${a.byDis.map((st) => row(esc(st.label), count(st.n), st, disScale)).join("")}</ul>`;
    const shown = reg.all ? a.byGroup : a.byGroup.slice(0, 6);
    const groups = a.byGroup.length
      ? `<ul class="rg-tb rg-grp">${shown
          .map(
            (g) =>
              `<li><b>${esc(g.names.join(" · "))}</b><span class="pill ${g.together ? "st-debajo" : "st-lejos"}">${g.together ? `${g.together} ${g.together === 1 ? "vez" : "veces"} juntos` : "nunca"}</span><span class="muted small num">${count(g.n)} · ${usd(g.real)} de media</span></li>`,
          )
          .join("")}</ul>${a.byGroup.length > shown.length ? `<button class="btn quiet rg-more" data-reg="all">Ver todos (${a.byGroup.length})</button>` : ""}`
      : '<p class="small muted">Todavía no hay deals vencidos.</p>';
    return `
      ${a.few ? `<p class="notice small watch">Pocos datos, no sacar conclusiones: hay ${a.months} ${a.months === 1 ? "vencimiento mensual" : "vencimientos mensuales"} y las señales se encienden con 3.</p>` : ""}
      ${sectionHead("Señales")}${signals}
      ${sectionHead("Por nivel")}${byLevel}${legend}
      ${sectionHead("Por desacuerdo")}${byDis}
      <p class="xs muted rg-note">Desacuerdo: lo que se separan la pérdida esperada con 5 años de historia y con la volatilidad reciente. Tres tramos con los mismos deals. Solo se guarda: no cambia el error ni el nivel.</p>
      ${sectionHead("Por grupo")}${groups}
      <p class="xs muted rg-note">Solo deals ya vencidos, contados una vez (su primera aparición). Las señales avisan; no cambian ninguna regla.</p>`;
  }

  function view() {
    let inner;
    let meta = "";
    if (reg.status === "idle" || reg.status === "loading") inner = '<p class="small muted" style="margin-top:14px">Leyendo el registro…</p>';
    else if (reg.status === "error") inner = emptyBox("No se pudo leer el registro.", "Comprueba la conexión y vuelve a abrir la pestaña.", { attrs: 'data-reg="reload"', label: "Reintentar" });
    else if (reg.status === "sin-registro" || !reg.rows.length) {
      inner = emptyBox("Todavía no hay registro.", [embed ? "La versión de prueba no lo lleva." : "Se empieza a llenar con el último barrido de cada día de mercado, y los deals se resuelven solos al vencer.", "Aquí verás qué niveles y qué grupos funcionan de verdad."]);
    } else {
      const a = analyze(reg.rows, state.config.rules);
      meta = `${a.months} ${a.months === 1 ? "vencimiento" : "vencimientos"} · ${num(a.n, 0)} ${a.n === 1 ? "deal resuelto" : "deals resueltos"} · desde el ${esc(a.dayLabel(a.since || "1970-01-01"))}`;
      inner = a.n ? body(a, state.config.rules) : `<p class="small muted" style="margin-top:14px">Hay deals guardados, pero ninguno ha vencido todavía. Cuando venzan, aquí saldrán los resultados.</p>`;
    }
    return `
      ${header("Registro", false, true)}
      ${meta ? `<p class="rg-meta small muted num">${meta}</p>` : ""}
      ${inner}
      ${foot()}`;
  }

  function click(el) {
    const act = el.dataset.reg;
    if (!act) return false;
    if (act === "all") reg.all = !reg.all;
    else if (act === "reload") void load(true);
    render();
    return true;
  }

  return { view, load, click };
}
