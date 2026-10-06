import test from "node:test";
import assert from "node:assert/strict";
import { alertText, num, rulesLine, spreadLine, liquidityNotes, spreadRow, yearRange, expectedLoss, historyStats, realizedVol, sessionsBetween, withHistory, commonExpiries, defaultExpiry, equalRisk, equalRiskList, assessSymbol, balanceOf, favoriteDeals, ivFromPut, marketProbs, normalizeConfig, normalizeRules, probBelow, putPrice, rankUniverse } from "../web/engine.js";

import { checkSeries, repairSplits, toSeries } from "../scanner/cierres.mjs";

const today = "2026-10-05";
// Reglas de las pruebas: sin límite de probabilidad ni de equilibrio, con el % abajo
// acotado a 8–12 y un cobro mínimo de $50, salvo lo que cada prueba cambie.
const R = (extra = {}) => normalizeRules({ v: 2, maxProb: 50, otmOn: true, minOtm: 8, maxOtm: 12, minCredit: 50, minBalance: 0, ...extra });
// [strike, bid, ask, interés abierto, iv, delta]
const sym = {
  s: "XYZ",
  p: 100,
  c: 0,
  er: { d: "2026-10-28", x: "fecha estimada" },
  x: [["2026-10-30", 0.4, [[80, 0.1, 0.15, 500, 0.5, -0.03], [85, 0.3, 0.4, 800, 0.46, -0.08], [90, 1.0, 1.1, 1200, 0.42, -0.17], [95, 2.4, 2.5, 900, 0.4, -0.33]]]],
};

test("crédito, pérdida y rentabilidad de un bull put 90/85", () => {
  const res = assessSymbol(sym, R(), "equilibrio", today);
  assert.equal(res.status, "entrada");
  const sp = res.best;
  assert.equal(`${sp.shortStrike}/${sp.longStrike}`, "90/85");
  assert.equal(sp.credit, 0.6); // bid del corto 1.00 − ask del largo 0.40
  assert.equal(sp.creditPct, 12);
  assert.equal(sp.lossUsd, 440);
  assert.equal(sp.ret, 13.6);
  assert.equal(sp.breakeven, 89.4);
  assert.equal(sp.otm, 10);
  assert.equal(sp.dte, 25);
});

test("el ancho es un máximo: vale ese y cualquiera menor", () => {
  const dense = { s: "DEN", p: 100, c: 0, er: null, x: [["2026-10-30", 0.4, [[84, 0.2, 0.25, 9, 0.47, -0.07], [85, 0.3, 0.35, 9, 0.46, -0.08], [87.5, 0.6, 0.65, 9, 0.44, -0.12], [89, 0.8, 0.85, 9, 0.43, -0.15], [90, 1.0, 1.05, 9, 0.42, -0.17]]]] };
  const all = assessSymbol(dense, R({ minCredit: 0, width: 5 }), "credito", today).all.filter((sp) => sp.shortStrike === 90);
  assert.deepEqual(all.map((sp) => sp.width).sort((a, b) => a - b), [1, 2.5, 5]);
  assert.ok(all.every((sp) => sp.ok));
  const narrow = assessSymbol(sym, R({ width: 2 }), "equilibrio", today);
  assert.equal(narrow.status, "no-pasa");
  assert.match(narrow.best.fails.join(), /ancho de \$5/);
});

test("equilibrio: ganancia esperada entre pérdida esperada", () => {
  assert.equal(balanceOf(25, 20), 1); // 25% de rentabilidad con 20% de probabilidad: 0.25 × 80 / 20
  assert.equal(balanceOf(10, 20), 0.4);
  assert.ok(balanceOf(10, 10) > balanceOf(10, 20)); // menos probabilidad, más equilibrio
  assert.ok(balanceOf(15, 20) > balanceOf(10, 20)); // más rentabilidad, más equilibrio
  assert.equal(balanceOf(10, null), null);
});

