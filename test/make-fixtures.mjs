// Genera cadenas de ejemplo con el mismo formato que devuelve CBOE,
// valoradas con Black-Scholes. Solo para probar: no son datos de mercado.
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { nyToday } from "../web/engine.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(process.argv[2] ?? path.join(here, "fixtures"));
const count = Number(process.argv[3] ?? 120);
const shift = Number(process.argv[4] ?? 0); // mueve los precios un % (para simular otro barrido)
await mkdir(out, { recursive: true });

let seed = 7;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const N = (x) => {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp((-x * x) / 2);
  const p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x > 0 ? 1 - p : p;
};
const put = (S, K, T, s, r = 0.04) => {
  const d1 = (Math.log(S / K) + (r + (s * s) / 2) * T) / (s * Math.sqrt(T));
  const d2 = d1 - s * Math.sqrt(T);
  return { p: K * Math.exp(-r * T) * N(-d2) - S * N(-d1), delta: -N(-d1) };
};
const today = nyToday();
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const fridays = [];
for (let i = 1; i <= 62; i++) {
  const d = addDays(today, i);
  if (new Date(`${d}T12:00:00Z`).getUTCDay() === 5) fridays.push(d);
}
const occ = (root, iso, cp, K) =>
  `${root}${iso.slice(2, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}${cp}${String(Math.round(K * 1000)).padStart(8, "0")}`;

// Cierres diarios inventados, con el formato del histórico de CBOE: un paseo al azar
// hacia atrás desde el precio de hoy, con la volatilidad del nombre.
await mkdir(path.join(out, "_cierres"), { recursive: true });
const gauss = () => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());
function closesFor(symbol, S, atm) {
  const sessions = symbol === "IBIT" ? 400 : 1300; // uno con poca historia, para ver la nota
  const rows = [];
  let price = S;
  for (let i = 0, back = 0; rows.length < sessions; back++) {
    const date = addDays(today, -back);
    const day = new Date(`${date}T12:00:00Z`).getUTCDay();
    if (day === 0 || day === 6) continue;
    rows.push({ date, open: price, high: price, low: price, close: Math.round(price * 100) / 100, volume: 1000 });
    price /= Math.exp((atm * 0.85 * gauss()) / Math.sqrt(252) + 0.0002);
    i++;
  }
  return rows.reverse();
}

const universe = JSON.parse(await readFile(path.join(here, "..", "scanner", "universe.json"), "utf8"));
const pool = universe.bloques.flatMap((block) => block.nombres.map((row) => row.s));
const kinds = new Map(universe.bloques.flatMap((block) => block.nombres.map((row) => [row.s, row.k])));
// ONLY=AAPL,SPY limita los ejemplos a esos nombres.
const only = (process.env.ONLY ?? "").split(",").map((x) => x.trim().toUpperCase()).filter(Boolean);
const symbols = only.length ? only : [...new Set(pool)].slice(0, count);
const fixed = { AAPL: [333.69, 0.26], NVDA: [233.95, 0.44], MSFT: [517.53, 0.22], SPY: [769.64, 0.14], QQQ: [640.1, 0.18], TSLA: [412.3, 0.58], COIN: [301.2, 0.72], SMCI: [48.6, 0.8], KO: [71.2, 0.15], GOOGL: [246.8, 0.31], PLTR: [182.4, 0.62], AMD: [228.7, 0.5] };
const earnings = {};

for (const symbol of symbols) {
  const [basePrice, atm] = fixed[symbol] ?? [20 + Math.floor(rnd() * 600), 0.14 + rnd() * 0.6];
  const S = Math.round(basePrice * (1 + shift / 100) * 100) / 100;
  const step = S < 50 ? 1 : S < 200 ? 2.5 : S > 600 && ["SPY", "QQQ"].includes(symbol) ? 1 : 5;
  const liquid = rnd();
  const options = [];
  for (const expiry of fridays) {
    const dte = Math.round((Date.parse(expiry) - Date.parse(today)) / 86400000);
    const T = dte / 365;
    for (let K = Math.ceil((S * 0.6) / step) * step; K <= S * 1.06; K += step) {
      const iv = Math.max(0.08, atm + 0.9 * atm * Math.log(S / K));
      const v = put(S, K, T, iv);
      const half = Math.max(0.005, v.p * (0.01 + 0.06 * liquid));
      const bid = Math.max(0, Math.round((v.p - half) * 100) / 100);
      const ask = Math.max(0.01, Math.round((v.p + half) * 100) / 100);
      const oi = Math.round((liquid < 0.3 ? 4000 : 300) * rnd() * Math.exp(-Math.abs(Math.log(S / K)) * 6));
      options.push({ option: occ(symbol.replace(".", ""), expiry, "P", K), bid, ask, iv: Math.round(iv * 10000) / 10000, open_interest: oi, volume: Math.round(oi / 10), delta: Math.round(v.delta * 10000) / 10000 });
      options.push({ option: occ(symbol.replace(".", ""), expiry, "C", K), bid: 1, ask: 1.1, iv: 0.3, open_interest: 10, volume: 1, delta: 0.5 });
    }
  }
  const body = {
    timestamp: new Date().toISOString().slice(0, 19).replace("T", " "),
    data: { options, symbol, security_type: kinds.get(symbol) === "etf" ? "etf" : "stock", current_price: S, price_change_percent: Math.round((rnd() * 4 - 2) * 100) / 100, close: S, iv30: Math.round(atm * 1000) / 10, last_trade_time: new Date().toISOString().slice(0, 19) },
  };
  await writeFile(path.join(out, `${symbol}.json`), JSON.stringify(body));
  await writeFile(path.join(out, "_cierres", `${symbol}.json`), JSON.stringify({ timestamp: "00:00:00", data: closesFor(symbol, S, atm) }));
  if (kinds.get(symbol) !== "etf" && rnd() < 0.35) earnings[symbol] = addDays(today, 3 + Math.floor(rnd() * 40));
}
earnings.AAPL = addDays(today, 25);
earnings.MSFT = addDays(today, 24);
delete earnings.NVDA;
await writeFile(path.join(out, "_earnings.json"), JSON.stringify(earnings));
console.log(`Ejemplos: ${symbols.length} nombres en ${out}`);
