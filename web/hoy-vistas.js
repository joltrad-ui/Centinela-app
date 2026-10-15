// Las tres vistas de Hoy (mapa, nube y barras) y los controles de arriba (filtros, Ya tengo).

import { LEVEL_COST_PCT, fmtStrike, labelOf, levelGrid, num, rangeOf, rangeOrder } from "./engine.js";
import { emptyBox, notice } from "./ui.js";
import { signedPct, usd2 } from "./hoy-calc.js";
import { W, choiceRow, filterBars, moreHead } from "./filtros.js";

export function createVistas(h) {
  const { hoy, ctx, esc, chip, stats, levelTag, openDeals, foldBlock } = h;

    function segmented() {
      const open = openDeals().length;
      const item = (id, label) => `<button data-hoy="view" data-v="${id}" aria-pressed="${hoy.view === id}">${label}</button>`;
      return `<div class="seg" role="group" aria-label="Vistas de Hoy">${item("mapa", "Mapa")}${item("nube", "Nube")}${item("barras", "Barras")}${item("mis", `Mis deals${open ? ` · ${open}` : ""}`)}</div>`;
    }

    function controls(o) {
      const blocks = ctx.blockOrder();
      const held = o.opts.held;
      const fromDeals = openDeals().map((deal) => deal.b).filter(Boolean);
      const nAct = (hoy.price === "mid" ? 1 : 0) + (held.length ? 1 : 0);
      const wDollars = Math.min(W.max, Math.max(W.min, Math.round((o.opts.width * 100) / W.step) * W.step));
      const head = moreHead('data-hoy="filters-open"', hoy.fOpen, nAct);
      return `<div class="filters">
        ${filterBars({ prefix: "hoy", w: wDollars, pr: o.opts.prob })}
        ${head}
        ${
          !hoy.fOpen
            ? ""
            : `      ${choiceRow("Precio", 'data-hoy="price"', [["nat", "Bid/Ask"], ["mid", "Mid"]], hoy.price)}
        ${
          hoy.heldOpen
            ? `<div class="frow hoy-wrap" role="group" aria-label="Bloques que ya tengo"><button class="small muted hoy-lab hoy-lab-btn" data-hoy="held-open" aria-expanded="true">Ya tengo ▴</button><div class="hoy-mine">${blocks
                .map((name) => `<button class="chip quiet" data-hoy="held" data-v="${esc(name)}" aria-pressed="${held.includes(name)}" ${fromDeals.includes(name) ? "disabled" : ""}>${esc(name)}</button>`)
                .join("")}<button class="chip quiet hoy-edit" data-hoy="held-open" aria-expanded="true">Listo</button></div></div>
              <p class="xs muted hoy-mine-note">Marca los bloques en los que ya tienes algo abierto. Un deal de un bloque marcado no suma el punto de bloque nuevo.${fromDeals.length ? " Los de tus deals apuntados se marcan solos." : ""} Solo en este dispositivo.</p>`
            : `<div class="frow" role="group" aria-label="Bloques que ya tengo"><button class="small muted hoy-lab hoy-lab-btn" data-hoy="held-open" aria-expanded="false">Ya tengo ▾</button>${held
                .map((name) => `<button class="chip quiet" data-hoy="held-open" aria-pressed="true">${esc(name)}</button>`)
                .join("")}${held.length ? "" : '<button class="chip quiet" data-hoy="held-open">ninguno</button>'}</div>`
        }`
        }
      </div>`;
    }

    /** Los avisos de abajo del todo: si el precio es una hipótesis y qué reglas mandan. Van al final para no empujar lo importante. */
    const notes = (o) => `${hoy.price === "mid" ? notice("watch", "A precio medio: es una hipótesis. Nadie garantiza que te llenen a ese precio.", "margin-top:14px") : ""}
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

    const help = (opts) =>
      foldBlock("help", "", "Cómo se puntúa y cómo se lee", "", hoy.help, `<div class="eq-help small muted">
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
        </div>`);

    // ---------- 1. mapa ----------

    function viewMapa(o) {
      if (!o.symbols.length) return emptyBox("Esperando el primer barrido de la lista.", "Sale cada media hora en horario de mercado.");
      if (!o.expiries.length) return `${controls(o)}${emptyBox("Ningún vencimiento cae dentro del plazo de Reglas.", "Cambia el plazo en Reglas.", { attrs: 'data-tab="reglas"', label: "Abrir Reglas" })}`;
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
      const msg = !s.withHistory ? "Todavía no hay cierres diarios guardados: sin ellos no se puede puntuar." : s.positive === 0 ? "Hoy ninguna casilla cubre lo que se espera pagar." : "";
      const line = msg
        ? `<p class="hoy-sum none">${msg}</p>`
        : stats([...tops.map((level) => [`Nivel ${level}`, count(level)]), ...(o.opts.safety === "off" ? [] : [["Margen", s.firm]]), ["Total", s.comparable]], "Casillas por nivel");
      return `${controls(o)}
        ${expChips}
        ${line}
        <div class="hoy-grid${focus ? " one" : ""}" role="grid" aria-label="Nivel de cada nombre en cada vencimiento" style="grid-template-columns:${focus ? "54px 56px minmax(0,1fr)" : `54px repeat(${grid.expiries.length},minmax(0,1fr))`}">
          ${focus ? "" : `<span></span>${grid.expiries.map((exp) => `<button class="hoy-exp" data-hoy="mexp" data-v="${exp.expiry}" aria-label="Ver solo el ${esc(exp.label)}">${esc(exp.label)}</button>`).join("")}`}
          ${rows}
        </div>
        ${hidden.length ? `<p class="xs muted" style="margin-top:10px">${focus ? "Sin fila en esta fecha" : "Sin fila en ningún vencimiento"}: ${hidden.map((name) => esc(name.sym.s)).join(", ")}.</p>` : ""}
        <p class="xs muted" style="margin-top:8px">Toca una casilla para ver el deal. ${focus ? "Toca «Todas» para volver a ver todas las fechas." : "Toca una fecha para ver solo los de ese vencimiento."}</p>
        ${foldBlock("legend", "", "Qué significa cada casilla", "", hoy.legendOpen, legend(o.opts))}
        ${notes(o)}
        ${help(o.opts)}`;
    }

    // ---------- 2. nube ----------

    function viewNube(o) {
      if (!o.symbols.length) return emptyBox("Esperando el primer barrido de la lista.", "Sale cada media hora en horario de mercado.");
      if (!o.expiries.length) return `${controls(o)}${emptyBox("Ningún vencimiento cae dentro del plazo de Reglas.", "Cambia el plazo en Reglas.", { attrs: 'data-tab="reglas"', label: "Abrir Reglas" })}`;
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
            : emptyBox(`Ningún deal comparable el ${esc(labelOf(expiry))}.`)
        }
        ${gated ? `<p class="xs muted" style="margin-top:10px">${gated} ${gated === 1 ? "nombre apartado" : "nombres apartados"} por horquilla ancha o por coste: se ven en el mapa con una H.</p>` : ""}
        ${notes(o)}
        ${help(o.opts)}`;
    }

    // ---------- 2 bis. barras ----------

    /** Los mismos deals que la nube, una fila cada uno y todos en la misma escala (% de lo que se arriesga):
     *  el rombo es lo que cobra, el punto lo que queda de media, la barra su error y la línea de puntos lo que se espera pagar. */
    function viewBarras(o) {
      if (!o.symbols.length) return emptyBox("Esperando el primer barrido de la lista.", "Sale cada media hora en horario de mercado.");
      if (!o.expiries.length) return `${controls(o)}${emptyBox("Ningún vencimiento cae dentro del plazo de Reglas.", "Cambia el plazo en Reglas.", { attrs: 'data-tab="reglas"', label: "Abrir Reglas" })}`;
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
      let body = emptyBox(`Ningún deal comparable el ${esc(labelOf(expiry))}.`);
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

  return { segmented, viewMapa, viewNube, viewBarras };
}