test("regla de equilibrio mínimo", () => {
  const sp = assessSymbol(sym, R(), "equilibrio", today).best;
  const strict = assessSymbol(sym, R({ minBalance: sp.balance + 0.05 }), "equilibrio", today);
  assert.equal(strict.status, "no-pasa");
  assert.ok(strict.best.fails.includes("equilibrio bajo"));
  assert.equal(assessSymbol(sym, R({ minBalance: sp.balance }), "equilibrio", today).status, "entrada");
  assert.equal(normalizeRules({}).minBalance, 0.5);
  assert.equal(normalizeRules({ minBalance: 9 }).minBalance, 1.5);
});

test("probabilidad de asignación: sale de los precios de los strikes vecinos", () => {
  // precios medios: 80 → 0.125, 85 → 0.35, 90 → 1.05, 95 → 2.45
  const probs = marketProbs(sym.x[0][2]).map((p) => Math.round(p * 100) / 100);
  assert.deepEqual(probs, [4.5, 9.25, 21, 28]); // (0.35−0.125)/5, (1.05−0.125)/10, (2.45−0.35)/10, (2.45−1.05)/5
  const sp = assessSymbol(sym, R(), "equilibrio", today).best;
  assert.equal(sp.prob, 21);
  assert.equal(sp.probSrc, "mercado");
  assert.equal(sp.probModel, Math.round(probBelow(100, 90, 25, 0.42) * 10) / 10);
  assert.equal(probBelow(100, 90, 25, 0.35).toFixed(1), "12.8");
  // con ruido en los precios, la probabilidad nunca baja al subir el strike
  const noisy = marketProbs([[80, 0.1, 0.2, 1, 0, 0], [85, 0.5, 0.7, 1, 0, 0], [90, 0.6, 0.8, 1, 0, 0], [95, 2.4, 2.6, 1, 0, 0], [97, 3.4, 3.6, 1, 0, 0]]);
  for (let i = 1; i < noisy.length; i++) assert.ok(noisy[i] >= noisy[i - 1]);
  // sin precios vecinos no hay medida y se usa la fórmula
  const lone = { s: "UNO", p: 100, c: 0, er: null, x: [["2026-10-30", 0.4, [[85, 0, 0, 5, 0.46, -0.08], [90, 1.0, 1.1, 1200, 0.42, -0.17]]]] };
  assert.deepEqual(marketProbs(lone.x[0][2]), [null, null]);
});

test("la probabilidad máxima es la regla que elige el corto", () => {
  const wide = assessSymbol(sym, normalizeRules({ v: 2, maxProb: 12, minCredit: 0, minBalance: 0 }), "prob", today);
  assert.equal(wide.status, "entrada");
  const ok = wide.all.filter((sp) => sp.ok);
  assert.ok(ok.length > 0 && ok.every((sp) => sp.prob <= 12 && sp.shortStrike <= 85));
  const risky = wide.all.find((sp) => sp.shortStrike === 90);
  assert.ok(risky.fails.includes("probabilidad alta"));
  assert.equal(risky.stage, 0);
  // sin el % abajo encendido, estar a un 15 % no descarta
  assert.ok(ok.every((sp) => !sp.fails.includes("fuera del punto")));
  // lo que queda muy por encima de la probabilidad máxima ni se lista
  assert.equal(assessSymbol(sym, normalizeRules({ v: 2, maxProb: 5, minCredit: 0, minBalance: 0 }), "prob", today).all.some((sp) => sp.shortStrike >= 90), false);
  // un nombre con puts dentro de la probabilidad pero que no dan para el cobro mínimo
  // cuenta como que pasa la probabilidad y se queda en el crédito
  const { funnel } = rankUniverse([sym], normalizeRules({ v: 2, maxProb: 5, minCredit: 100, minBalance: 0 }), "prob", today);
  assert.equal(funnel.prob, 1);
  assert.equal(funnel.ancho, 1);
  assert.equal(funnel.credito, 0);
});

test("cobras, mínimo: en dólares por contrato", () => {
  const cheap = assessSymbol(sym, R({ minCredit: 65 }), "equilibrio", today);
  assert.equal(cheap.status, "no-pasa"); // el 90/85 cobra $60
  assert.ok(cheap.best.fails.includes("crédito corto"));
  assert.equal(assessSymbol(sym, R({ minCredit: 60 }), "equilibrio", today).status, "entrada");
});

