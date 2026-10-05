// Motor de Centinela. Lo usan la app (para filtrar y ordenar al instante)
// y el barrido (para decidir los avisos). Sin dependencias.
//
// Hoy solo hay una estrategia: bull put. Para añadir otra (iron condor,
// bear call) se añade un constructor de spreads como buildBullPuts y se
// registra en STRATEGIES; el resto (reglas, orden, avisos) ya es común.

export const RATE = 0.04; // tipo sin riesgo de la fórmula de reserva de la prob. de asignación

// Versión de las reglas. La 2 fija el riesgo con la prob. de asignación (la misma
// vara para todos los nombres) en vez de con "% abajo" y "% del ancho".
export const RULES_V = 2;

export const DEFAULT_RULES = {
  v: RULES_V,
  minDte: 20,
  maxDte: 30,
  maxProb: 10, // prob. de asignación máxima: la regla que elige el corto. 50 = sin límite
  otmOn: false, // limitar además el % abajo
  minOtm: 8, // % abajo, desde
  maxOtm: 12, // % abajo, hasta
  width: 5, // ancho máximo: vale ese y cualquiera menor
  minCredit: 20, // cobras, mínimo, en dólares por contrato; 0 = sin mínimo
  minBalance: 0.5, // equilibrio mínimo; 0 = sin mínimo
  gates: {
    event: false,
    liquid: false,
    oiMin: 100,
    spreadPct: 10,
    loss: false,
    lossMin: 100,
    lossMax: 300,
    room: false,
  },
};

export const DEFAULT_CONFIG = {
  savedAt: 0,
  strategy: "bullPut",
  rules: DEFAULT_RULES,
  order: "equilibrio",
  favorites: ["AAPL", "NVDA", "MSFT", "SPY"],
  extra: [],
  alerts: { favorites: true, universeTop: 0 },
};

export const ORDERS = [
  { id: "equilibrio", label: "Equilibrio", hint: "Lo que esperas ganar por cada dólar que esperas perder. Sube con la rentabilidad y baja con la probabilidad de asignación." },
  { id: "rentab", label: "Rentabilidad", hint: "Crédito partido por la pérdida máxima." },
  { id: "prob", label: "Prob. asignación", hint: "La más baja primero. Sale de los precios del mercado." },
  { id: "abajo", label: "% abajo", hint: "El corto más lejos del precio primero." },
  { id: "credito", label: "Crédito", hint: "Lo que más cobra por contrato primero." },
];

export const PROB_OFF = 50;
export const MAX_FAVORITES = 40;

// ---------- utilidades ----------

const r1 = (n) => Math.round(n * 10) / 10;
const r2 = (n) => Math.round(n * 100) / 100;

function clamp(value, min, max, fallback) {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function cleanSymbol(raw) {
  if (typeof raw !== "string") return null;
  const symbol = raw.trim().toUpperCase();
  return /^[A-Z][A-Z0-9.-]{0,7}$/.test(symbol) ? symbol : null;
}

function symbolList(value, max) {
  const out = [];
  if (!Array.isArray(value)) return out;
  for (const raw of value) {
    const symbol = cleanSymbol(raw);
    if (symbol && !out.includes(symbol)) out.push(symbol);
    if (out.length >= max) break;
  }
  return out;
}

export function normalizeRules(input) {
  const row = input && typeof input === "object" ? input : {};
  const base = DEFAULT_RULES;
  const g = row.gates && typeof row.gates === "object" ? row.gates : {};
  const minDte = Math.round(clamp(row.minDte, 5, 60, base.minDte));
  const maxDte = Math.max(minDte, Math.round(clamp(row.maxDte, 5, 60, base.maxDte)));
  const minOtm = clamp(row.minOtm, 1, 30, base.minOtm);
  const maxOtm = Math.max(minOtm, clamp(row.maxOtm, 1, 35, base.maxOtm));
  const lossMin = clamp(g.lossMin, 20, 2000, base.gates.lossMin);
  const lossMax = Math.max(lossMin, clamp(g.lossMax, 20, 5000, base.gates.lossMax));
  // Reglas guardadas antes de la versión 2: la prob. máxima estaba apagada de fábrica
  // y el crédito mínimo iba en % del ancho. Pasan a los valores de fábrica nuevos.
  const old = row.v !== RULES_V;
  const maxProb = old && !(Number(row.maxProb) < PROB_OFF) ? base.maxProb : clamp(row.maxProb, 1, PROB_OFF, base.maxProb);
  return {
    v: RULES_V,
    minDte,
    maxDte,
    maxProb,
    otmOn: !old && row.otmOn === true,
    minOtm,
    maxOtm,
    width: clamp(row.width, 1, 50, base.width),
    minCredit: Math.round(clamp(row.minCredit, 0, 500, base.minCredit)),
    minBalance: Math.round(clamp(row.minBalance, 0, 1.5, base.minBalance) * 100) / 100,
    gates: {
      event: g.event === true,
      liquid: g.liquid === true,
      oiMin: Math.round(clamp(g.oiMin, 0, 5000, base.gates.oiMin)),
      spreadPct: clamp(g.spreadPct, 5, 100, base.gates.spreadPct),
      loss: g.loss === true,
      lossMin,
      lossMax,
      room: g.room === true,
    },
  };
}

export function normalizeConfig(input) {
  const row = input && typeof input === "object" ? input : {};
  const alerts = row.alerts && typeof row.alerts === "object" ? row.alerts : {};
  const favorites = Array.isArray(row.favorites)
    ? symbolList(row.favorites, MAX_FAVORITES)
    : [...DEFAULT_CONFIG.favorites];
  return {
    savedAt: typeof row.savedAt === "number" && Number.isFinite(row.savedAt) ? row.savedAt : 0,
    strategy: "bullPut",
    rules: normalizeRules(row.rules),
    order: ORDERS.some((o) => o.id === row.order) ? row.order : "equilibrio",
    favorites,
    extra: symbolList(row.extra, 200),
    off: symbolList(row.off, 200), // nombres de la lista que él ha quitado de su selección
    alerts: {
      favorites: alerts.favorites !== false,
      universeTop: 0, // ya no hay universo: solo avisan los favoritos
    },
  };
}

export function nyToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function daysBetween(from, to) {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  return Math.round((end - start) / 86_400_000);
}

export function labelOf(iso) {
  const [year, month, day] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short", timeZone: "UTC" }).format(
    new Date(Date.UTC(year, (month ?? 1) - 1, day)),
  );
}

