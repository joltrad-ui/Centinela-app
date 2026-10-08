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
export const LEVEL_SAFETY = ["margin", "both", "off"];

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
  equalFee: 1.4, // pestaña "Igual riesgo": comisión por spread al abrir, en dólares; la de salir cuenta otra vez en el coste de ida y vuelta
  levelSafety: "margin", // pestaña "Hoy": el punto de seguridad del nivel: "margin" (lo que queda supera el error del cálculo), "both" (los dos cálculos en positivo) u "off" (no cuenta)
  levelMargin: 1, // pestaña "Hoy": cuántas veces el error tiene que caber en lo que queda, de 0,5 a 3
  errVolPct: 10, // pestaña "Hoy": cuánto se supone que puede variar la volatilidad reciente al calcular el error, en %, de 10 a 40
  errHistK: 1, // pestaña "Hoy": por cuánto se multiplica el error de la historia de 5 años, de 1 a 3
  equalGapPct: 35, // pestaña "Igual riesgo": horquilla máxima del spread, en % del crédito a precio medio; por encima, la fila se aparta
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

/** Número a la española: coma decimal; punto de millares solo a partir de cinco cifras. */
export function num(n, decimals = 0) {
  const text = Math.abs(n).toFixed(decimals);
  const [int, frac] = text.split(".");
  const grouped = int.length > 4 ? int.replace(/\B(?=(\d{3})+(?!\d))/g, ".") : int;
  return `${n < 0 && Number(text) !== 0 ? "−" : ""}${grouped}${frac ? `,${frac}` : ""}`;
}
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
    equalFee: Math.round(clamp(row.equalFee, 0, 20, base.equalFee) * 100) / 100,
    equalGapPct: Math.round(clamp(row.equalGapPct, 10, 100, base.equalGapPct)),
    levelSafety: LEVEL_SAFETY.includes(row.levelSafety) ? row.levelSafety : base.levelSafety,
    levelMargin: Math.round(clamp(row.levelMargin, 0.5, 3, base.levelMargin) * 2) / 2,
    errVolPct: Math.round(clamp(row.errVolPct, 10, 40, base.errVolPct) / 5) * 5,
    errHistK: Math.round(clamp(row.errHistK, 1, 3, base.errHistK) * 2) / 2,
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

// Crear el formateador de fechas es caro: uno solo, y cada fecha se formatea una vez.
const DAY_FORMAT = new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short", timeZone: "UTC" });
const LABELS = new Map();