test("reglas guardadas antes del cambio pasan a las nuevas de fábrica", () => {
  const old = normalizeRules({ minDte: 21, maxDte: 35, minOtm: 8, maxOtm: 12, width: 10, minCreditPct: 10, maxProb: 50, minBalance: 0.7 });
  assert.equal(old.v, 2);
  assert.equal(old.maxProb, 10); // estaba apagada de fábrica
  assert.equal(old.otmOn, false);
  assert.equal(old.minCredit, 20);
  assert.equal(old.minDte, 21);
  assert.equal(old.width, 10);
  assert.equal(old.minBalance, 0.7);
  assert.equal("minCreditPct" in old, false);
  assert.equal(normalizeRules({ maxProb: 15 }).maxProb, 15); // si la había puesto, se respeta
  assert.equal(normalizeRules({ v: 2, maxProb: 50 }).maxProb, 50);
  assert.equal(normalizeRules({ v: 2, otmOn: true }).otmOn, true);
});

test("interruptor de resultados", () => {
  const rules = R({ gates: { event: true } });
  const res = assessSymbol(sym, rules, "equilibrio", today);
  assert.equal(res.status, "no-pasa");
  assert.match(res.best.fails.join(), /resultados el 28 oct/);
});

test("interruptor de pérdida por contrato", () => {
  const rules = R({ gates: { loss: true, lossMin: 100, lossMax: 300 } });
  const res = assessSymbol(sym, rules, "equilibrio", today);
  assert.ok(res.best.fails.includes("pérdida por encima del tope"));
});

test("fuera del plazo y sin cadena", () => {
  assert.equal(assessSymbol(sym, normalizeRules({ minDte: 40, maxDte: 50 }), "equilibrio", today).status, "sin-plazo");
  assert.equal(assessSymbol({ s: "Q", p: 10, x: [] }, normalizeRules({}), "equilibrio", today).status, "sin-cadena");
});

test("el universo ordena y cuenta", () => {
  const other = { ...sym, s: "ABC", er: null, x: [["2026-10-30", 0.4, [[85, 0.3, 0.4, 800, 0.46, -0.08], [90, 1.3, 1.4, 1200, 0.42, -0.17]]]] };
  const { rows, funnel } = rankUniverse([sym, other], R(), "rentab", today);
  assert.equal(funnel.cumplen, 2);
  assert.deepEqual(rows.map((row) => row.sym.s), ["ABC", "XYZ"]);
});

test("deals de todos los favoritos, juntos y ordenados", () => {
  const other = { ...sym, s: "ABC", er: null, x: [["2026-10-30", 0.4, [[85, 0.3, 0.4, 800, 0.46, -0.08], [88, 0.9, 0.95, 500, 0.43, -0.14], [90, 1.3, 1.4, 1200, 0.42, -0.17]]]] };
  const rules = R({ minCredit: 25 });
  const all = favoriteDeals([sym, other], ["XYZ", "ABC", "NOPE"], rules, "rentab", today);
  assert.equal(all.matched, all.deals.length);
  assert.deepEqual(Object.keys(all.counts).sort(), ["ABC", "XYZ"]);
  // primero los que cumplen, y dentro de cada grupo por el orden elegido
  for (let i = 1; i < all.deals.length; i++) {
    const [a, b] = [all.deals[i - 1].sp, all.deals[i].sp];
    assert.ok(Number(a.ok) > Number(b.ok) || (a.ok === b.ok && a.ret >= b.ret));
  }
  // también salen los que no cumplen, con su motivo
  const no = all.deals.filter((row) => !row.sp.ok);
  assert.ok(no.length > 0 && no.every((row) => row.sp.fails.length > 0));
  const ok = favoriteDeals([sym, other], ["XYZ", "ABC"], rules, "rentab", today, { status: "ok" });
  assert.ok(ok.deals.length >= 3 && ok.deals.every((row) => row.sp.ok));
  assert.equal(ok.deals.length + favoriteDeals([sym, other], ["XYZ", "ABC"], rules, "rentab", today, { status: "no" }).deals.length, all.deals.length);
  // filtros: por nombre, por vencimiento y tope por nombre
  const abc = favoriteDeals([sym, other], ["XYZ", "ABC"], rules, "rentab", today, { names: ["ABC"] });
  assert.ok(abc.deals.every((row) => row.sym.s === "ABC"));
  assert.deepEqual(all.expiries, ["2026-10-30"]);
  assert.equal(favoriteDeals([sym, other], ["XYZ", "ABC"], rules, "rentab", today, { expiries: ["2026-11-06"] }).deals.length, 0);
  // filtro por ancho: "hasta 2" deja solo spreads de 2 dólares o menos
  assert.deepEqual(all.widths, [2, 3, 5]);
  const thin = favoriteDeals([sym, other], ["XYZ", "ABC"], rules, "rentab", today, { maxWidth: 2 });
  assert.ok(thin.deals.length > 0 && thin.deals.every((row) => row.sp.width <= 2));
  assert.equal(thin.counts.XYZ.shown, 0); // XYZ solo tiene spreads de 5: con "hasta 2" se queda en cero
  assert.equal(thin.counts.ABC.shown, thin.deals.length);
  // filtro por % abajo: "desde 11" deja solo cortos al menos un 11% abajo
  const far = favoriteDeals([sym, other], ["XYZ", "ABC"], rules, "rentab", today, { minOtm: 11 });
  assert.ok(far.deals.length > 0 && far.deals.length < all.deals.length && far.deals.every((row) => row.sp.otm >= 11));
  assert.ok(all.otmRange[0] < 11 && all.otmRange[1] >= 11);
  const one = favoriteDeals([sym, other], ["XYZ", "ABC"], rules, "rentab", today, { status: "ok", perName: 1 });
  assert.equal(one.deals.length, 2);
  assert.equal(one.matched, ok.deals.length);
});