function normCdf(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp((-x * x) / 2);
  const p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x > 0 ? 1 - p : p;
}

/** Probabilidad de que el precio acabe por debajo del strike al vencimiento,
 *  según la volatilidad implícita de ese strike. En %. */
export function probBelow(price, strike, dte, iv) {
  if (!(price > 0) || !(strike > 0) || !(iv > 0)) return null;
  const t = Math.max(dte, 0.5) / 365;
  const d2 = (Math.log(price / strike) + (RATE - (iv * iv) / 2) * t) / (iv * Math.sqrt(t));
  return normCdf(-d2) * 100;
}

/** Precio teórico de una put (Black-Scholes, sin dividendos). */
export function putPrice(price, strike, dte, iv) {
  const t = Math.max(dte, 0.5) / 365;
  const d1 = (Math.log(price / strike) + (RATE + (iv * iv) / 2) * t) / (iv * Math.sqrt(t));
  const d2 = d1 - iv * Math.sqrt(t);
  return strike * Math.exp(-RATE * t) * normCdf(-d2) - price * normCdf(-d1);
}

/** Volatilidad implícita de una put a partir de su precio, por bisección.
 *  Sirve cuando la fuente da precios pero no la volatilidad. */
export function ivFromPut(price, strike, dte, optionPrice) {
  if (!(price > 0) || !(strike > 0) || !(optionPrice > 0)) return null;
  let low = 0.01;
  let high = 4;
  if (putPrice(price, strike, dte, low) > optionPrice || putPrice(price, strike, dte, high) < optionPrice) return null;
  for (let i = 0; i < 60; i++) {
    const mid = (low + high) / 2;
    if (putPrice(price, strike, dte, mid) > optionPrice) high = mid;
    else low = mid;
  }
  return (low + high) / 2;
}

export function impliedMove(price, dte, iv) {
  const dollars = price * iv * Math.sqrt(Math.max(dte, 1) / 365);
  return { dollars, pct: (dollars / price) * 100 };
}

// ---------- cadena de CBOE ----------

const CBOE_MIN_DTE = 5;
const CBOE_MAX_DTE = 60;
const CBOE_FLOOR = 0.62; // se guardan puts desde el 62% del precio hasta el precio
const CBOE_MAX_ROWS = 1400; // por nombre; por encima, solo vencimientos de viernes

export function cboeUrl(symbol) {
  return `https://cdn.cboe.com/api/global/delayed_quotes/options/${encodeURIComponent(symbol)}.json`;
}

