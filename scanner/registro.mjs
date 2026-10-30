// Registro de deals. Lo ejecuta el barrido de GitHub Actions tras guardar cada barrido con el mercado abierto
// (el último del día deja el resultado) y nunca un push. Escribe registro/AAAA-MM.csv (una fila por deal y día,
// un archivo por mes), registro/indice.json y registro/columnas.txt, y apunta el resultado de lo que ya venció.
//
//   node scanner/registro.mjs --out out                               con el barrido y los cierres de esa carpeta
//   node scanner/registro.mjs --fixtures test/fixtures --out out-ejemplo   con los datos de ejemplo
//
// Con las reglas de fábrica sobre la lista base: nada de lo que apunta nadie ni de sus reglas (el repositorio es público).
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_RULES, correlationGroups, daysBetween, nyToday, qualityDeals } from "../web/engine.js";
import { COLUMN_HELP, keyOf, parseCsv, resolveRows, toCsv } from "../web/registro-calc.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIN_LEVEL = 3;
const r2 = (n) => Math.round(n * 100) / 100;
const r1 = (n) => Math.round(n * 10) / 10;

/** Los deals de nivel 3 o más de este barrido, con las reglas de fábrica. `groups` viene de correlationGroups. */
export function dayRows({ symbols, hist, today, groups, rules = DEFAULT_RULES }) {
  const out = qualityDeals(
    symbols,
    { rules, fee: rules.equalFee, gapPct: rules.equalGapPct, safety: rules.levelSafety, marginK: rules.levelMargin, errVolPct: rules.errVolPct, errHistK: rules.errHistK, hist, held: [], price: "nat", maxProb: rules.maxProb, maxWidth: rules.width },
    today,
  );
  const rows = [];
  for (const d of out.deals) {
    if (!d.ok || d.level < MIN_LEVEL) continue;
    const r = d.row;
    const earnDte = d.sym.er?.d ? daysBetween(today, d.sym.er.d) : null;
    rows.push({
      fecha: today,
      primera: false,
      nombre: d.sym.s,
      vencimiento: r.expiry,
      corto: r.shortStrike,
      largo: r.longStrike,
      ancho: r2(r.width),
      neto: r2(r.net),
      nivel: d.level,
      retExp: r1(r.retExp),
      err: r.err == null ? null : r2(r.err),
      perdHist: r2(r.histLoss),
      perdVol: r2(r.recentLoss),
      desacuerdo: r2(Math.abs(r.histLoss - r.recentLoss)),
      prob: r.prob == null ? null : r1(r.prob),
      bloque: d.sym.b ?? "",
      grupo: groups?.of?.[d.sym.s] ?? d.sym.s,
      resultados: earnDte != null && earnDte >= 0 && earnDte <= r.dte + 2,
      cierre: null,
      resultado: null,
      estado: "",
    });
  }
  return rows;
}

/** Junta lo que ya había con las filas de hoy: las de hoy sustituyen a las de un barrido anterior del mismo día,
 *  se marca la primera aparición de cada deal y se apunta el resultado de lo que ya venció. */
export function updateRows(existing, todayRows, { today, hist, last }) {
  const before = existing.filter((row) => row.fecha !== today);
  const seen = new Set(before.map(keyOf));
  const fresh = todayRows.map((row) => {
    const first = !seen.has(keyOf(row));
    seen.add(keyOf(row));
    return { ...row, primera: first };
  });
  const rows = [...before, ...fresh];
  const resolved = resolveRows(rows, hist, last);
  rows.sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : a.nombre.localeCompare(b.nombre) || a.vencimiento.localeCompare(b.vencimiento) || b.corto - a.corto || b.largo - a.largo));
  return { rows, resolved, added: fresh.length, first: fresh.filter((row) => row.primera).length };
}

export async function readRegistry(dir) {
  if (!existsSync(dir)) return [];
  const files = (await readdir(dir)).filter((name) => /^\d{4}-\d{2}\.csv$/.test(name)).sort();
  const rows = [];
  for (const name of files) rows.push(...parseCsv(await readFile(path.join(dir, name), "utf8")));
  return rows;
}

export async function writeRegistry(dir, rows, { example = false } = {}) {
  await mkdir(dir, { recursive: true });
  const byMonth = new Map();
  for (const row of rows) {
    const month = row.fecha.slice(0, 7);
    if (!byMonth.has(month)) byMonth.set(month, []);
    byMonth.get(month).push(row);
  }
  for (const [month, list] of byMonth) await writeFile(path.join(dir, `${month}.csv`), toCsv(list));
  await writeFile(path.join(dir, "columnas.txt"), COLUMN_HELP);
  await writeFile(path.join(dir, "indice.json"), JSON.stringify({ v: 1, at: Date.now(), example, meses: [...byMonth.keys()].sort() }));
}

async function main() {
  const args = {};
  for (let i = 2; i < process.argv.length; i++) {
    const key = process.argv[i];
    if (key.startsWith("--")) args[key.slice(2)] = process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[++i] : true;
  }
  const out = path.resolve(args.out ?? path.join(ROOT, "out"));
  const scan = JSON.parse(await readFile(path.join(out, "data", "scan.json"), "utf8"));
  let file = null;
  try {
    file = JSON.parse(await readFile(path.join(out, "historia", "cierres.json"), "utf8"));
  } catch {
    /* sin cierres no hay nivel: no hay nada que guardar */
  }
  const hist = file?.symbols ?? null;
  if (!hist) {
    console.log("Sin cierres: no se guarda nada en el registro");
    return;
  }
  const universe = JSON.parse(await readFile(path.join(ROOT, "scanner", "universe.json"), "utf8"));
  const names = [...new Set(universe.bloques.flatMap((block) => block.nombres.map((row) => row.s)))];
  const groups = correlationGroups(hist, names, DEFAULT_RULES.corrMin);
  const today = scan.today ?? nyToday(new Date(scan.at));
  const dir = path.join(out, "registro");
  const existing = await readRegistry(dir);
  const todayRows = dayRows({ symbols: scan.symbols, hist, today, groups });
  const { rows, resolved, added, first } = updateRows(existing, todayRows, { today, hist, last: file.last ?? today });
  await writeRegistry(dir, rows, { example: Boolean(scan.example) });
  const msg = `Registro: ${added} deals de hoy (${first} por primera vez), ${resolved} vencidos resueltos, ${rows.length} filas en total`;
  console.log(msg);
  if (process.env.GITHUB_ACTIONS) console.log(`::notice title=Registro::${msg}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    // El registro no puede tumbar el barrido: se anota y se sigue.
    console.error(error.message);
    if (process.env.GITHUB_ACTIONS) console.log(`::warning title=Registro::${String(error.message).slice(0, 300)}`);
  });
}
