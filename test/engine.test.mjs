import test from "node:test";
import assert from "node:assert/strict";
import { alertText, fedInside, trendNotes, volatilities, gateReason, pricesOutsideMarket, num, rulesLine, spreadLine, liquidityNotes, spreadRow, yearRange, expectedLoss, historyStats, realizedVol, sessionsBetween, withHistory, commonExpiries, defaultExpiry, equalRisk, equalRiskList, assessSymbol, balanceOf, favoriteDeals, ivFromPut, marketProbs, normalizeConfig, normalizeRules, probBelow, putPrice, rankUniverse } from "../web/engine.js";

import { checkSeries, repairSplits, toSeries } from "../scanner/cierres.mjs";
import { keepPrevious } from "../scanner/scan.mjs";

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
  // filtro por prob. de asignación: "hasta 9" deja solo los de 9 % o menos, y los que no tienen prob. no entran
  const probs = all.deals.map((row) => row.sp.prob).filter((p) => p != null).sort((a, b) => a - b);
  const cap = probs[Math.floor(probs.length / 2)];
  const calm = favoriteDeals([sym, other], ["XYZ", "ABC"], rules, "rentab", today, { maxProb: cap });
  assert.ok(calm.deals.length > 0 && calm.deals.length < all.deals.length && calm.deals.every((row) => row.sp.prob != null && row.sp.prob <= cap));
  assert.equal(favoriteDeals([sym, other], ["XYZ", "ABC"], rules, "rentab", today, { maxProb: 0 }).deals.length, all.deals.length);
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

// Un nombre con horquilla estrecha (2 céntimos por pata), sin resultados: pasa las puertas de "Igual riesgo".
const tight = (s = "TGT", er = null, bid90 = 1.0) => ({
  ...sym,
  s,
  er,
  x: [["2026-10-30", 0.4, [[80, 0.1, 0.12, 500, 0.5, -0.03], [85, 0.3, 0.32, 800, 0.46, -0.08], [90, bid90, bid90 + 0.02, 1200, 0.42, -0.17], [95, 2.4, 2.42, 900, 0.4, -0.33]]]],
});
const tightOpts = (fee = 1.4, width = 5) => {
  const probs = marketProbs(tight().x[0][2]);
  return { prob: Math.ceil(probs[2] * 10) / 10, width, expiry: "2026-10-30", fee };
};

test("igual riesgo: orden por rentabilidad neta sin cierres, sin precio al final; fecha común", () => {
  const opts = tightOpts();
  const rich = tight("RICH", null, 1.3);
  const none = { ...tight("NONE"), x: [["2026-11-27", 0.4, tight().x[0][2]]] };
  const { rows, out, gated } = equalRiskList([tight(), none, rich], opts, today);
  assert.deepEqual(rows.map((row) => row.sym.s), ["RICH", "TGT"]);
  assert.deepEqual(out.map((row) => row.sym.s), ["NONE"]);
  assert.equal(gated.length, 0);
  const list = commonExpiries([sym, rich, none], normalizeRules({ minDte: 10, maxDte: 60 }), today);
  assert.equal(defaultExpiry(list), "2026-10-30");
  assert.equal(list.length, 2);
});

test("igual riesgo: el largo no tiene que dar el ancho exacto, pero nunca pasa de él", () => {
  const opts = tightOpts(1.4, 7); // corto 90: entre 83 y 90 solo está el 85
  const row = equalRisk(tight(), opts, today);
  assert.equal(row.status, "ok");
  assert.equal(`${row.shortStrike}/${row.longStrike}`, "90/85");
  assert.equal(row.width, 5);
  // el ancho elegido de 5 deja el 85; con 4 no hay strike entre 86 y 90
  assert.equal(equalRisk(tight(), tightOpts(1.4, 4), today).status, "sin-ancho");
  // con varios strikes dentro del ancho, el más bajo (el ancho más grande que cabe)
  const dense = { ...tight(), x: [["2026-10-30", 0.4, [[84, 0.2, 0.22, 9, 0.47, -0.07], [85, 0.3, 0.32, 9, 0.46, -0.08], [87.5, 0.6, 0.62, 9, 0.44, -0.12], [89, 0.8, 0.82, 9, 0.43, -0.15], [90, 1.0, 1.02, 9, 0.42, -0.17]]]] };
  const densePick = { ...tightOpts(1.4, 5.5), prob: Math.ceil(marketProbs(dense.x[0][2])[4] * 10) / 10 };
  const wide = equalRisk(dense, densePick, today);
  assert.equal(wide.status, "ok");
  assert.equal(wide.longStrike, 85); // 84 queda a 6 del corto: se pasa
  assert.equal(wide.width, 5);
  // si el más bajo no tiene precio, se usa el siguiente
  const noAsk = { ...dense, x: [["2026-10-30", 0.4, dense.x[0][2].map((r) => (r[0] === 85 ? [85, 0.3, 0, 9, 0.46, -0.08] : r))]] };
  assert.equal(equalRisk(noAsk, densePick, today).longStrike, 87.5);
});

