// Cuentas y textos de la ficha y de las listas de deals de Hoy: funciones puras, sin estado ni pantalla.

import { fmtStrike, num, returnsOf, sma, smaSeries } from "./engine.js";
import { PR, W } from "./filtros.js";

export const PROBS = [5, 8, 10];
export const PROB_MIN = PR.min; // la barra de prob. va de 3 a 30 % de uno en uno: "X % o menos" (30 % es el tope común)
export const PROB_MAX = PR.max;
export const probOk = (v) => Number.isInteger(v) && v >= PROB_MIN && v <= PROB_MAX;
export const WIDTHS = [2, 3, 5, 10];
// Filtros de ancho y de prob. de la lista de deals de la ficha: barras que filtran "hasta"; al máximo no filtran.
export const FL_W_MIN = W.min;
export const FL_W_MAX = W.max;
export const FL_W_STEP = W.step;
export const FL_PR_MIN = PR.min;
export const FL_PR_MAX = PR.max;
export const FOLDS = ["why", "vol", "ren", "prob", "bro"]; // los bloques plegables de la ficha
export const VIEWS = ["mapa", "nube", "barras", "mis"];
export const MAX_DEALS = 300;

export const usd2 = (n) => `$${num(n, 2)}`;
export const dollars = (n) => (Math.abs(n) >= 10 ? `$${num(Math.round(n), 0)}` : usd2(n));
export const signedUsd = (n) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${dollars(Math.abs(n))}`;
export const signedPct = (n) => `${n > 0 ? "+" : ""}${num(n, 1)} %`;
export const nearest = (list, value) => list.reduce((best, item) => (Math.abs(item - value) < Math.abs(best - value) ? item : best), list[0]);
export const dealKey = (row) => `${row.expiry}|${row.shortStrike}|${row.longStrike}`;
/** "0,17" o "12,5" escrito a mano → número. Acepta coma o punto. */
export const parseNumber = (text) => {
  const clean = String(text ?? "").trim().replace(/\s/g, "").replace("−", "-").replace(",", ".");
  return /^-?\d+(\.\d+)?$/.test(clean) ? Number(clean) : NaN;
};


/** El punto de seguridad en la ficha, según la regla. Apagado no sale. */
export function safetyItem(item, checks, row, opts, both, anyOne) {
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


export const FAIL_SHORT = { "probabilidad alta": "prob.", "sin dato de probabilidad": "prob.", "fuera del punto": "% abajo", "crédito corto": "cobras", "equilibrio bajo": "equilibrio" };
export const failShort = (fail) => FAIL_SHORT[fail] ?? (fail.startsWith("ancho de") ? "ancho" : fail);
export const spanText = (years) => (years >= 4.5 ? "5 años" : years >= 1.5 ? `${num(Math.round(years * 10) / 10, 1)} años` : "lo guardado");
/** Dólares con céntimos y signo: aquí cada céntimo cuenta. */
export const usdS = (n) => `${n > 0 ? "+" : n < 0 ? "−" : ""}$${num(Math.abs(n), 2)}`;
export const tone = (n) => (n > 0 ? "up" : n < 0 ? "down" : "");

/** Lo que rinde el deal: sin comisión, con comisión y tras lo que se espera pagar. Cada fila, en dólares, por día, sobre lo que arriesgas y sobre lo que arriesgas por día. */
export function yieldTable(row, fee, price) {
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
      ${line("Sin comisión", price === "mid" ? "a precio medio" : "a precio visible", r.gross)}
      ${line("Con comisión", "", r.net)}
      ${line("Esperada", "tras lo que se espera pagar", r.expected)}
    </table>
    <p class="xs muted">${r.days} ${r.days === 1 ? "día" : "días"} al vencimiento. G = gano · D = día · S = spread, lo que arriesgas («pierdes máx.»). Por contrato. Comisión de abrir: ${usd2(fee)}; entrar y salir cuesta ${row.roundTrip == null ? "—" : usd2(row.roundTrip)}.</p>
  </div>`;
}