test("volatilidad implícita a partir del precio de la put", () => {
  const price = putPrice(234.22, 215, 26, 0.36);
  assert.ok(Math.abs(ivFromPut(234.22, 215, 26, price) - 0.36) < 0.001);
  assert.equal(ivFromPut(100, 90, 25, 0), null);
  assert.equal(ivFromPut(100, 90, 25, 50), null); // precio imposible
});

test("las reglas guardadas se sanean", () => {
  const config = normalizeConfig({ rules: { minDte: 40, maxDte: 10, width: "x" }, favorites: ["aapl", "AAPL", "??"], alerts: { universeTop: 99 } });
  assert.equal(config.rules.maxDte, 40);
  assert.equal(config.rules.width, 5);
  assert.deepEqual(config.favorites, ["AAPL"]);
  assert.equal(config.alerts.universeTop, 0);
});

test("off: los nombres quitados de la lista se limpian y se conservan", () => {
  const config = normalizeConfig({ off: ["nvda", "NVDA", "??", "xle"] });
  assert.deepEqual(config.off, ["NVDA", "XLE"]);
  assert.deepEqual(normalizeConfig({}).off, []);
});

test("igual riesgo: corto por prob., largo exacto, neto con comisión", () => {
  const probs = marketProbs(sym.x[0][2]);
  const target = Math.ceil(probs[2] * 10) / 10; // deja pasar el strike 90 pero no el 95
  assert.ok(probs[3] > target);
  const row = equalRisk(sym, { prob: target, width: 5, expiry: "2026-10-30", fee: 1.4 }, today);
  assert.equal(row.status, "ok");
  assert.equal(`${row.shortStrike}/${row.longStrike}`, "90/85");
  assert.equal(row.credit, 0.6);
  assert.equal(row.net, 58.6); // 60 − 1,40
  assert.equal(row.loss, 441.4); // 500 − 58,6
  assert.equal(row.ret, 13.3); // 58,6 / 441,4
  assert.equal(row.probSrc, "mercado");
  assert.equal(row.prob, Math.round(probs[2] * 10) / 10);
  assert.equal(row.longProb, Math.round(probs[1] * 10) / 10);
  assert.equal(row.earnInside, true);
});