export function labelOf(iso) {
  if (LABELS.has(iso)) return LABELS.get(iso);
  const [year, month, day] = iso.split("-").map(Number);
  const label = DAY_FORMAT.format(new Date(Date.UTC(year, (month ?? 1) - 1, day)));
  if (LABELS.size < 2000) LABELS.set(iso, label);
  return label;
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

function parseOcc(roots, option) {
  for (const root of Array.isArray(roots) ? roots : [roots]) {
    if (!option.startsWith(root)) continue;
    const match = /^(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/.exec(option.slice(root.length));
    if (match) return { expiry: `20${match[1]}-${match[2]}-${match[3]}`, call: match[4] === "C", strike: Number(match[5]) / 1000 };
  }
  return null;
}

const roundTo = (n, digits) => Math.round(n * 10 ** digits) / 10 ** digits;

/** De la respuesta de CBOE a lo que guarda Centinela para un nombre.
 *  `roots`: raíces de los contratos si no coinciden con el símbolo (un índice como XSP
 *  tiene las mensuales en XSP y las semanales en XSPW). */
export function readCboeChain(symbol, body, today = nyToday(), roots = null) {
  const data = body?.data;
  const price = numOf(data?.current_price) ?? numOf(data?.close);
  const options = Array.isArray(data?.options) ? data.options : [];
  if (!(price > 0)) return null;
  const root = roots?.length ? roots : symbol.replace(".", "");
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

/** "Igual riesgo": una fila por nombre con la misma prob. de asignación y vencimiento, y el ancho más
 *  cercano al elegido sin pasarse.
 *  Corto = el strike más alto cuya prob. (la de mercado, o la fórmula de reserva) no pasa del objetivo.
 *  Sin `opts.orLess`, si el más cercano se queda a más de 3 puntos por debajo del objetivo no hay fila ("sin strike").
 *  Con `orLess` ("X % o menos") no hay ese límite inferior: vale el más cercano, quede donde quede.
 *  Largo = el strike que deja el ancho más grande que no pasa del elegido (no hace falta que sea exacto;
 *  entre los que tienen precio). Crédito a precio natural; comisión por spread al abrir.
 *  No aplica crédito mínimo, equilibrio ni interruptores. Estados: ok, sin-strike, sin-ancho, sin-vencimiento, sin-precio. */
export function equalRisk(sym, opts, today = nyToday()) {
  const { prob: target, width, expiry, fee = 0 } = opts;
  const entry = (sym.x ?? []).find((item) => item[0] === expiry);
  if (!entry) return { sym, status: "sin-vencimiento", why: "Sin ese vencimiento" };
  const rows = entry[2];
  const probOf = rowProbs(sym, entry, today);
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
  if (!opts.orLess && shortProb.value < target - 3 - 1e-9) {
    return { sym, status: "sin-strike", why: `Sin strike cerca: el más próximo tiene ${num(shortProb.value, 1)} %` };
  }
  // Largo: el strike más bajo que no pasa del ancho elegido; si ese no tiene precio, el siguiente.
  const inside = rows.filter((row) => row[K] < short[K] - 1e-6 && row[K] >= short[K] - width - 1e-6).sort((a, b) => a[K] - b[K]);
  if (!inside.length) {
    return { sym, status: "sin-ancho", why: `Sin ese ancho: no hay strike entre ${fmtStrike(r2(short[K] - width))} y ${fmtStrike(short[K])}` };
  }
  const long = inside.find((row) => row[ASK] > 0) ?? inside[0];
  return spreadRow(sym, expiry, short[K], long[K], fee, today);
}

/** Prob. de cada fila de un vencimiento: la de mercado y, si no se puede medir, la fórmula de reserva. */
function rowProbs(sym, entry, today) {
  const rows = entry[2];
  const dte = daysBetween(today, entry[0]);
  const market = marketProbs(rows);
  return (index) => {
    if (market[index] != null) return { value: market[index], src: "mercado" };
    const row = rows[index];
    const model = row[IV] > 0 ? probBelow(sym.p, row[K], dte, row[IV]) : row[DELTA] < 0 ? Math.abs(row[DELTA]) * 100 : null;
    return model == null ? { value: null, src: null } : { value: model, src: "formula" };
  };
}

/** Las cuentas de "Igual riesgo" para un bull put concreto (corto, largo y vencimiento dados):
 *  crédito a precio natural, comisión por spread al abrir, sin aplicar ninguna regla. */
export function spreadRow(sym, expiry, shortStrike, longStrike, fee = 0, today = nyToday()) {
  const entry = (sym.x ?? []).find((item) => item[0] === expiry);
  if (!entry) return { sym, status: "sin-vencimiento", why: "Sin ese vencimiento" };
  const rows = entry[2];
  const dte = daysBetween(today, expiry);
  const at = (strike) => rows.findIndex((row) => Math.abs(row[K] - strike) < 1e-6);
  const shortIndex = at(shortStrike);
  if (shortIndex < 0) return { sym, status: "sin-strike", why: `Sin strike en ${fmtStrike(shortStrike)}` };
  const longIndex = at(longStrike);
  if (longIndex < 0) return { sym, status: "sin-ancho", why: `Sin ese ancho: no hay strike en ${fmtStrike(longStrike)}` };
  const short = rows[shortIndex];
  const long = rows[longIndex];
  const width = r2(short[K] - long[K]);
  if (!(short[BID] > 0) || !(long[ASK] > 0)) return { sym, status: "sin-precio", why: "Sin precio: falta bid del corto o ask del largo" };
  const credit = r2(short[BID] - long[ASK]);
  if (credit <= 0) return { sym, status: "sin-precio", why: "Sin precio: a precio natural no hay crédito" };
  const net = credit * 100 - fee;
  const loss = width * 100 - net;
  if (!(loss > 0)) return { sym, status: "sin-precio", why: "Sin precio: el crédito iguala el ancho" };
  const probOf = rowProbs(sym, entry, today);
  const shortProb = probOf(shortIndex);
  const longProb = probOf(longIndex).value;
  const earn = sym.er && sym.er.d ? sym.er : null;
  const earnDte = earn ? daysBetween(today, earn.d) : null;
  // Horquilla del spread (lo que cuesta entrar y salir a precio natural) y crédito a precio medio.
  // Sin ask del corto o sin bid del largo no hay precio medio fiable.
  const quoted = short[ASK] > 0 && long[BID] >= 0;
  const gap = quoted ? short[ASK] - short[BID] + (long[ASK] - long[BID]) : null;
  const midCredit = quoted ? (short[BID] + short[ASK]) / 2 - (long[BID] + long[ASK]) / 2 : null;
  return {
    sym,
    status: "ok",
    gap: gap == null ? null : r2(gap),
    midCredit: midCredit == null ? null : Math.round(midCredit * 1000) / 1000,
    roundTrip: gap == null ? null : r2(gap * 100 + 2 * fee),
    expiry,
    expiryLabel: labelOf(expiry),
    dte,
    shortStrike: short[K],
    longStrike: long[K],
    otm: r1(((sym.p - short[K]) / sym.p) * 100),
    width,
    credit,
    prob: shortProb.value == null ? null : r1(shortProb.value),
    probSrc: shortProb.src,
    longProb: longProb == null ? null : r1(longProb),
    net: r2(net),
    loss: r2(loss),
    ret: r1((net / loss) * 100),
    breakeven: r2(short[K] - net / 100),
    shortOi: short[OI] ?? 0,
    shortBid: short[BID],
    shortAsk: short[ASK] > 0 ? short[ASK] : null,
    longBid: long[BID] >= 0 ? long[BID] : null,
    longAsk: long[ASK],
    earnInside: earnDte != null && earnDte >= 0 && earnDte <= dte + 2,
    fed: FED_BLOCKS.includes(sym.b) ? fedInside(today, expiry) : [],
  };
}

/** Avisos de poca liquidez de un bull put, con los umbrales del interruptor de liquidez. */
export function liquidityNotes(sp, gates) {
  const notes = [];
  if ((sp.shortOi ?? 0) < gates.oiMin) notes.push("poco interés en el corto");
  if (sp.shortAsk != null && sp.longBid != null) {
    const gap = sp.shortAsk - sp.shortBid + (sp.longAsk - sp.longBid);
    const mid = (sp.shortBid + sp.shortAsk) / 2 - (sp.longBid + sp.longAsk) / 2;
    if (mid > 0 && gap > (mid * gates.spreadPct) / 100 + 1e-9) notes.push("horquilla ancha");
  }
  return notes;
}

/** Máximo y mínimo de las últimas 52 semanas (252 sesiones) a precio de cierre, contando el precio de hoy. */
export function yearRange(closes, price) {
  if (!Array.isArray(closes) || closes.length < 2) return null;
  const last = closes.slice(-252);
  if (price > 0) last.push(price);
  return { min: Math.min(...last), max: Math.max(...last), sessions: last.length };
}

/** Mínimo y máximo del último mes (21 sesiones) con el precio de ahora; null si no hay cierres. */
export function monthRange(closes, price) {
  if (!Array.isArray(closes) || closes.length < 2) return null;
  const last = closes.slice(-21);
  if (price > 0) last.push(price);
  return { min: Math.min(...last), max: Math.max(...last), sessions: last.length };
}

/** Un spread es comparable si su precio es fiable. Devuelve el motivo por el que no, o "".
 *  Orden de las puertas: prob. sin medir en el mercado, horquilla ancha (más de `gapPct` % del crédito a
 *  precio medio; se cambia en Reglas), el cobro no cubre salir. */
export function gateReason(row, gapPct = DEFAULT_RULES.equalGapPct) {
  if (row.status !== "ok") return "";
  if (row.probSrc === "formula") return "prob. sin medir en el mercado";
  if (row.midCredit == null || !(row.midCredit > 0) || row.gap > (row.midCredit * gapPct) / 100 + 1e-9) return "horquilla ancha: precio poco fiable";
  if (row.net < row.roundTrip - 1e-9) return "no cubre el coste de salir";
  return "";
}

/** Orden de "Igual riesgo": rentab. esperada (de mayor a menor); detrás, las filas sin cierres, por rentab. neta. */
const byExpected = (a, b) => (b.retExp != null) - (a.retExp != null) || (a.retExp != null ? b.retExp - a.retExp : 0) || b.ret - a.ret;

/** La lista de "Igual riesgo", en tres partes:
 *  - rows: filas comparables, ordenadas (por rentab. esperada si se pasan cierres en `opts.hist`).
 *    Las que tienen resultados dentro del plazo van aquí, con `earnInside` para que la vista las marque:
 *    los resultados avisan, no apartan.
 *  - gated: con precio pero apartadas por una puerta (`gate` lleva el motivo)
 *  - out: sin fila (sin vencimiento, strike, ancho o precio) */
export function equalRiskList(symbols, opts, today = nyToday()) {
  const hist = opts.hist ?? null;
  const all = symbols.map((sym) => {
    const row = equalRisk(sym, opts, today);
    return hist ? withHistory(row, hist[sym.s], today) : row;
  });
  const priced = all.filter((row) => row.status === "ok").map((row) => ({ ...row, gate: gateReason(row, opts.gapPct) }));
  const rows = priced.filter((row) => !row.gate).sort(byExpected);
  const gated = priced.filter((row) => row.gate).sort(byExpected);
  const out = all.filter((row) => row.status !== "ok");
  return { rows, gated, out };
}

/** ¿Los precios de un barrido son de fuera del horario de mercado? Cuenta el retraso de 15 minutos de
 *  la fuente: un barrido a las 16:10 todavía trae precios de las 15:55. `at` en milisegundos. */
export function pricesOutsideMarket(at) {
  if (!(at > 0)) return false;
  const taken = new Date(at - 15 * 60_000);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(taken)
      .map((part) => [part.type, part.value]),
  );
  if (parts.weekday === "Sat" || parts.weekday === "Sun") return true;
  if (US_HOLIDAYS.has(`${parts.year}-${parts.month}-${parts.day}`)) return true;
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  return minutes < 9 * 60 + 30 || minutes > 16 * 60;
}

// ---------- Historia del precio (pestaña "Igual riesgo") ----------

/** Días en que la bolsa de EE. UU. no abre (además de sábados y domingos). */
const US_HOLIDAYS = new Set([
  "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25", "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
  "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31", "2027-06-18", "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24",
  "2028-01-17", "2028-02-21", "2028-04-14", "2028-05-29", "2028-06-19", "2028-07-04", "2028-09-04", "2028-11-23", "2028-12-25",
]);

/** Días de decisión de la Fed (último día de cada reunión del FOMC), del calendario oficial
 *  (federalreserve.gov/monetarypolicy/fomccalendars.htm). Hay hasta enero de 2028, que aún es provisional:
 *  AMPLIARLA cuando la Fed publique más fechas y antes de que se acabe. */
export const FED_DATES = [
  "2026-10-28", "2026-12-09",
  "2027-01-27", "2027-03-17", "2027-04-28", "2027-06-09", "2027-07-28", "2027-09-15", "2027-10-27", "2027-12-08",
  "2028-01-26",
];
/** Bloques de la lista base sobre los que la Fed pesa lo bastante como para avisar. */
export const FED_BLOCKS = ["Bonos largos", "Bolsa EE. UU."];

/** Decisiones de la Fed desde hoy hasta el vencimiento, ambos incluidos. */
export function fedInside(today, expiry) {
  return FED_DATES.filter((date) => date >= today && date <= expiry);
}

/** Sesiones de bolsa después de `from` y hasta `to`, este incluido. */
const SESSIONS = new Map();

export function sessionsBetween(from, to) {
  const key = `${from}|${to}`;
  if (SESSIONS.has(key)) return SESSIONS.get(key);
  const count = sessionsCount(from, to);
  if (SESSIONS.size < 2000) SESSIONS.set(key, count);
  return count;
}

function sessionsCount(from, to) {
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
  const lost = new Array(windows);
  for (let i = 0; i < windows; i++) {
    const final = (price * closes[i + sessions]) / closes[i];
    if (final < shortStrike) below++;
    lost[i] = Math.min(Math.max(shortStrike - final, 0), width);
    loss += lost[i];
  }
  const mean = loss / windows;
  // Error de la media por lotes: las ventanas vecinas comparten días, así que se parten en lotes seguidos de `sessions` ventanas
  // (unos 55 con 5 años y un mes de plazo), se saca la media de cada lote y el error es la desviación de esas medias entre √lotes.
  // Con menos de 3 lotes, la desviación de todas las ventanas entre √(ventanas / sesiones).
  const batches = Math.floor(windows / sessions);
  let se;
  if (batches >= 3) {
    const means = [];
    for (let b = 0; b < batches; b++) {
      let sum = 0;
      for (let i = b * sessions; i < (b + 1) * sessions; i++) sum += lost[i];
      means.push(sum / sessions);
    }
    const m = means.reduce((a, x) => a + x, 0) / batches;
    se = Math.sqrt(means.reduce((a, x) => a + (x - m) ** 2, 0) / (batches - 1) / batches);
  } else {
    const sd = windows > 1 ? Math.sqrt(lost.reduce((a, x) => a + (x - mean) ** 2, 0) / (windows - 1)) : 0;
    se = sd / Math.sqrt(Math.max(1, windows / sessions));
  }
  return { windows, prob: (below / windows) * 100, loss: mean * 100, se: se * 100 };
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

/** Las dos volatilidades de un nombre, en % al año: la reciente (la mayor entre la de 20 y la de 60 sesiones,
 *  la que usa la pérdida esperada reciente) y la de todos los cierres guardados (5 años), ambas con √252. */
// Las volatilidades y las notas de tendencia solo dependen de los cierres (y del precio): se guardan por serie para no
// recalcularlas en cada bull put del mismo nombre (la pestaña Deals puntúa miles).
const VOLS_MEMO = new WeakMap();
const TREND_MEMO = new WeakMap();

export function volatilities(closes) {
  if (!Array.isArray(closes) || closes.length < 3) return null;
  if (VOLS_MEMO.has(closes)) return VOLS_MEMO.get(closes);
  const out = volatilitiesOf(closes);
  VOLS_MEMO.set(closes, out);
  return out;
}

function volatilitiesOf(closes) {
  const v20 = realizedVol(closes, 20);
  const v60 = realizedVol(closes, 60);
  const recent = v20 == null && v60 == null ? null : Math.max(v20 ?? 0, v60 ?? 0);
  const long = realizedVol(closes, closes.length - 1);
  return { recent, long, recentPct: recent == null ? null : r1(recent * 100), longPct: long == null ? null : r1(long * 100) };
}

/** Notas de tendencia (avisos, no filtros): precio en el 10 % más bajo de su rango de 52 semanas y precio
 *  por debajo de la media de sus últimos 200 cierres. */
export function trendNotes(closes, price) {
  if (!Array.isArray(closes)) return trendNotesOf(closes, price);
  const memo = TREND_MEMO.get(closes);
  if (memo && memo.price === price) return [...memo.notes];
  const notes = trendNotesOf(closes, price);
  TREND_MEMO.set(closes, { price, notes });
  return [...notes];
}

function trendNotesOf(closes, price) {
  const notes = [];
  const range = yearRange(closes, price);
  if (range && range.max > range.min && (price - range.min) / (range.max - range.min) <= 0.1 + 1e-9) notes.push("en mínimos del año");
  if (Array.isArray(closes) && closes.length >= 200) {
    const mean = closes.slice(-200).reduce((sum, close) => sum + close, 0) / 200;
    if (price < mean) notes.push("bajo su media de 200");
  }
  return notes;
}

/** Añade a una fila de "Igual riesgo" la comparación con la historia del precio.
 *  `series` = { d: primera fecha, c: [cierres] } de ese nombre. */
/** `err` = { volPct, histK } (reglas `errVolPct` y `errHistK` de la pestaña Hoy): cuánto puede variar la volatilidad reciente
 *  (±10 % de fábrica) y por cuánto se multiplica el error de la historia (×1 de fábrica). Solo cambian el error, no lo que se espera pagar. */
export function withHistory(row, series, today = nyToday(), err = {}) {
  const closes = series?.c;
  if (row.status !== "ok" || !Array.isArray(closes) || closes.length < 2) return row;
  const sessions = sessionsBetween(today, row.expiry);
  const stats = historyStats(closes, row.sym.p, row.shortStrike, row.longStrike, sessions);
  const vols = volatilities(closes);
  const vol = vols?.recent ?? null;
  const recent = vol == null ? null : expectedLoss(row.sym.p, row.shortStrike, row.longStrike, vol, sessions / 252);
  const twoYearsAgo = `${Number(today.slice(0, 4)) - 2}${today.slice(4)}`;
  const out = { ...row, sessions, shortHistory: !(series.d <= twoYearsAgo), trend: trendNotes(closes, row.sym.p), years: r1(closes.length / 252) };
  if (!stats || recent == null) return out;
  // Lo que se espera pagar: la media de los dos cálculos (5 años de precios y volatilidad reciente).
  const high = Math.max(stats.loss, recent);
  const low = Math.min(stats.loss, recent);
  const expected = (stats.loss + recent) / 2;
  // Lo que queda con cada cálculo por separado. Si tienen distinto signo, la media esconde que
  // la fila solo sale bien con uno de los dos.
  const marginHist = row.net - stats.loss;
  const marginRecent = row.net - recent;
  // Cuánto se puede equivocar cada cálculo. Historia: error de la media de 5 años de ventanas. Reciente: media diferencia entre
  // la pérdida con la volatilidad un 10 % mayor y un 10 % menor. Lo que se espera pagar es su media, y su error combina los dos.
  const band = (err.volPct ?? DEFAULT_RULES.errVolPct) / 100;
  const recentHigh = expectedLoss(row.sym.p, row.shortStrike, row.longStrike, vol * (1 + band), sessions / 252);
  const recentLow = expectedLoss(row.sym.p, row.shortStrike, row.longStrike, vol * (1 - band), sessions / 252);
  const errRecent = recentHigh == null || recentLow == null ? null : Math.abs(recentHigh - recentLow) / 2;
  const errHist = stats.se * (err.histK ?? DEFAULT_RULES.errHistK);
  const errAll = errRecent == null ? null : 0.5 * Math.sqrt(errHist * errHist + errRecent * errRecent);
  return {
    ...out,
    histProb: r1(stats.prob),
    histLoss: r2(stats.loss),
    vol: r1(vol * 100),
    vol5: vols.longPct,
    recentLoss: r2(recent),
    expected: r2(expected),
    errHist: r2(errHist),
    errRecent: errRecent == null ? null : r2(errRecent),
    err: errAll == null ? null : r2(errAll),
    distinct: high > 3 * low,
    marginHist: r2(marginHist),
    marginRecent: r2(marginRecent),
    onlyOne: marginHist * marginRecent < 0,
    retExp: r1(((row.net - expected) / row.loss) * 100),
    balanceHist: expected > 0.005 ? r1(row.net / expected) : 999,
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
  return Number.isInteger(n) ? String(n) : num(n, 2).replace(/0$/, "");
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
 *  opts.maxProb: si es > 0, solo spreads con prob. de asignación de ese % o menos (sin prob. no entran)
 *  opts.perName: si es > 0, solo los N primeros de cada nombre
 *  counts da, por nombre, cuántos cumplen y cuántos no (sin filtros) y cuántos
 *  quedan con los filtros de estado, vencimiento y ancho (shown). */
export function favoriteDeals(symbols, favorites, rules, order, today = nyToday(), opts = {}) {
  const { perName = 0, status = "todos", names = [], expiries = [], maxWidth = 0, minOtm = 0, maxProb = 0 } = opts;
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
      .filter((sp) => !(maxProb > 0) || (sp.prob != null && sp.prob <= maxProb + 1e-9))
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
  return `${fmtStrike(sp.shortStrike)}/${fmtStrike(sp.longStrike)} · ${sp.expiryLabel} · ${num(sp.otm, 1)} % abajo · ${num(sp.creditPct, 0)} % del ancho`;
}

export function fmtStrike(n) {
  return Number.isInteger(n) ? String(n) : String(n).replace(".", ",");
}

export function alertText(sp) {
  const prob = sp.prob == null ? "" : ` · prob. ${num(sp.prob, 0)} %`;
  return `${spreadLine(sp)}${prob} · rentab. ${num(sp.ret, 0)} %`;
}

export function rulesLine(rules) {
  const parts = [];
  if (rules.maxProb < PROB_OFF) parts.push(`prob. ≤${num(rules.maxProb, 0)} %`);
  parts.push(`${rules.minDte}–${rules.maxDte} días`);
  if (rules.otmOn) parts.push(`${num(rules.minOtm, 0)}–${num(rules.maxOtm, 0)} % abajo`);
  parts.push(`ancho ≤$${fmtWidth(rules.width)}`);
  if (rules.minCredit > 0) parts.push(`cobras ≥$${rules.minCredit}`);
  if (rules.minBalance > 0) parts.push(`equilibrio ≥${num(rules.minBalance, 2)}`);
  return parts.join(" · ");
}

// ---------- Pestaña "Hoy": niveles, mapa y seguimiento ----------
//
// Una misma vara para cualquier bull put de la lista: el nivel, de 0 a 4. No añade cuentas nuevas:
// se apoya en las de "Igual riesgo" (`equalRisk`, `withHistory`, `gateReason`).
//
// Nivel 0: la rentab. esperada no es positiva (o no hay cierres para calcularla).
// Si es positiva, 1 más un punto por cada comprobación:
//   - los dos cálculos (historia y volatilidad reciente) salen en positivo,
//   - el coste de ida y vuelta no pasa de `LEVEL_COST_PCT` % de lo cobrado,
//   - no repite un bloque que ya está abierto.
// Es un nivel y no una nota con pesos a propósito: una nota dejaría que un coste bajo tapara una
// rentab. esperada negativa, y la precisión de las cuentas no da para más de unos pocos escalones.

/** Coste de ida y vuelta máximo, en % de lo cobrado neto, para que un deal sume el punto de coste. */
export const LEVEL_COST_PCT = 40;

/** La misma fila de "Igual riesgo" si entrara a precio medio en vez de a precio natural.
 *  Es una hipótesis (nadie garantiza el precio medio): sirve para ver dónde hay valor dentro de la horquilla.
 *  Devuelve null si no hay precio medio o no deja crédito. */
export function atMid(row, fee = 0) {
  if (!row || row.status !== "ok" || row.midCredit == null || !(row.midCredit > 0)) return null;
  const net = row.midCredit * 100 - fee;
  const loss = row.width * 100 - net;
  if (!(net > 0) || !(loss > 0)) return null;
  const out = { ...row, mid: true, credit: row.midCredit, net: r2(net), loss: r2(loss), ret: r1((net / loss) * 100), breakeven: r2(row.shortStrike - net / 100) };
  if (row.expected == null) return out;
  const marginHist = net - row.histLoss;
  const marginRecent = net - row.recentLoss;
  return {
    ...out,
    marginHist: r2(marginHist),
    marginRecent: r2(marginRecent),
    onlyOne: marginHist * marginRecent < 0,
    retExp: r1(((net - row.expected) / loss) * 100),
    balanceHist: row.expected > 0.005 ? r1(net / row.expected) : 999,
  };
}

/** Las comprobaciones de un deal y su nivel (0 a 5 con la regla "margin"; 0 a 4 con "both"; 0 a 3 si el punto de seguridad no cuenta). `held` = bloques que ya están abiertos.
 *  Punto de seguridad (`opts.safety`, regla `levelSafety`): "margin" = lo que queda (cobras neto menos lo que se espera pagar)
 *  supera `opts.marginK` veces el error del cálculo; "both" = los dos cálculos salen en positivo; "off" = no cuenta.
 *  `room` = lo que queda partido por su error (null si no hay error calculado); `both` se da siempre, sea cual sea la regla. */
export function dealChecks(row, opts = {}) {
  const held = Array.isArray(opts.held) ? opts.held : [];
  const costPct = opts.costPct ?? LEVEL_COST_PCT;
  const safety = LEVEL_SAFETY.includes(opts.safety) ? opts.safety : DEFAULT_RULES.levelSafety;
  const marginK = opts.marginK ?? DEFAULT_RULES.levelMargin;
  const scored = row.retExp != null;
  const positive = scored && row.retExp > 0;
  const both = scored && row.marginHist > 0 && row.marginRecent > 0;
  const left = scored ? row.net - row.expected : null;
  const room = scored && row.err > 0 ? left / row.err : null;
  const roomOk = room != null && room >= marginK - 1e-9;
  const safe = safety === "off" ? false : safety === "both" ? both : roomOk;
  const costShare = row.roundTrip != null && row.net > 0 ? (row.roundTrip / row.net) * 100 : null;
  const cheap = costShare != null && costShare <= costPct + 1e-9;
  const fresh = !held.includes(row.sym?.b ?? "");
  return {
    scored,
    positive,
    both,
    safe,
    safety,
    room: room == null ? null : Math.round(room * 10) / 10,
    cheap,
    fresh,
    costShare: costShare == null ? null : Math.round(costShare),
    // 5 = todo a favor (4) y, con la regla "margin", lo que queda supera el doble del margen exigido (2 veces el error de fábrica).
    level: !positive ? 0 : (safe && cheap && fresh && safety === "margin" && room != null && room >= 2 * marginK - 1e-9) ? 5 : 1 + (safe ? 1 : 0) + (cheap ? 1 : 0) + (fresh ? 1 : 0),
  };
}

/** Lo que rinde un deal, en tres filas: sin descontar la comisión, descontándola y tras lo que se espera pagar.
 *  Cada fila: `gain` (dólares por contrato), `perDay` (dólares por día), `onRisk` (% de lo que arriesgas) y
 *  `onRiskPerDay` (% al día). Arriesgas el ancho menos lo cobrado ("pierdes máx."), con la comisión descontada o sin ella.
 *  Los días son los naturales hasta el vencimiento. La tercera fila (`expected`) es null sin cierres para puntuar. */
export function returnsOf(row, fee = 0) {
  if (!row || row.status !== "ok" || !(row.dte > 0) || !(row.width > 0)) return null;
  const days = row.dte;
  const line = (gain, risk) => ({
    gain: r2(gain),
    perDay: r2(gain / days),
    onRisk: risk > 0 ? r2((gain / risk) * 100) : null,
    onRiskPerDay: risk > 0 ? Math.round(((gain / risk) * 100 * 10000) / days) / 10000 : null,
  });
  const gross = row.credit * 100;
  const out = {
    days,
    gross: line(gross, row.width * 100 - gross),
    net: line(row.net, row.loss),
    expected: null,
  };
  if (row.expected != null) out.expected = line(row.net - row.expected, row.loss);
  return out;
}

/** Un deal en una sola escala, para la vista "Barras" de Hoy: todo en % de lo que se arriesga ("pierdes máx.").
 *  collected = cobras neto; expected = lo que queda (cobras neto − se espera pagar); pay = se espera pagar;
 *  err = `k` veces el error del cálculo. collected = expected + pay. Sin cierres no hay nada que dibujar. */
export function rangeOf(row, k = 1) {
  if (!row || row.status !== "ok" || !(row.loss > 0) || row.expected == null) return null;
  const pct = (dollars) => (dollars / row.loss) * 100;
  const err = row.err == null ? null : pct(row.err * k);
  const expected = pct(row.net - row.expected);
  return { collected: pct(row.net), expected, pay: pct(row.expected), err, low: err == null ? null : expected - err, high: err == null ? null : expected + err };
}

/** Orden de la vista "Barras". `by`: "left" (lo que queda de media, de mayor a menor) o "floor" (el suelo:
 *  lo que queda menos el error, el extremo bajo de la barra). Con "floor", los que no tienen error medido
 *  van detrás; los empates se deshacen por lo que queda. Compara dos resultados de `rangeOf`. */
export function rangeOrder(a, b, by = "left") {
  if (by === "floor") {
    if ((a.low == null) !== (b.low == null)) return a.low == null ? 1 : -1;
    if (a.low != null && a.low !== b.low) return b.low - a.low;
  }
  return b.expected - a.expected;
}

/** Por qué un bull put no cumple las Reglas cuando no está en la lista que arman las reglas (queda lejos de ellas):
 *  lo mismo que miran las reglas, en sus palabras. */
function ruleFailsOf(row, rules) {
  const fails = [];
  if (rules.maxProb < PROB_OFF && !(row.prob != null && row.prob <= rules.maxProb + 1e-9)) fails.push(row.prob == null ? "sin dato de probabilidad" : "probabilidad alta");
  if (rules.otmOn && !(row.otm >= rules.minOtm - 1e-9 && row.otm <= rules.maxOtm + 1e-9)) fails.push("fuera del punto");
  if (row.width > rules.width + 1e-9) fails.push(`ancho de $${fmtWidth(row.width)}`);
  if (Math.round(row.credit * 100) < rules.minCredit) fails.push("crédito corto");
  return fails.length ? fails : ["lejos de tus Reglas"];
}

/** Pestaña Deals: todos los bull puts del plazo de las Reglas, puntuados con el mismo nivel que Hoy.
 *  Corto por debajo del precio con prob. de asignación hasta `maxProb` (20 % de fábrica); largo hasta `maxWidth` dólares por
 *  debajo (10). Cuentas de "Igual riesgo" (comisión al abrir, historia) y nivel de `dealChecks`. A precio natural se apartan los
 *  de horquilla ancha (`gated`); a precio medio (`price: "mid"`) se puntúa el crédito medio, salvo los de prob. sin medir.
 *  Cada deal lleva si cumple las Reglas (`ok`) y por qué no (`fails`), y su suelo: lo que queda menos el error del cálculo,
 *  en % de lo que se arriesga.
 *  Orden: nivel, suelo y rentab. esperada. */
export function qualityDeals(symbols, opts, today = nyToday()) {
  const { rules, fee = 0, gapPct = DEFAULT_RULES.equalGapPct, hist = null, price = "nat", maxProb = 20, maxWidth = 10 } = opts;
  const err = { volPct: opts.errVolPct, histK: opts.errHistK };
  const deals = [];
  let gated = 0;
  let unscored = 0;
  for (const sym of symbols) {
    if (!(sym.p > 0)) continue;
    const byRules = new Map();
    for (const sp of STRATEGIES.bullPut.build(sym, rules, today)) byRules.set(`${sp.expiry}|${sp.shortStrike}|${sp.longStrike}`, sp);
    for (const entry of sym.x ?? []) {
      const [expiry, , rows] = entry;
      const dte = daysBetween(today, expiry);
      if (dte < rules.minDte || dte > rules.maxDte) continue;
      const probOf = rowProbs(sym, entry, today);
      for (let i = 0; i < rows.length; i++) {
        const short = rows[i];
        if (!(short[K] < sym.p) || !(short[BID] > 0)) continue;
        const p = probOf(i).value;
        if (p == null || p > maxProb + 1e-9) continue;
        for (const long of rows) {
          const width = short[K] - long[K];
          if (!(width > 1e-6) || width > maxWidth + 1e-6 || !(long[ASK] > 0)) continue;
          let row = spreadRow(sym, expiry, short[K], long[K], fee, today);
          if (row.status !== "ok") continue;
          if (hist) row = withHistory(row, hist[sym.s], today, err);
          let use = row;
          if (price === "mid") {
            if (row.probSrc === "formula") {
              gated++;
              continue;
            }
            use = atMid(row, fee);
            if (!use) continue;
          } else if (gateReason(row, gapPct)) {
            gated++;
            continue;
          }
          const checks = dealChecks(use, opts);
          if (!checks.scored) {
            unscored++;
            continue;
          }
          const sp = byRules.get(`${expiry}|${short[K]}|${long[K]}`);
          deals.push({
            sym,
            row: use,
            checks,
            level: checks.level,
            // El suelo en % de lo que se arriesga, como la rentab. esperada: así se comparan deals de distinto ancho.
            floor: use.err == null || !(use.loss > 0) ? null : r1(((use.net - use.expected - use.err) / use.loss) * 100),
            ok: sp ? sp.ok : false,
            fails: sp ? sp.fails : ruleFailsOf(use, rules),
          });
        }
      }
    }
  }
  const floorOf = (d) => (d.floor == null ? -Infinity : d.floor);
  deals.sort((a, b) => b.level - a.level || floorOf(b) - floorOf(a) || b.row.retExp - a.row.retExp);
  return { deals, gated, unscored };
}

/** Una casilla del mapa: un nombre en un vencimiento.
 *  state: "level" (comparable, con su nivel), "gated" (con precio pero apartada por una puerta) u
 *  "out" (sin fila). `opts.price`: "nat" (precio natural, el de siempre) o "mid" (hipótesis a precio medio:
 *  la horquilla ya no aparta, porque es justo lo que se quiere mirar; la prob. sin medir sí). */
export function levelCell(sym, opts, today = nyToday()) {
  let row = equalRisk(sym, opts, today);
  if (row.status !== "ok") return { sym, state: "out", why: row.why };
  if (opts.hist) row = withHistory(row, opts.hist[sym.s], today, { volPct: opts.errVol, histK: opts.errHistK });
  const gate = gateReason(row, opts.gapPct);
  if (opts.price === "mid") {
    if (row.probSrc === "formula") return { sym, state: "gated", gate, row, checks: dealChecks(row, opts) };
    const mid = atMid(row, opts.fee);
    if (!mid) return { sym, state: "out", why: "Sin precio medio" };
    const checks = dealChecks(mid, opts);
    return { sym, state: "level", row: mid, checks, level: checks.level, gateNat: gate };
  }
  const checks = dealChecks(row, opts);
  if (gate) return { sym, state: "gated", gate, row, checks };
  return { sym, state: "level", row, checks, level: checks.level };
}

/** El mapa: nombres (filas) por vencimientos (columnas), cada casilla con su nivel.
 *  Los nombres van ordenados por su mejor nivel; a igualdad, por la suma de niveles y por orden alfabético.
 *  `summary` cuenta casillas comparables, las que están por encima de 0 y las de nivel 3 o más. */
export function levelGrid(symbols, opts, today = nyToday()) {
  const expiries = opts.expiries ?? [];
  const names = symbols.map((sym) => {
    const cells = expiries.map((expiry) => levelCell(sym, { ...opts, expiry }, today));
    const levels = cells.filter((cell) => cell.state === "level").map((cell) => cell.level);
    return { sym, cells, best: levels.length ? Math.max(...levels) : -1, sum: levels.reduce((a, b) => a + b, 0), priced: cells.filter((cell) => cell.state !== "out").length };
  });
  names.sort((a, b) => b.best - a.best || b.sum - a.sum || b.priced - a.priced || a.sym.s.localeCompare(b.sym.s));
  const all = names.flatMap((name) => name.cells);
  const scored = all.filter((cell) => cell.state === "level");
  return {
    expiries: expiries.map((expiry) => ({ expiry, label: labelOf(expiry) })),
    names,
    summary: {
      comparable: scored.length,
      gated: all.filter((cell) => cell.state === "gated").length,
      positive: scored.filter((cell) => cell.level >= 1).length,
      top: scored.filter((cell) => cell.level >= 3).length,
      firm: scored.filter((cell) => cell.level >= 1 && cell.checks.safe).length, // por encima de 0 y con el punto de seguridad
      withHistory: scored.some((cell) => cell.checks.scored),
    },
  };
}

/** Los vencimientos del mapa: los del plazo de las reglas que tiene al menos la mitad de los nombres
 *  (los semanales y mensuales comunes), como mucho `max`, por fecha. Si sobran, se quedan los que tienen más nombres. */
export function mapExpiries(symbols, rules, today = nyToday(), max = 5) {
  const list = commonExpiries(symbols, rules, today);
  if (!list.length) return [];
  const most = Math.max(...list.map((item) => item.names));
  const common = list.filter((item) => item.names * 2 >= most);
  const kept = common.length > max ? [...common].sort((a, b) => b.names - a.names || (a.expiry < b.expiry ? -1 : 1)).slice(0, max) : common;
  return kept.map((item) => item.expiry).sort();
}

/** Estado de un deal apuntado en "Mis deals" con el precio de ahora.
 *  state: "vencido" (pasó el vencimiento), "debajo" (el precio está bajo el corto),
 *  "cerca" (a menos de `nearPct` % del corto) o "lejos". `above` = % que el precio queda por encima del corto. */
export function dealStatus(deal, price, today = nyToday(), nearPct = 3) {
  const dte = daysBetween(today, deal.expiry);
  if (!(price > 0)) return { dte, price: null, above: null, state: dte < 0 ? "vencido" : "sin-precio" };
  const above = r1(((price - deal.short) / price) * 100);
  const state = dte < 0 ? "vencido" : price < deal.short ? "debajo" : above < nearPct ? "cerca" : "lejos";
  return { dte, price, above, state };
}

/** Lo que pasó con los deals cerrados, por el nivel que tenían al abrirlos: cuántos, cuántos acabaron
 *  en positivo, el resultado total y el medio, en dólares. Es lo que dirá con el tiempo si el nivel sirve. */
export function levelRecord(deals) {
  const closed = (deals ?? []).filter((deal) => deal && deal.closedAt && typeof deal.result === "number" && Number.isFinite(deal.result));
  const out = [];
  for (let level = 5; level >= 0; level--) {
    const own = closed.filter((deal) => deal.level === level);
    if (!own.length) continue;
    const total = own.reduce((sum, deal) => sum + deal.result, 0);
    out.push({ level, n: own.length, won: own.filter((deal) => deal.result > 0).length, total: r2(total), avg: r2(total / own.length) });
  }
  return out;
}