test("igual riesgo: horquilla y coste de ida y vuelta del spread", () => {
  const row = equalRisk(tight(), tightOpts(1.4), today);
  assert.equal(row.gap, 0.04); // 0,02 del corto + 0,02 del largo
  assert.equal(row.midCredit, 0.7); // 1,01 − 0,31
  assert.equal(row.roundTrip, 6.8); // 0,04 × 100 + 2 × 1,40
  assert.equal(row.net, 66.6); // 68 − 1,40
  assert.equal(gateReason(row), "");
});

test("igual riesgo: las puertas apartan lo que no se puede comparar, en su orden", () => {
  // horquilla: 0,20 frente a un crédito medio de 0,70 (28,6 %): pasa con el 35 % de fábrica y no con el 25 %
  const wide = equalRisk(sym, tightOpts(1.4), today);
  assert.equal(wide.status, "ok");
  assert.equal(gateReason(wide), "");
  assert.equal(gateReason(wide, 25), "horquilla ancha: precio poco fiable");
  // 0,50 de horquilla frente a un crédito medio de 0,95 (53 %): se aparta con el límite de fábrica
  const wideRows = tight().x[0][2].map((r) => (r[0] === 90 ? [90, 1.2, 1.5, 1200, 0.42, -0.17] : r[0] === 85 ? [85, 0.3, 0.5, 800, 0.46, -0.08] : r));
  const veryWide = equalRisk({ ...tight(), x: [["2026-10-30", 0.4, wideRows]] }, { ...tightOpts(1.4), prob: Math.ceil(marketProbs(wideRows)[2] * 10) / 10 }, today);
  assert.equal(veryWide.status, "ok");
  assert.equal(gateReason(veryWide), "horquilla ancha: precio poco fiable");
  assert.equal(gateReason(veryWide, 70), ""); // con un límite más holgado entra
  // el cobro no cubre salir: 68 − 40 de comisión = 28, frente a 4 + 80 de ida y vuelta
  const dear = equalRisk(tight(), tightOpts(40), today);
  assert.equal(gateReason(dear), "no cubre el coste de salir");
  // sin precio medio (sin ask del corto o sin bid del largo) la horquilla no es fiable
  assert.equal(gateReason({ status: "ok", probSrc: "mercado", gap: null, midCredit: null, net: 50, roundTrip: null }), "horquilla ancha: precio poco fiable");
  assert.equal(gateReason({ status: "ok", probSrc: "mercado", gap: 0.01, midCredit: 0, net: 50, roundTrip: 3 }), "horquilla ancha: precio poco fiable"); // crédito medio ≤ 0
  // el orden de las puertas: la fórmula de reserva manda sobre la horquilla
  assert.equal(gateReason({ ...wide, probSrc: "formula" }), "prob. sin medir en el mercado");
  // en la lista, las apartadas salen en `gated` con su motivo y no entran en `rows`
  const { rows, gated } = equalRiskList([tight(), sym, { ...tight("DEAR") }], { ...tightOpts(1.4), gapPct: 25 }, today);
  assert.deepEqual(rows.map((row) => row.sym.s).sort(), ["DEAR", "TGT"]);
  assert.deepEqual(gated.map((row) => [row.sym.s, row.gate]), [["XYZ", "horquilla ancha: precio poco fiable"]]);
  const costly = equalRiskList([tight()], tightOpts(40), today);
  assert.equal(costly.rows.length, 0);
  assert.equal(costly.gated[0].gate, "no cubre el coste de salir");
});