function numOf(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const n = Number(value.trim().replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function parseOcc(root, option) {
  if (!option.startsWith(root)) return null;
  const match = /^(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/.exec(option.slice(root.length));
  if (!match) return null;
  return { expiry: `20${match[1]}-${match[2]}-${match[3]}`, call: match[4] === "C", strike: Number(match[5]) / 1000 };
}

const roundTo = (n, digits) => Math.round(n * 10 ** digits) / 10 ** digits;

/** De la respuesta de CBOE a lo que guarda Centinela para un nombre. */
export function readCboeChain(symbol, body, today = nyToday()) {
  const data = body?.data;
  const price = numOf(data?.current_price) ?? numOf(data?.close);
  const options = Array.isArray(data?.options) ? data.options : [];
  if (!(price > 0)) return null;
  const root = symbol.replace(".", "");
  const floor = price * CBOE_FLOOR;
  const byExpiry = new Map();
  const atm = new Map();
  for (const row of options) {
    const parsed = parseOcc(root, typeof row?.option === "string" ? row.option : "");
    if (!parsed || parsed.call) continue;
    const dte = daysBetween(today, parsed.expiry);
    if (dte < CBOE_MIN_DTE || dte > CBOE_MAX_DTE) continue;
    const ivRaw = numOf(row.iv);
    const iv = ivRaw != null && ivRaw > 0.01 && ivRaw <= 3 ? ivRaw : null;
    const dist = Math.abs(parsed.strike - price);
    if (iv != null && dist / price <= 0.08) {
      const prev = atm.get(parsed.expiry);
      if (!prev || dist < prev.dist) atm.set(parsed.expiry, { iv, dist });
    }
    if (parsed.strike >= price || parsed.strike < floor) continue;
    const ask = numOf(row.ask);
    if (!(ask > 0)) continue;
    const bid = numOf(row.bid) ?? 0;
    const deltaRaw = numOf(row.delta);
    const delta = deltaRaw != null && deltaRaw < 0 && deltaRaw >= -1 ? deltaRaw : 0;
    const list = byExpiry.get(parsed.expiry) ?? new Map();
    const oi = Math.round(numOf(row.open_interest) ?? 0);
    const prev = list.get(parsed.strike);
    if (!prev || oi > prev[3]) {
      list.set(parsed.strike, [parsed.strike, roundTo(bid, 2), roundTo(ask, 2), oi, iv == null ? 0 : roundTo(iv, 3), roundTo(delta, 3)]);
    }
    byExpiry.set(parsed.expiry, list);
  }
  let expiries = [...byExpiry.keys()].sort();
  const count = (list) => list.reduce((sum, expiry) => sum + byExpiry.get(expiry).size, 0);
  if (count(expiries) > CBOE_MAX_ROWS) {
    const fridays = expiries.filter((iso) => new Date(`${iso}T12:00:00Z`).getUTCDay() === 5);
    if (fridays.length) expiries = fridays;
  }
  return {
    s: symbol,
    k: data?.security_type === "stock" || !data?.security_type ? "stock" : String(data.security_type),
    p: roundTo(price, 2),
    c: roundTo(numOf(data?.price_change_percent) ?? 0, 2),
    iv30: numOf(data?.iv30) == null ? null : roundTo(numOf(data.iv30), 1),
    t: typeof data?.last_trade_time === "string" ? data.last_trade_time : null,
    x: expiries.map((expiry) => [expiry, roundTo(atm.get(expiry)?.iv ?? 0, 3), [...byExpiry.get(expiry).values()].sort((a, b) => a[0] - b[0])]),
  };
}

// ---------- bull put ----------

// Fila de la cadena: [strike, bid, ask, interés abierto, iv, delta]
const K = 0, BID = 1, ASK = 2, OI = 3, IV = 4, DELTA = 5;

/** Puts largos posibles para un corto: todos los que dejan un ancho igual o
 *  menor que el máximo. Si la cadena no tiene ninguno (strikes más separados
 *  que el ancho pedido), devuelve el más cercano para poder decir por qué no pasa. */
function longLegs(rows, shortStrike, maxWidth) {
  const inside = [];
  let nearest = null;
  for (const leg of rows) {
    if (leg[K] >= shortStrike) continue;
    if (!(leg[ASK] > 0)) continue;
    const width = shortStrike - leg[K];
    if (width < 0.5 - 1e-9) continue;
    if (width <= maxWidth + 1e-9) inside.push(leg);
    if (!nearest || leg[K] > nearest[K]) nearest = leg;
  }
  if (inside.length) return inside;
  return nearest ? [nearest] : [];
}

/** Orden en que se comprueban las reglas. La etapa de un spread es cuántas
 *  ha superado seguidas; sirve para el embudo y para elegir "lo más cerca". */
export const STAGES = ["prob", "abajo", "ancho", "credito", "equilibrio", "interruptores"];

/** Prob. de asignación que descuenta el mercado en cada strike de un vencimiento:
 *  lo que cambia el precio del put al subir un dólar el strike, medido con los dos
 *  strikes vecinos y a precio medio. Es la misma cuenta que "crédito / ancho" de un
 *  spread estrecho. Devuelve un % por fila (o null si no hay precios para medirlo).
 *  Los precios traen ruido, así que se alisa para que nunca baje al subir el strike. */
export function marketProbs(rows) {
  const mid = rows.map((row) => (row[ASK] > 0 && row[BID] >= 0 ? (row[BID] + row[ASK]) / 2 : null));
  const raw = rows.map((row, i) => {
    if (mid[i] == null) return null;
    let lo = i - 1;
    while (lo >= 0 && mid[lo] == null) lo--;
    let hi = i + 1;
    while (hi < rows.length && mid[hi] == null) hi++;
    const a = hi < rows.length ? hi : i;
    const b = lo >= 0 ? lo : i;
    if (a === b) return null;
    const slope = (mid[a] - mid[b]) / (rows[a][K] - rows[b][K]);
    return Math.min(1, Math.max(0, slope));
  });
  // Ajuste monótono (medias de tramos vecinos que se contradicen).
  const blocks = [];
  raw.forEach((value, i) => {
    if (value == null) return;
    blocks.push({ sum: value, n: 1, from: i, to: i });
    while (blocks.length > 1 && blocks.at(-2).sum / blocks.at(-2).n > blocks.at(-1).sum / blocks.at(-1).n) {
      const last = blocks.pop();
      const prev = blocks.at(-1);
      prev.sum += last.sum;
      prev.n += last.n;
      prev.to = last.to;
    }
  });
  const out = raw.map(() => null);
  for (const block of blocks) {
    const value = (block.sum / block.n) * 100;
    for (let i = block.from; i <= block.to; i++) if (raw[i] != null) out[i] = value > 0 ? value : null;
  }
  return out;
}

function buildBullPuts(sym, rules, today) {
  const gates = rules.gates;
  const out = [];
  for (const [expiry, atmIv, rows] of sym.x ?? []) {
    const dte = daysBetween(today, expiry);
    if (dte < rules.minDte || dte > rules.maxDte) continue;
    const byMarket = marketProbs(rows);
    // Lo que queda muy lejos de las reglas ni se lista: demasiado riesgo por arriba,
    // demasiado poco que cobrar por abajo.
    const probCap = Math.max(rules.maxProb * 2, rules.maxProb + 10);
    const bidFloor = Math.max(5, rules.minCredit / 2) / 100;
    for (let index = 0; index < rows.length; index++) {
      const short = rows[index];
      const ks = short[K];
      const sb = short[BID];
      if (!(ks < sym.p) || !(sb > 0)) continue;
      const otm = ((sym.p - ks) / sym.p) * 100;
      if (rules.otmOn && (otm < rules.minOtm - 8 || otm > rules.maxOtm + 8)) continue;
      const shortIv = short[IV] > 0 ? short[IV] : null;
      const shortDelta = short[DELTA] < 0 ? short[DELTA] : null;
      const probModel = shortIv != null ? probBelow(sym.p, ks, dte, shortIv) : shortDelta != null ? Math.abs(shortDelta) * 100 : null;
      const probMarket = byMarket[index];
      const shortProb = probMarket ?? probModel;
      if (shortProb != null && shortProb > probCap) continue;
      if (sb < bidFloor - 1e-9) {
        // No se lista, pero cuenta para el embudo: pasa la probabilidad y se queda en el crédito.
        const inProb = rules.maxProb >= PROB_OFF || (shortProb != null && shortProb <= rules.maxProb + 1e-9);
        const inOtm = !rules.otmOn || (otm >= rules.minOtm - 1e-9 && otm <= rules.maxOtm + 1e-9);
        if (inProb && inOtm) out.tooCheap = true;
        continue;
      }
      for (const long of longLegs(rows, ks, rules.width)) {
        const width = r2(ks - long[K]);
        const credit = r2(sb - long[ASK]);
        if (credit <= 0) continue;
        const maxLoss = r2(width - credit);
        if (maxLoss <= 0) continue;

        const sa = short[ASK] > 0 ? short[ASK] : null;
        const lb = long[BID] >= 0 ? long[BID] : null;
        const la = long[ASK];
        const iv = shortIv;
        const delta = shortDelta;
        const prob = shortProb;
        const creditPct = (credit / width) * 100;
        const ret = (credit / maxLoss) * 100;
        const balance = balanceOf(ret, prob);
        const quoteGap = sa != null && lb != null ? r2(sa - sb + (la - lb)) : null;
        const midCredit = sa != null && lb != null ? (sb + sa) / 2 - (lb + la) / 2 : null;
        const moveIv = atmIv > 0 ? atmIv : iv;
        const move = moveIv != null ? impliedMove(sym.p, dte, moveIv) : null;
        const lossUsd = Math.round(maxLoss * 100);

        const fails = [];
        const fitsProb = rules.maxProb >= PROB_OFF || (prob != null && prob <= rules.maxProb + 1e-9);
        const fitsOtm = !rules.otmOn || (otm >= rules.minOtm - 1e-9 && otm <= rules.maxOtm + 1e-9);
        const fitsWidth = width <= rules.width + 1e-9;
        const fitsCredit = Math.round(credit * 100) >= rules.minCredit;
        if (!fitsProb) fails.push(prob == null ? "sin dato de probabilidad" : "probabilidad alta");
        if (!fitsOtm) fails.push("fuera del punto");
        if (!fitsWidth) fails.push(`ancho de $${fmtWidth(width)}`);
        if (!fitsCredit) fails.push("crédito corto");
        const fitsBalance = !(rules.minBalance > 0) || (balance != null && balance >= rules.minBalance - 1e-9);
        if (!fitsBalance) fails.push("equilibrio bajo");

        const gateFails = [];
        const earn = sym.er && sym.er.d ? sym.er : null;
        const earnDte = earn ? daysBetween(today, earn.d) : null;
        const earnInside = earnDte != null && earnDte >= 0 && earnDte <= dte + 2;
        if (gates.event && earnInside) gateFails.push(`resultados el ${labelOf(earn.d)}`);
        if (gates.liquid) {
          if (short[OI] < gates.oiMin) gateFails.push("poco interés en el corto");
          if (quoteGap != null && midCredit != null && midCredit > 0 && quoteGap > (midCredit * gates.spreadPct) / 100 + 1e-9) {
            gateFails.push("horquilla ancha");
          }
        }
        if (gates.loss) {
          if (lossUsd > gates.lossMax) gateFails.push("pérdida por encima del tope");
          else if (lossUsd < gates.lossMin) gateFails.push("pérdida por debajo del suelo");
        }
        if (gates.room && move && sym.p - ks < move.dollars / 2) gateFails.push("dentro del movimiento");

        const checks = [fitsProb, fitsOtm, fitsWidth, fitsCredit, fitsBalance, gateFails.length === 0];
        let stage = 0;
        while (stage < checks.length && checks[stage]) stage++;

        out.push({
          symbol: sym.s,
          expiry,
          expiryLabel: labelOf(expiry),
          dte,
          shortStrike: ks,
          longStrike: long[K],
          otm: r1(otm),
          width,
          credit,
          creditUsd: Math.round(credit * 100),
          creditPct: r1(creditPct),
          maxLoss,
          lossUsd,
          ret: r1(ret),
          prob: prob == null ? null : r1(prob),
          probSrc: prob == null ? null : probMarket != null ? "mercado" : "formula",
          probModel: probModel == null ? null : r1(probModel),
          balance,
          breakeven: r2(ks - credit),
          shortOi: short[OI] ?? 0,
          longOi: long[OI] ?? 0,
          shortBid: sb,
          shortAsk: sa,
          longBid: lb,
          longAsk: la,
          quoteGap,
          iv,
          delta,
          move: move ? { dollars: r2(move.dollars), pct: r1(move.pct) } : null,
          earnInside,
          fails: [...fails, ...gateFails],
          stage,
          ok: stage === checks.length,
        });
      }
    }
  }
  return out;
}

/** Fechas de vencimiento dentro del plazo de las reglas y cuántos nombres tienen cada una. */
export function commonExpiries(symbols, rules, today = nyToday()) {
  const count = new Map();
  for (const sym of symbols) {
    for (const [expiry] of sym.x ?? []) {
      const dte = daysBetween(today, expiry);
      if (dte < rules.minDte || dte > rules.maxDte) continue;
      count.set(expiry, (count.get(expiry) ?? 0) + 1);
    }
  }
  return [...count.entries()].map(([expiry, names]) => ({ expiry, names, label: labelOf(expiry) })).sort((a, b) => (a.expiry < b.expiry ? -1 : 1));
}

/** La fecha con más nombres (a igualdad, la más cercana). */
export function defaultExpiry(list) {
  return list.reduce((best, item) => (!best || item.names > best.names ? item : best), null)?.expiry ?? null;
}

/** "Igual riesgo": una fila por nombre con la misma prob. de asignación, ancho y vencimiento.
 *  Corto = el strike más alto cuya prob. (la de mercado, o la fórmula de reserva) no pasa del objetivo.
 *  Largo = el que deja exactamente el ancho. Crédito a precio natural; comisión por spread al abrir.
 *  No aplica crédito mínimo, equilibrio ni interruptores. Estados: ok, sin-strike, sin-ancho, sin-vencimiento, sin-precio. */
export function equalRisk(sym, opts, today = nyToday()) {
  const { prob: target, width, expiry, fee = 0 } = opts;
  const entry = (sym.x ?? []).find((item) => item[0] === expiry);
  if (!entry) return { sym, status: "sin-vencimiento", why: "Sin ese vencimiento" };
  const rows = entry[2];
  const dte = daysBetween(today, expiry);
  const market = marketProbs(rows);
  const probOf = (index) => {
    if (market[index] != null) return { value: market[index], src: "mercado" };
    const row = rows[index];
    const model = row[IV] > 0 ? probBelow(sym.p, row[K], dte, row[IV]) : row[DELTA] < 0 ? Math.abs(row[DELTA]) * 100 : null;
    return model == null ? { value: null, src: null } : { value: model, src: "formula" };
  };
  let shortIndex = -1;
  for (let i = 0; i < rows.length; i++) {
    if (!(rows[i][K] < sym.p)) continue;
    const p = probOf(i).value;
    if (p == null || p > target + 1e-9) continue;
    if (shortIndex < 0 || rows[i][K] > rows[shortIndex][K]) shortIndex = i;
  }
  if (shortIndex < 0) return { sym, status: "sin-strike", why: "Sin strike cerca: ninguno llega al objetivo" };
  const short = rows[shortIndex];
  const shortProb = probOf(shortIndex);
  if (shortProb.value < target - 3 - 1e-9) {
    return { sym, status: "sin-strike", why: `Sin strike cerca: el más próximo tiene ${r1(shortProb.value)} %`.replace(".", ",") };
  }
  const longIndex = rows.findIndex((row) => Math.abs(row[K] - (short[K] - width)) < 1e-6);
  if (longIndex < 0) return { sym, status: "sin-ancho", why: `Sin ese ancho: no hay strike en ${fmtStrike(short[K] - width)}` };
  const long = rows[longIndex];
  if (!(short[BID] > 0) || !(long[ASK] > 0)) return { sym, status: "sin-precio", why: "Sin precio: falta bid del corto o ask del largo" };
  const credit = r2(short[BID] - long[ASK]);
  if (credit <= 0) return { sym, status: "sin-precio", why: "Sin precio: a precio natural no hay crédito" };
  const net = credit * 100 - fee;
  const loss = width * 100 - net;
  if (!(loss > 0)) return { sym, status: "sin-precio", why: "Sin precio: el crédito iguala el ancho" };
  const longProb = probOf(longIndex).value;
  const earn = sym.er && sym.er.d ? sym.er : null;
  const earnDte = earn ? daysBetween(today, earn.d) : null;
  return {
    sym,
    status: "ok",
    expiry,
    dte,
    shortStrike: short[K],
    longStrike: long[K],
    otm: r1(((sym.p - short[K]) / sym.p) * 100),
    width,
    credit,
    prob: r1(shortProb.value),
    probSrc: shortProb.src,
    longProb: longProb == null ? null : r1(longProb),
    net: r2(net),
    loss: r2(loss),
    ret: r1((net / loss) * 100),
    earnInside: earnDte != null && earnDte >= 0 && earnDte <= dte + 2,
  };
}

/** Todas las filas: las que tienen precio, ordenadas (por rentabilidad neta, o por equilibrio con
 *  historia si se pasan cierres en `opts.hist`), y al final las que no. */
export function equalRiskList(symbols, opts, today = nyToday()) {
  const hist = opts.hist ?? null;
  const all = symbols.map((sym) => {
    const row = equalRisk(sym, opts, today);
    return hist ? withHistory(row, hist[sym.s], today) : row;
  });
  // Con historia manda el equilibrio con historia; las filas que no lo tienen van detrás.
  const rows = all
    .filter((row) => row.status === "ok")
    .sort((a, b) => (b.balanceHist != null) - (a.balanceHist != null) || (a.balanceHist != null ? b.balanceHist - a.balanceHist : 0) || b.ret - a.ret);
  const out = all.filter((row) => row.status !== "ok");
  return { rows, out };
}

// ---------- Historia del precio (pestaña "Igual riesgo") ----------

/** Días en que la bolsa de EE. UU. no abre (además de sábados y domingos). */
const US_HOLIDAYS = new Set([
  "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25", "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
  "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31", "2027-06-18", "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24",
  "2028-01-17", "2028-02-21", "2028-04-14", "2028-05-29", "2028-06-19", "2028-07-04", "2028-09-04", "2028-11-23", "2028-12-25",
]);

/** Sesiones de bolsa después de `from` y hasta `to`, este incluido. */
export function sessionsBetween(from, to) {
  let count = 0;
  const end = Date.parse(`${to}T00:00:00Z`);
  for (let t = Date.parse(`${from}T00:00:00Z`) + 86_400_000; t <= end; t += 86_400_000) {
    const day = new Date(t).getUTCDay();
    if (day === 0 || day === 6) continue;
    if (US_HOLIDAYS.has(new Date(t).toISOString().slice(0, 10))) continue;
    count++;
  }
  return count;
}

/** Todas las ventanas de `sessions` sesiones de la serie de cierres, llevadas al precio de hoy:
 *  precio final = precio de hoy × (cierre final / cierre inicial).
 *  Devuelve la parte que acaba por debajo del corto (%) y la pérdida media por contrato ($). */
export function historyStats(closes, price, shortStrike, longStrike, sessions) {
  const windows = closes.length - sessions;
  if (!(sessions > 0) || windows < 1) return null;
  const width = shortStrike - longStrike;
  let below = 0;
  let loss = 0;
  for (let i = 0; i < windows; i++) {
    const final = (price * closes[i + sessions]) / closes[i];
    if (final < shortStrike) below++;
    loss += Math.min(Math.max(shortStrike - final, 0), width);
  }
  return { windows, prob: (below / windows) * 100, loss: (loss / windows) * 100 };
}

/** Volatilidad realizada de las últimas `n` sesiones, anualizada con √252 (en tanto por uno). */
export function realizedVol(closes, n) {
  if (closes.length < n + 1) return null;
  const rets = [];
  for (let i = closes.length - n; i < closes.length; i++) rets.push(Math.log(closes[i] / closes[i - 1]));
  const mean = rets.reduce((sum, x) => sum + x, 0) / n;
  const variance = rets.reduce((sum, x) => sum + (x - mean) ** 2, 0) / (n - 1);
  return Math.sqrt(variance * 252);
}

/** Pérdida esperada por contrato ($) con una volatilidad dada: [L(corto) − L(largo)] × 100,
 *  con L(K) = K·N(−d2) − S·N(−d1), sin tipo de interés y T en años. */
export function expectedLoss(price, shortStrike, longStrike, sigma, years) {
  if (!(sigma > 0) || !(years > 0)) return null;
  const sd = sigma * Math.sqrt(years);
  const L = (strike) => {
    const d1 = (Math.log(price / strike) + (sigma * sigma * years) / 2) / sd;
    const d2 = d1 - sd;
    return strike * normCdf(-d2) - price * normCdf(-d1);
  };
  return (L(shortStrike) - L(longStrike)) * 100;
}

/** Añade a una fila de "Igual riesgo" la comparación con la historia del precio.
 *  `series` = { d: primera fecha, c: [cierres] } de ese nombre. */
export function withHistory(row, series, today = nyToday()) {
  const closes = series?.c;
  if (row.status !== "ok" || !Array.isArray(closes) || closes.length < 2) return row;
  const sessions = sessionsBetween(today, row.expiry);
  const stats = historyStats(closes, row.sym.p, row.shortStrike, row.longStrike, sessions);
  const v20 = realizedVol(closes, 20);
  const v60 = realizedVol(closes, 60);
  const vol = v20 == null && v60 == null ? null : Math.max(v20 ?? 0, v60 ?? 0);
  const recent = vol == null ? null : expectedLoss(row.sym.p, row.shortStrike, row.longStrike, vol, sessions / 252);
  const twoYearsAgo = `${Number(today.slice(0, 4)) - 2}${today.slice(4)}`;
  const out = { ...row, sessions, shortHistory: !(series.d <= twoYearsAgo) };
  if (!stats || recent == null) return out;
  const worst = Math.max(stats.loss, recent);
  return {
    ...out,
    histProb: r1(stats.prob),
    histLoss: r2(stats.loss),
    vol: r1(vol * 100),
    recentLoss: r2(recent),
    balanceHist: worst > 0 ? r2(row.net / worst) : null,
  };
}

/** Equilibrio: ganancia esperada partida por pérdida esperada.
 *  Ganas el crédito con probabilidad (1 − p) y pierdes la pérdida máxima con
 *  probabilidad p, así que queda rentabilidad × (1 − p) / p.
 *  1 = lo esperado a ganar iguala lo esperado a perder. */
export function balanceOf(ret, prob) {
  if (prob == null || !(prob > 0) || prob >= 100) return null;
  return r2(((ret / 100) * (100 - prob)) / prob);
}

function fmtWidth(n) {
  return Number.isInteger(n) ? n.toFixed(0) : n.toFixed(2).replace(/0$/, "");
}

export const STRATEGIES = {
  bullPut: { id: "bullPut", label: "Bull put", build: buildBullPuts },
};

// ---------- orden ----------

function orderValue(sp, order) {
  if (order === "rentab") return sp.ret;
  if (order === "prob") return sp.prob == null ? null : -sp.prob;
  if (order === "abajo") return sp.otm;
  if (order === "credito") return sp.creditUsd;
  return sp.balance;
}

export function compareSpreads(a, b, order) {
  const va = orderValue(a, order);
  const vb = orderValue(b, order);
  if (va == null && vb == null) return b.ret - a.ret;
  if (va == null) return 1;
  if (vb == null) return -1;
  return (
    vb - va ||
    (a.prob ?? 99) - (b.prob ?? 99) ||
    b.ret - a.ret ||
    a.symbol.localeCompare(b.symbol) ||
    a.expiry.localeCompare(b.expiry) ||
    b.shortStrike - a.shortStrike ||
    b.longStrike - a.longStrike
  );
}

// ---------- lectura de un nombre ----------

/** Estado de un nombre con las reglas dadas.
 *  status: "entrada" | "no-pasa" | "sin-plazo" | "sin-cadena"
 *  best:   el spread que cumple y va primero en el orden, o lo más cerca. */
export function assessSymbol(sym, rules, order, today = nyToday()) {
  const strategy = STRATEGIES.bullPut;
  const spreads = strategy.build(sym, rules, today);
  const passing = spreads.filter((sp) => sp.ok).sort((a, b) => compareSpreads(a, b, order));
  const hasChain = (sym.x ?? []).some(([, , rows]) => rows.length > 0);
  const inWindow = (sym.x ?? []).some(([expiry]) => {
    const dte = daysBetween(today, expiry);
    return dte >= rules.minDte && dte <= rules.maxDte;
  });
  if (passing.length) {
    return { status: "entrada", best: passing[0], spreads: passing, all: spreads, stage: STAGES.length };
  }
  const near = [...spreads].sort((a, b) => b.stage - a.stage || compareSpreads(a, b, order));
  const status = !hasChain ? "sin-cadena" : !inWindow ? "sin-plazo" : "no-pasa";
  // Hay puts dentro de la probabilidad, pero tan baratos que no llegan al cobro mínimo:
  // el nombre supera probabilidad, % abajo y ancho, y se queda en el crédito.
  const stage = Math.max(near[0]?.stage ?? 0, spreads.tooCheap ? STAGES.indexOf("credito") : 0);
  return { status, best: near[0] ?? null, spreads: near, all: spreads, stage };
}

export function statusLabel(status) {
  if (status === "entrada") return "Entrada";
  if (status === "no-pasa") return "No pasa";
  if (status === "sin-plazo") return "Sin vencimiento";
  if (status === "sin-cadena") return "Sin cadena";
  return "Sin lectura";
}

/** Barre todos los nombres. Devuelve los que cumplen, ya ordenados,
 *  y el embudo: cuántos nombres superan cada regla. */
export function rankUniverse(symbols, rules, order, today = nyToday()) {
  const rows = [];
  const funnel = { leidos: symbols.length, conPlazo: 0, prob: 0, abajo: 0, ancho: 0, credito: 0, equilibrio: 0, cumplen: 0 };
  const bySymbol = new Map();
  for (const sym of symbols) {
    const res = assessSymbol(sym, rules, order, today);
    bySymbol.set(sym.s, res);
    if (res.status !== "sin-cadena" && res.status !== "sin-plazo") funnel.conPlazo++;
    if (res.stage >= 1) funnel.prob++;
    if (res.stage >= 2) funnel.abajo++;
    if (res.stage >= 3) funnel.ancho++;
    if (res.stage >= 4) funnel.credito++;
    if (res.stage >= 5) funnel.equilibrio++;
    if (res.status === "entrada") {
      funnel.cumplen++;
      rows.push({ sym, res });
    }
  }
  rows.sort((a, b) => compareSpreads(a.res.best, b.res.best, order));
  return { rows, funnel, bySymbol };
}

/** Todos los bull puts de todos los favoritos en una sola lista ordenada.
 *  opts.status: "todos" | "ok" (cumplen) | "no" (no cumplen)
 *  opts.names / opts.expiries: si traen algo, solo esos nombres o vencimientos
 *  opts.maxWidth: si es > 0, solo spreads de ese ancho o menos
 *  opts.minOtm: si es > 0, solo spreads con el corto al menos ese % abajo
 *  opts.perName: si es > 0, solo los N primeros de cada nombre
 *  counts da, por nombre, cuántos cumplen y cuántos no (sin filtros) y cuántos
 *  quedan con los filtros de estado, vencimiento y ancho (shown). */
export function favoriteDeals(symbols, favorites, rules, order, today = nyToday(), opts = {}) {
  const { perName = 0, status = "todos", names = [], expiries = [], maxWidth = 0, minOtm = 0 } = opts;
  const widths = new Set();
  let otmMin = Infinity;
  let otmMax = -Infinity;
  // Los que cumplen van siempre delante; dentro de cada grupo manda el orden elegido.
  const byRank = (a, b) => Number(b.ok) - Number(a.ok) || compareSpreads(a, b, order);
  const bySymbol = new Map(symbols.map((sym) => [sym.s, sym]));
  const deals = [];
  const counts = {};
  const seen = new Set();
  let matched = 0;
  for (const name of favorites) {
    const sym = bySymbol.get(name);
    if (!sym) continue;
    const res = assessSymbol(sym, rules, order, today);
    if (!res.all.length) continue;
    const ok = res.all.filter((sp) => sp.ok).length;
    counts[name] = { ok, no: res.all.length - ok };
    for (const sp of res.all) {
      seen.add(sp.expiry);
      widths.add(sp.width);
      if (sp.otm < otmMin) otmMin = sp.otm;
      if (sp.otm > otmMax) otmMax = sp.otm;
    }
    const list = res.all
      .filter((sp) => (status === "ok" ? sp.ok : status === "no" ? !sp.ok : true))
      .filter((sp) => !expiries.length || expiries.includes(sp.expiry))
      .filter((sp) => !(maxWidth > 0) || sp.width <= maxWidth + 1e-9)
      .filter((sp) => !(minOtm > 0) || sp.otm >= minOtm - 1e-9)
      .sort(byRank);
    counts[name].shown = list.length; // con los filtros de estado, vencimiento y ancho
    if (names.length && !names.includes(name)) continue;
    matched += list.length;
    for (const sp of perName > 0 ? list.slice(0, perName) : list) deals.push({ sym, sp });
  }
  deals.sort((a, b) => byRank(a.sp, b.sp));
  return {
    deals,
    counts,
    expiries: [...seen].sort(),
    widths: [...widths].sort((a, b) => a - b),
    otmRange: Number.isFinite(otmMin) ? [otmMin, otmMax] : null,
    matched,
  };
}

// ---------- textos ----------

export function spreadLine(sp) {
  return `${fmtStrike(sp.shortStrike)}/${fmtStrike(sp.longStrike)} · ${sp.expiryLabel} · ${sp.otm.toFixed(1)}% abajo · ${sp.creditPct.toFixed(0)}% del ancho`;
}

export function fmtStrike(n) {
  return Number.isInteger(n) ? n.toFixed(0) : String(n);
}

export function alertText(sp) {
  const prob = sp.prob == null ? "" : ` · prob. ${sp.prob.toFixed(0)}%`;
  return `${spreadLine(sp)}${prob} · rentab. ${sp.ret.toFixed(0)}%`;
}

export function rulesLine(rules) {
  const parts = [];
  if (rules.maxProb < PROB_OFF) parts.push(`prob. ≤${rules.maxProb.toFixed(0)}%`);
  parts.push(`${rules.minDte}–${rules.maxDte} días`);
  if (rules.otmOn) parts.push(`${rules.minOtm.toFixed(0)}–${rules.maxOtm.toFixed(0)}% abajo`);
  parts.push(`ancho ≤$${fmtWidth(rules.width)}`);
  if (rules.minCredit > 0) parts.push(`cobras ≥$${rules.minCredit}`);
  if (rules.minBalance > 0) parts.push(`equilibrio ≥${rules.minBalance.toFixed(2)}`);
  return parts.join(" · ");
}