test("igual riesgo: sin ancho, sin vencimiento, sin strike cerca y sin precio", () => {
  const probs = marketProbs(sym.x[0][2]);
  const ok = { prob: Math.ceil(probs[2] * 10) / 10, width: 5, expiry: "2026-10-30", fee: 0 };
  assert.equal(equalRisk(sym, { ...ok, width: 3 }, today).status, "sin-ancho");
  assert.equal(equalRisk(sym, { ...ok, expiry: "2026-11-20" }, today).status, "sin-vencimiento");
  assert.equal(equalRisk(sym, { ...ok, prob: probs[2] + 6 }, today).status, "sin-strike"); // el corto queda >3 puntos por debajo
  const noBid = { ...sym, x: [["2026-10-30", 0.4, sym.x[0][2].map((r) => (r[0] === 90 ? [90, 0, 1.1, 1200, 0.42, -0.17] : r))]] };
  assert.equal(equalRisk(noBid, ok, today).status, "sin-precio");
});

test("igual riesgo: orden por rentabilidad neta, sin precio al final; fecha común", () => {
  const probs = marketProbs(sym.x[0][2]);
  const opts = { prob: Math.ceil(probs[2] * 10) / 10, width: 5, expiry: "2026-10-30", fee: 1.4 };
  const rich = { ...sym, s: "RICH", x: [["2026-10-30", 0.4, sym.x[0][2].map((r) => (r[0] === 90 ? [90, 1.3, 1.4, 1200, 0.42, -0.17] : r))]] };
  const none = { ...sym, s: "NONE", x: [["2026-11-27", 0.4, sym.x[0][2]]] };
  const { rows, out } = equalRiskList([sym, none, rich], opts, today);
  assert.deepEqual(rows.map((row) => row.sym.s), ["RICH", "XYZ"]);
  assert.deepEqual(out.map((row) => row.sym.s), ["NONE"]);
  const list = commonExpiries([sym, rich, none], normalizeRules({ minDte: 10, maxDte: 60 }), today);
  assert.equal(defaultExpiry(list), "2026-10-30");
  assert.equal(list.length, 2);
});

test("sesiones: lunes a viernes menos festivos de la bolsa", () => {
  assert.equal(sessionsBetween("2026-10-05", "2026-10-30"), 19);
  assert.equal(sessionsBetween("2026-11-25", "2026-11-27"), 1); // el 26 es Acción de Gracias
  assert.equal(sessionsBetween("2026-10-09", "2026-10-12"), 1); // fin de semana por medio
  assert.equal(sessionsBetween("2026-10-05", "2026-10-05"), 0);
});

test("historia: ventanas llevadas al precio de hoy, prob. y pérdida media", () => {
  const stats = historyStats([100, 90, 100, 110, 99], 100, 95, 90, 1);
  assert.equal(stats.windows, 4);
  assert.equal(stats.prob, 50); // dos de las cuatro acaban en 90, por debajo de 95
  assert.equal(stats.loss, 250); // (5 + 0 + 0 + 5) / 4 × 100, con el tope del ancho
  const deep = historyStats([100, 50], 100, 95, 90, 1);
  assert.equal(deep.loss, 500); // nunca más que el ancho
  assert.equal(historyStats([100, 90], 100, 95, 90, 5), null); // menos cierres que sesiones
});

test("volatilidad realizada anualizada con raíz de 252", () => {
  const a = Math.log(1.1);
  assert.ok(Math.abs(realizedVol([100, 110, 100], 2) - a * Math.sqrt(504)) < 1e-9);
  assert.equal(realizedVol([100, 101], 20), null);
  assert.equal(realizedVol([100, 100, 100, 100], 3), 0);
});

test("pérdida esperada reciente: coincide con sumar todos los finales posibles", () => {
  const S = 100, Ks = 90, Kl = 85, sigma = 0.3, T = 20 / 252;
  let sum = 0;
  const dz = 0.0005;
  for (let z = -9; z <= 9; z += dz) {
    const final = S * Math.exp((-sigma * sigma * T) / 2 + sigma * Math.sqrt(T) * z);
    sum += Math.min(Math.max(Ks - final, 0), Ks - Kl) * Math.exp((-z * z) / 2) * dz;
  }
  const exact = (sum / Math.sqrt(2 * Math.PI)) * 100;
  const got = expectedLoss(S, Ks, Kl, sigma, T);
  assert.ok(Math.abs(got - exact) < 0.05, `${got} frente a ${exact}`);
  assert.ok(expectedLoss(S, Ks, Kl, 0.6, T) > got); // más volatilidad, más pérdida esperada
  assert.equal(expectedLoss(S, Ks, Kl, 0, T), null);
});