export function orderText(sym, row, rows) {
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


/** Lo que queda de lo cobrado, en %: el "beneficio" de las filas de la ficha y del Buscador. */
export const benefit = (d) => (d.row.net > 0 ? ((d.row.net - d.row.expected) / d.row.net) * 100 : null);
/** Rentab. esperada repartida entre los días hasta el vencimiento. */
export const perDay = (d) => (d.row.retExp != null && d.row.dte > 0 ? d.row.retExp / d.row.dte : -Infinity);
/** La lista de deals en el orden elegido en la barra: nivel (el de fábrica), beneficio, prob., suelo o por día. */
export function sortDeals(list, ord) {
  if (ord === "ben") return [...list].sort((a, b) => (benefit(b) ?? -Infinity) - (benefit(a) ?? -Infinity));
  if (ord === "prob") return [...list].sort((a, b) => (a.row.prob ?? 100) - (b.row.prob ?? 100));
  if (ord === "floor") return [...list].sort((a, b) => (b.floor ?? -Infinity) - (a.floor ?? -Infinity) || b.level - a.level);
  if (ord === "day") return [...list].sort((a, b) => perDay(b) - perDay(a) || b.level - a.level);
  return list;
}

/** Gráfico del precio en SVG, sin dependencias: el último año de cierres (hasta 252) más el precio de hoy, con la media de 50 y de 200 días
 *  y, si se da, el strike corto del deal como línea de puntos. Devuelve "" si faltan cierres (menos de 60) o precio. */
export function priceChart(closes, price, strike = null) {
  if (!Array.isArray(closes) || closes.length < 60 || !(price > 0)) return "";
  const N = Math.min(252, closes.length);
  const start = closes.length - N;
  const view = closes.slice(start);
  const s50 = smaSeries(closes, 50).slice(start);
  const s200 = smaSeries(closes, 200).slice(start);
  const has50 = s50.some(Number.isFinite);
  const has200 = s200.some(Number.isFinite);
  const hasStrike = strike > 0;
  const vals = [...view, price, ...(hasStrike ? [strike] : []), ...s50.filter(Number.isFinite), ...s200.filter(Number.isFinite)];
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  const pad = (hi - lo) * 0.06 || 1;
  lo -= pad;
  hi += pad;
  const W = 320, H = 132, L = 4, R = 46, T = 6, B = 6;
  const x = (i) => (L + (i / N) * (W - L - R)).toFixed(1);
  const y = (v) => (T + (1 - (v - lo) / (hi - lo)) * (H - T - B)).toFixed(1);
  const path = (series, withToday) => {
    const pts = series.map((v, i) => (Number.isFinite(v) ? `${x(i)},${y(v)}` : null)).filter(Boolean);
    if (withToday) pts.push(`${x(N)},${y(price)}`);
    return pts.length > 1 ? `M${pts.join("L")}` : "";
  };
  let yp = Number(y(price));
  let ys = hasStrike ? Number(y(strike)) : 0;
  if (hasStrike && Math.abs(ys - yp) < 11) ys = yp + (ys >= yp ? 11 : -11); // que las dos etiquetas no se pisen
  const m50 = sma(closes, 50);
  const m200 = sma(closes, 200);
  const label = `Precio de los últimos ${N} cierres: hoy ${usd2(price)}${m50 ? `, media de 50 días ${usd2(m50)}` : ""}${m200 ? `, media de 200 días ${usd2(m200)}` : ""}${hasStrike ? `, strike corto ${usd2(strike)}` : ""}`;
  const key = (cls, text) => `<span class="pc-k"><i class="pc-sw ${cls}"></i>${text}</span>`;
  return `<div class="pchart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${label}">
      ${has200 ? `<path class="pc-s200" d="${path(s200, false)}"/>` : ""}
      ${has50 ? `<path class="pc-s50" d="${path(s50, false)}"/>` : ""}
      ${hasStrike ? `<line class="pc-strike" x1="${L}" x2="${W - R}" y1="${y(strike)}" y2="${y(strike)}"/>` : ""}
      <path class="pc-line" d="${path(view, true)}"/>
      <circle class="pc-dot" cx="${x(N)}" cy="${y(price)}" r="3"/>
      <text class="pc-t" x="${W - R + 4}" y="${(yp + 3.5).toFixed(1)}">${usd2(price)}</text>
      ${hasStrike ? `<text class="pc-t pc-ts" x="${W - R + 4}" y="${(ys + 3.5).toFixed(1)}">${usd2(strike)}</text>` : ""}
    </svg><p class="pc-leg xs muted">${key("pc-line", "Precio")}${has50 ? key("pc-s50", "Media 50") : ""}${has200 ? key("pc-s200", "Media 200") : ""}${hasStrike ? key("pc-strike", "Strike corto") : ""}</p></div>`;
}