test("igual riesgo: los resultados en el plazo marcan la fila, no la apartan", () => {
  const withEarn = tight("ERN", { d: "2026-10-28", x: "fecha estimada" }, 1.3);
  const { rows, gated } = equalRiskList([tight(), withEarn], tightOpts(1.4), today);
  assert.deepEqual(rows.map((row) => row.sym.s), ["ERN", "TGT"]); // en la misma lista y en el mismo orden (cobra más)
  assert.equal(rows[0].earnInside, true);
  assert.equal(rows[1].earnInside, false);
  assert.equal(gated.length, 0);
  // con una puerta fallida, la fila va a las apartadas y conserva la marca de resultados
  const both = equalRiskList([{ ...sym }], { ...tightOpts(1.4), gapPct: 25 }, today);
  assert.equal(both.rows.length, 0);
  assert.equal(both.gated.length, 1);
  assert.equal(both.gated[0].earnInside, true);
});

test("precios del barrido de fuera del horario de mercado, con 15 minutos de retraso", () => {
  const ny = (iso) => Date.parse(iso); // las horas van en UTC: en octubre Nueva York va 4 horas por detrás
  assert.equal(pricesOutsideMarket(ny("2026-10-05T19:00:00Z")), false); // 15:00
  assert.equal(pricesOutsideMarket(ny("2026-10-05T20:10:00Z")), false); // 16:10: los precios son de las 15:55
  assert.equal(pricesOutsideMarket(ny("2026-10-05T20:20:00Z")), true); // 16:20: de las 16:05
  assert.equal(pricesOutsideMarket(ny("2026-10-05T13:40:00Z")), true); // 9:40: de las 9:25
  assert.equal(pricesOutsideMarket(ny("2026-10-05T13:50:00Z")), false); // 9:50: de las 9:35
  assert.equal(pricesOutsideMarket(ny("2026-10-03T16:00:00Z")), true); // sábado
  assert.equal(pricesOutsideMarket(ny("2026-11-26T17:00:00Z")), true); // Acción de Gracias
  assert.equal(pricesOutsideMarket(0), false);
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

test("igual riesgo con historia: se espera pagar la media, rentab. esperada y orden", () => {
  const opts = tightOpts();
  const walk = (n, step) => Array.from({ length: n }, (_, i) => 100 * (1 + step * (i % 2)));
  const calm = { d: "2021-10-05", c: walk(1300, 0.02) };
  const wild = { d: "2025-06-02", c: walk(300, 0.2) };
  const row = withHistory(equalRisk(tight(), opts, today), calm, today);
  assert.equal(row.sessions, 19);
  assert.equal(row.histProb, 0); // con ±2 % nunca acaba por debajo de 90
  assert.equal(row.histLoss, 0);
  assert.equal(row.shortHistory, false);
  assert.ok(row.recentLoss > 1 && row.recentLoss < 500);
  // la media de los dos cálculos, no la mayor
  assert.equal(row.expected, Math.round(((row.histLoss + row.recentLoss) / 2) * 100) / 100);
  assert.ok(row.expected < row.recentLoss && row.expected > row.histLoss);
  assert.equal(row.retExp, Math.round(((row.net - row.expected) / row.loss) * 1000) / 10);
  assert.equal(row.balanceHist, Math.round((row.net / row.expected) * 10) / 10); // un decimal
  assert.equal(row.distinct, true); // 0 frente a algo: más de 3 veces
  // con otra historia, la nota sale según la regla: el mayor, más de 3 veces el menor
  const moved = withHistory(equalRisk(tight(), opts, today), wild, today);
  assert.equal(moved.distinct, Math.max(moved.histLoss, moved.recentLoss) > 3 * Math.min(moved.histLoss, moved.recentLoss));
  assert.equal(moved.shortHistory, true);
  assert.ok(moved.histProb > 0);
  // el orden: rentab. esperada de mayor a menor; sin cierres, detrás y por rentab. neta
  const other = { ...tight("WILD"), x: tight().x };
  const rich = tight("RICH", null, 1.3);
  const { rows } = equalRiskList([other, tight(), rich], { ...opts, hist: { TGT: calm, WILD: wild } }, today);
  assert.deepEqual(rows.map((r) => r.sym.s), ["TGT", "WILD", "RICH"]); // RICH no tiene cierres: va detrás aunque cobre más
  assert.ok(rows[0].retExp > rows[1].retExp);
  assert.equal(rows[2].retExp, undefined);
  assert.ok(rows[2].ret > rows[0].ret);
  // el equilibrio ya no ordena: un nombre con más equilibrio puede ir detrás si su rentab. esperada es menor
  const none = equalRiskList([tight()], { ...opts, hist: {} }, today).rows[0];
  assert.equal(none.balanceHist, undefined); // sin cierres de ese nombre, la fila sale igual que sin historia
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

test("barrido: con el mercado cerrado se conserva el último barrido de mercado abierto", () => {
  const open = Date.parse("2026-10-05T18:00:00Z"); // 14:00 en Nueva York
  const closed = Date.parse("2026-10-05T21:40:00Z"); // 17:40
  const morning = Date.parse("2026-10-06T13:07:00Z"); // 9:07, antes de abrir
  assert.equal(keepPrevious(open, closed), true);
  assert.equal(keepPrevious(open, morning), true); // al día siguiente, antes de abrir, también
  assert.equal(keepPrevious(open, Date.parse("2026-10-06T15:00:00Z")), false); // abierto: se barre
  assert.equal(keepPrevious(closed, morning), false); // el guardado ya es de mercado cerrado: no es mejor
  assert.equal(keepPrevious(undefined, closed), false); // sin barrido anterior se barre
  assert.equal(keepPrevious(open, closed, { replace: true }), false); // a mano, con "reemplazar"
  assert.equal(keepPrevious(open, Date.parse("2026-10-03T16:00:00Z")), true); // fin de semana
});

test("igual riesgo: marca \"solo con un cálculo\" cuando los dos cálculos tienen distinto signo", () => {
  const opts = tightOpts();
  const row0 = equalRisk(tight(), opts, today);
  // Cada 100 sesiones, 30 con el precio un 20 % más bajo; las últimas 100 son tranquilas.
  const blocks = [];
  for (let b = 0; b < 12; b++) for (let i = 0; i < 100; i++) blocks.push(i < 70 ? 100 * (1 + 0.001 * (i % 2)) : 80);
  for (let i = 0; i < 100; i++) blocks.push(100 * (1 + 0.001 * (i % 2)));
  const split = withHistory(row0, { d: "2021-01-04", c: blocks }, today);
  assert.ok(split.marginHist < 0 && split.marginRecent > 0, `${split.marginHist} ${split.marginRecent}`); // con historia pierde, con lo reciente gana
  assert.equal(split.marginHist, Math.round((row0.net - split.histLoss) * 100) / 100);
  assert.equal(split.marginRecent, Math.round((row0.net - split.recentLoss) * 100) / 100);
  assert.equal(split.onlyOne, true);
  assert.equal(split.distinct, true); // también son muy distintas; la vista enseña solo la marca más fuerte
  assert.ok(split.expected > 0 && Math.abs(split.expected - (split.histLoss + split.recentLoss) / 2) < 0.011); // sigue siendo la media
  // mismo signo: tranquila hace años y ahora → no hay marca
  const calm = { d: "2021-01-04", c: Array.from({ length: 1300 }, (_, i) => 100 * (1 + 0.001 * (i % 2))) };
  const same = withHistory(row0, calm, today);
  assert.ok(same.marginHist > 0 && same.marginRecent > 0);
  assert.equal(same.onlyOne, false);
  // el orden no cambia por la marca: sigue siendo la rentab. esperada
  assert.equal(split.retExp, Math.round(((row0.net - split.expected) / row0.loss) * 1000) / 10);
});

test("volatilidad de 5 años: desviación de los rendimientos diarios de todos los cierres, con √252", () => {
  const a = Math.log(1.1);
  const v = volatilities([100, 110, 100]);
  assert.ok(Math.abs(v.long - a * Math.sqrt(504)) < 1e-9);
  assert.equal(v.recent, null); // menos de 20 sesiones: no hay volatilidad reciente
  const closes = Array.from({ length: 400 }, (_, i) => 100 + 10 * Math.sin(i / 7) + (i % 3));
  const w = volatilities(closes);
  assert.equal(w.longPct, Math.round(realizedVol(closes, closes.length - 1) * 1000) / 10);
  assert.equal(w.recent, Math.max(realizedVol(closes, 20), realizedVol(closes, 60))); // la misma que usa la pérdida reciente
  assert.equal(volatilities([100]), null);
  const row = withHistory(equalRisk(tight(), tightOpts(), today), { d: "2021-01-04", c: closes }, today);
  assert.equal(row.vol5, w.longPct);
  assert.equal(row.vol, w.recentPct);
});

test("notas de tendencia: en mínimos del año y bajo su media de 200", () => {
  const ramp = Array.from({ length: 300 }, (_, i) => 100 + i / 3); // sube de 100 a ~200
  assert.deepEqual(trendNotes(ramp, 105), ["en mínimos del año", "bajo su media de 200"]);
  assert.deepEqual(trendNotes(ramp, 195), []); // arriba del rango y de la media
  // solo bajo la media: 100 sesiones a 50 y 200 a 100; a 98 no está en el 10 % bajo del rango
  const step = [...Array(100).fill(50), ...Array(200).fill(100)];
  assert.deepEqual(trendNotes(step, 98), ["bajo su media de 200"]);
  // con menos de 200 cierres no hay media de 200
  assert.deepEqual(trendNotes(Array(150).fill(100).map((x, i) => (i === 0 ? 150 : x)), 120), []);
  assert.deepEqual(trendNotes(null, 100), []);
  // la nota llega a la fila
  const row = withHistory(equalRisk(tight(), tightOpts(), today), { d: "2021-01-04", c: ramp.map((x) => x * (100 / 105)) }, today);
  assert.deepEqual(row.trend, ["en mínimos del año", "bajo su media de 200"]);
});

test("Fed: decisión entre hoy y el vencimiento, solo en bonos largos y bolsa de EE. UU.", () => {
  assert.deepEqual(fedInside("2026-10-06", "2026-11-20"), ["2026-10-28"]);
  assert.deepEqual(fedInside("2026-10-06", "2026-10-23"), []); // el vencimiento llega antes
  assert.deepEqual(fedInside("2026-10-06", "2026-12-31"), ["2026-10-28", "2026-12-09"]);
  assert.deepEqual(fedInside("2026-10-28", "2026-10-30"), ["2026-10-28"]); // el mismo día cuenta
  assert.deepEqual(fedInside("2026-10-29", "2026-11-20"), []); // ya pasó
  const at = (b, now = today) => spreadRow({ ...tight(), b }, "2026-10-30", 90, 85, 1.4, now);
  assert.deepEqual(at("Bonos largos").fed, ["2026-10-28"]);
  assert.deepEqual(at("Bolsa EE. UU.").fed, ["2026-10-28"]);
  assert.deepEqual(at("Energía").fed, []); // otro bloque: sin aviso
  assert.deepEqual(at("Bonos largos", "2026-10-29").fed, []); // la decisión ya pasó
});

test("reglas: la horquilla máxima de Igual riesgo, 35 % de fábrica y entre 10 y 100", () => {
  assert.equal(normalizeRules({}).equalGapPct, 35);
  assert.equal(normalizeRules({ equalGapPct: 50 }).equalGapPct, 50);
  assert.equal(normalizeRules({ equalGapPct: 3 }).equalGapPct, 10);
  assert.equal(normalizeRules({ equalGapPct: 500 }).equalGapPct, 100);
  assert.equal(normalizeRules({ equalGapPct: "x" }).equalGapPct, 35);
  assert.equal(normalizeConfig({ rules: { equalGapPct: 40 } }).rules.equalGapPct, 40);
  // en la lista, el límite de las reglas decide quién se aparta
  const strict = equalRiskList([sym], { ...tightOpts(1.4), gapPct: 25 }, today);
  const loose = equalRiskList([sym], { ...tightOpts(1.4), gapPct: 35 }, today);
  assert.equal(strict.gated.length, 1);
  assert.equal(loose.rows.length, 1);
});
