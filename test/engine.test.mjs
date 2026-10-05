import test from "node:test";
import assert from "node:assert/strict";
import { assessSymbol, balanceOf, favoriteDeals, ivFromPut, marketProbs, normalizeConfig, normalizeRules, probBelow, putPrice, rankUniverse } from "../web/engine.js";

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