test("igual riesgo con historia: equilibrio, orden y poca historia", () => {
  const probs = marketProbs(sym.x[0][2]);
  const opts = { prob: Math.ceil(probs[2] * 10) / 10, width: 5, expiry: "2026-10-30", fee: 1.4 };
  const walk = (n, step) => Array.from({ length: n }, (_, i) => 100 * (1 + step * (i % 2)));
  const calm = { d: "2021-10-05", c: walk(1300, 0.02) };
  const wild = { d: "2025-06-02", c: walk(300, 0.2) };
  const row = withHistory(equalRisk(sym, opts, today), calm, today);
  assert.equal(row.sessions, 19);
  assert.equal(row.histProb, 0); // con ±2 % nunca acaba por debajo de 90
  assert.equal(row.histLoss, 0);
  assert.equal(row.shortHistory, false);
  assert.ok(row.recentLoss > 1 && row.recentLoss < 500);
  assert.ok(Math.abs(row.balanceHist / (row.net / row.recentLoss) - 1) < 0.01); // manda la mayor de las dos pérdidas
  const other = { ...sym, s: "WILD" };
  const { rows } = equalRiskList([other, sym], { ...opts, hist: { XYZ: calm, WILD: wild } }, today);
  assert.deepEqual(rows.map((r) => r.sym.s), ["XYZ", "WILD"]); // mismo cobro; la historia movida queda detrás
  assert.equal(rows[1].shortHistory, true);
  assert.ok(rows[1].histProb > 0 && rows[1].balanceHist < rows[0].balanceHist);
  const none = equalRiskList([sym], { ...opts, hist: {} }, today).rows[0];
  assert.equal(none.balanceHist, undefined); // sin cierres de ese nombre, la fila sale igual que en el paso 1
});

test("cierres: últimos 5 años, corte en el hueco y en el inicio real del nombre", () => {
  const row = (date, close) => ({ date, open: close, high: close, low: close, close, volume: 1 });
  const body = { data: [row("2019-01-02", 50), row("2023-03-01", 24), row("2023-03-02", 25), row("2026-09-30", 60.004), row("2026-10-01", 61), row("2026-10-02", 62), row("2026-10-02", 62.5), row("2030-01-01", 1), row("x", 3), row("2026-10-01", 0)] };
  const series = toSeries("XYZ", body, today);
  assert.deepEqual(series.c, [60, 61, 62.5]); // lo anterior al hueco de 2023 a 2026 no se usa; el repetido, el último
  assert.equal(series.d, "2026-09-30");
  assert.equal(series.cut, true);
  assert.equal(checkSeries(series, today), "");
  const ibit = toSeries("IBIT", { data: [row("2024-01-09", 24), row("2024-01-10", 24), row("2024-01-11", 26), row("2024-01-12", 27)] }, today);
  assert.equal(ibit.d, "2024-01-11"); // antes de esa fecha la sigla era de otro producto
});

test("cierres: controles de salto, de atraso y de serie vacía", () => {
  assert.match(checkSeries({ c: [100, 45, 46], last: "2026-10-02" }, today), /salto/);
  assert.match(checkSeries({ c: [100, 101], last: "2026-09-25" }, today), /atrasado/);
  assert.equal(checkSeries({ c: [100, 101], last: "2026-09-29" }, today), ""); // 4 sesiones: todavía vale
  assert.match(checkSeries({ c: [], last: null }, today), /sin cierres/);
});

test("cierres: un split sin ajustar en un tramo se recompone a la escala de hoy", () => {
  // Como XLE: parte antigua a la mitad, un tramo sin ajustar y, tras el split, el precio de hoy.
  const { closes, fixes } = repairSplits([40, 41, 82, 84, 43, 44], ["d1", "d2", "d3", "d4", "d5", "d6"]);
  assert.deepEqual(closes, [40, 41, 41, 42, 43, 44]);
  assert.deepEqual(fixes, ["×2 el d3", "÷2 el d5"]);
  // El split coincide con un día movido: 0,5 × (1 − 6 %) sigue siendo un split.
  assert.deepEqual(repairSplits([100, 47]).closes, [50, 47]);
  // Un salto grande que no es múltiplo (−45 %, ×1,6) no se toca: lo para el control.
  assert.deepEqual(repairSplits([100, 55]).closes, [100, 55]);
  assert.deepEqual(repairSplits([100, 160]).fixes, []);
  // Los movimientos normales no se tocan.
  assert.deepEqual(repairSplits([100, 130, 80]).closes, [100, 130, 80]);
});

