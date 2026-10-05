// Cierres diarios de la lista base, para la comparación con la historia del precio.
// Se ejecuta una vez al día (no en cada barrido) y escribe historia/cierres.json y
// historia/version.json. Es igual para cualquiera: no lee reglas ni configuración personal.
//
//   node scanner/cierres.mjs --out out                      descarga real
//   node scanner/cierres.mjs --fixtures test/fixtures --out out-ejemplo   con cierres inventados
//
// Si un control falla, termina con error y no escribe nada: se conserva el archivo anterior.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { nyToday, sessionsBetween } from "../web/engine.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const key = process.argv[i];
  if (key.startsWith("--")) args[key.slice(2)] = process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[++i] : true;
}
const OUT = path.resolve(args.out ?? "out", "historia");
const FIXTURES = args.fixtures ? path.resolve(args.fixtures, "_cierres") : null;
const UA = "Mozilla/5.0 (compatible; centinela)";
const YEARS = 5;
const MAX_JUMP = 0.4; // un salto diario mayor huele a split sin ajustar o a otro producto con la misma sigla
const MAX_STALE = 4; // sesiones que puede llevar sin actualizarse el último cierre
const MAX_GAP_DAYS = 10; // hueco de calendario a partir del cual la historia anterior no se usa
// Nombres cuya sigla tuvo antes otro producto: su historia empieza aquí.
const DESDE = { IBIT: "2024-01-11" };

// En GitHub Actions deja el resultado como anotación del trabajo, que se lee sin abrir el registro.
const note = (kind, text) => {
  if (process.env.GITHUB_ACTIONS) console.log(`::${kind}::${String(text).replace(/\r?\n/g, " ").slice(0, 3000)}`);
};
const log = (...parts) => console.log(new Date().toISOString().slice(11, 19), ...parts);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const urlOf = (symbol) => `https://cdn.cboe.com/api/global/delayed_quotes/charts/historical/${encodeURIComponent(symbol)}.json`;

async function fetchHistory(symbol) {
  if (FIXTURES) {
    const file = path.join(FIXTURES, `${symbol}.json`);
    return existsSync(file) ? JSON.parse(await readFile(file, "utf8")) : null;
  }
  let last;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(urlOf(symbol), { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(30_000), redirect: "follow" });
      if (res.status === 404 || res.status === 403) return null;
      if (!res.ok) throw new Error(`respondió ${res.status}`);
      return await res.json();
    } catch (error) {
      last = error;
      await sleep(2_000 * (attempt + 1));
    }
  }
  throw last;
}

/** De la respuesta a { d, c }: últimos 5 años, en orden, sin repetidos y sin lo anterior a un hueco. */
export function toSeries(symbol, body, today) {
  const rows = Array.isArray(body?.data) ? body.data : [];
  const from = `${Number(today.slice(0, 4)) - YEARS}${today.slice(4)}`;
  const start = DESDE[symbol] && DESDE[symbol] > from ? DESDE[symbol] : from;
  const byDate = new Map();
  for (const row of rows) {
    const date = typeof row?.date === "string" ? row.date.slice(0, 10) : "";
    const close = Number(row?.close);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !(close > 0) || date < start || date > today) continue;
    byDate.set(date, close);
  }
  let dates = [...byDate.keys()].sort();
  let cut = false;
  for (let i = dates.length - 1; i > 0; i--) {
    if ((Date.parse(dates[i]) - Date.parse(dates[i - 1])) / 86_400_000 > MAX_GAP_DAYS) {
      dates = dates.slice(i);
      cut = true;
      break;
    }
  }
  const closes = dates.map((date) => Math.round(byDate.get(date) * 100) / 100);
  return { d: dates[0] ?? null, last: dates.at(-1) ?? null, c: closes, cut, dates };
}

/** Motivo por el que una serie no vale, o "" si vale. */
export function checkSeries(series, today) {
  if (series.c.length < 2) return "sin cierres";
  if (sessionsBetween(series.last, today) > MAX_STALE) return `último cierre atrasado (${series.last})`;
  for (let i = 1; i < series.c.length; i++) {
    if (Math.abs(series.c[i] / series.c[i - 1] - 1) > MAX_JUMP) {
      return `salto diario mayor del 40 % (${series.dates?.[i] ?? "?"}: ${series.c[i - 1]} → ${series.c[i]})`;
    }
  }
  return "";
}

/** Último día cuyo cierre ya es definitivo: hoy si la bolsa ya ha cerrado, si no ayer. */
function lastClosedDay(now = new Date()) {
  const today = nyToday(now);
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", hourCycle: "h23" }).format(now));
  return hour >= 17 ? today : new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
}

async function main() {
  const today = FIXTURES ? nyToday() : lastClosedDay();
  const universe = JSON.parse(await readFile(path.join(ROOT, "scanner", "universe.json"), "utf8"));
  const names = [...new Set(universe.bloques.flatMap((block) => block.nombres.map((row) => row.s)))];
  log(`Cierres de ${names.length} nombres`);
  const symbols = {};
  const missing = [];
  const bad = [];
  let shortened = 0;
  let last = "";
  for (const symbol of names) {
    const body = await fetchHistory(symbol);
    if (!FIXTURES) await sleep(1_100);
    if (!body) {
      missing.push(symbol);
      continue;
    }
    const series = toSeries(symbol, body, today);
    const why = checkSeries(series, today);
    if (why) {
      bad.push(`${symbol}: ${why}`);
      continue;
    }
    if (series.cut) shortened++;
    if (series.last > last) last = series.last;
    symbols[symbol] = { d: series.d, c: series.c };
  }
  if (bad.length) throw new Error(`Control fallido, no se publica: ${bad.join("; ")}`);
  const got = Object.keys(symbols).length;
  if (got < names.length * 0.8) throw new Error(`Solo hay historia de ${got} de ${names.length} nombres (sin respuesta: ${missing.join(", ")}); no se publica`);

  await mkdir(OUT, { recursive: true });
  // Si no ha cambiado nada (fin de semana, festivo), se conserva la hora anterior
  // y la app no vuelve a descargar el archivo.
  let at = Date.now();
  const file = path.join(OUT, "cierres.json");
  if (existsSync(file)) {
    try {
      const prev = JSON.parse(await readFile(file, "utf8"));
      if (JSON.stringify(prev.symbols) === JSON.stringify(symbols) && prev.at > 0) at = prev.at;
    } catch {
      /* archivo anterior ilegible: se escribe uno nuevo */
    }
  }
  await writeFile(file, JSON.stringify({ v: 1, at, last, example: Boolean(FIXTURES), symbols }));
  await writeFile(path.join(OUT, "version.json"), JSON.stringify({ cierres: at }));
  const summary = `Con historia ${got}, sin historia ${missing.length}${missing.length ? ` (${missing.join(", ")})` : ""}, recortados por hueco ${shortened}, último cierre ${last}`;
  log(summary);
  note("notice", summary);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    note("error", error.message);
    process.exit(1);
  });
}