test("cierres: la serie recompuesta pasa el control y la rota no", () => {
  const row = (date, close) => ({ date, open: close, high: close, low: close, close, volume: 1 });
  const body = { data: [row("2026-09-28", 40.99), row("2026-09-29", 81.99), row("2026-09-30", 83), row("2026-10-01", 41.2), row("2026-10-02", 41.5)] };
  const series = toSeries("XYZ", body, today);
  assert.deepEqual(series.c, [40.99, 41, 41.5, 41.2, 41.5]);
  assert.equal(series.fixes.length, 2);
  assert.equal(checkSeries(series, today), "");
  const broken = toSeries("XYZ", { data: [row("2026-10-01", 100), row("2026-10-02", 55)] }, today);
  assert.match(checkSeries(broken, today), /salto/);
});

test("ficha: las cuentas de un bull put concreto, sin aplicar reglas", () => {
  const row = spreadRow(sym, "2026-10-30", 95, 85, 1.4, today);
  assert.equal(row.status, "ok");
  assert.equal(row.width, 10);
  assert.equal(row.credit, 2); // 2,40 − 0,40
  assert.equal(row.net, 198.6);
  assert.equal(row.loss, 801.4);
  assert.equal(row.breakeven, 93.01); // 95 − 1,986
  assert.equal(row.expiryLabel.length > 0, true);
  const target = Math.ceil(marketProbs(sym.x[0][2])[3]);
  const same = equalRisk(sym, { prob: target, width: 10, expiry: "2026-10-30", fee: 1.4 }, today);
  assert.deepEqual({ ...same, sym: null }, { ...row, sym: null }); // la pestaña y la ficha hacen la misma cuenta
  assert.equal(spreadRow(sym, "2026-10-30", 95, 91, 0, today).status, "sin-ancho");
  assert.equal(spreadRow(sym, "2026-10-30", 96, 91, 0, today).status, "sin-strike");
});

test("ficha: avisos de liquidez y rango de 52 semanas", () => {
  const gates = normalizeRules({}).gates;
  const row = spreadRow(sym, "2026-10-30", 90, 85, 0, today);
  assert.deepEqual(liquidityNotes(row, { ...gates, oiMin: 100, spreadPct: 50 }), []);
  assert.deepEqual(liquidityNotes(row, { ...gates, oiMin: 5000, spreadPct: 50 }), ["poco interés en el corto"]);
  assert.deepEqual(liquidityNotes(row, { ...gates, oiMin: 100, spreadPct: 10 }), ["horquilla ancha"]);
  const closes = [...Array.from({ length: 300 }, () => 500), 80, 120, 100];
  assert.deepEqual(yearRange(closes, 130), { min: 80, max: 500, sessions: 253 }); // las 252 últimas y el precio de hoy
  assert.equal(yearRange([90, 100, 95], 130).max, 130);
  assert.equal(yearRange(null, 100), null);
});

test("números a la española en los textos", () => {
  assert.equal(num(1142.85, 2), "1142,85"); // cuatro cifras, sin punto de millares
  assert.equal(num(12500, 0), "12.500");
  assert.equal(num(-0.48, 2), "−0,48");
  assert.equal(num(-0.001, 2), "0,00");
  assert.equal(num(5, 1), "5,0");
  const sp = assessSymbol(sym, R(), "equilibrio", today).best;
  assert.equal(spreadLine(sp), "90/85 · 30 oct · 10,0 % abajo · 12 % del ancho");
  assert.match(alertText(sp), / · rentab\. 14 %$/);
  assert.equal(rulesLine(normalizeRules({ v: 2, maxProb: 10, minDte: 20, maxDte: 30, width: 2.5, minCredit: 20, minBalance: 0.5 })), "prob. ≤10 % · 20–30 días · ancho ≤$2,5 · cobras ≥$20 · equilibrio ≥0,50");
});
