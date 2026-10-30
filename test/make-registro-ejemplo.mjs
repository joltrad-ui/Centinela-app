// Registro de ejemplo: cuatro vencimientos mensuales ya vencidos, con deals inventados, para ver la pestaña Registro con datos.
// No son datos de mercado. Escribe registro/ dentro de la carpeta de salida (por defecto out-ejemplo).
//   node test/make-registro-ejemplo.mjs [carpeta]
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { nyToday } from "../web/engine.js";
import { resultOf } from "../web/registro-calc.js";
import { writeRegistry } from "../scanner/registro.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(process.argv[2] ?? path.join(here, "..", "out-ejemplo"));
const today = nyToday();
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

let seed = 11;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (list) => list[Math.floor(rnd() * list.length)];

const universe = JSON.parse(await readFile(path.join(here, "..", "scanner", "universe.json"), "utf8"));
const blockOf = new Map(universe.bloques.flatMap((block) => block.nombres.map((row) => [row.s, block.nombre])));
const GROUPS = { SPY: "SPY+XSP+QQQ+IWM", XSP: "SPY+XSP+QQQ+IWM", QQQ: "SPY+XSP+QQQ+IWM", IWM: "SPY+XSP+QQQ+IWM", GLD: "GLD+SLV", SLV: "GLD+SLV" };
const names = ["SPY", "XSP", "QQQ", "IWM", "GLD", "SLV", "XLE", "AAPL", "MSFT", "KO", "COST", "TLT", "DIA", "EEM"].filter((s) => blockOf.has(s));

// Cuatro vencimientos, el más reciente hace unos días.
const expiries = [-118, -86, -52, -18].map((back) => {
  let day = addDays(today, back);
  while (new Date(`${day}T12:00:00Z`).getUTCDay() !== 5) day = addDays(day, -1);
  return day;
});

const rows = [];
expiries.forEach((expiry, e) => {
  const together = e === 2; // en este vencimiento pierden a la vez varios del mismo grupo
  for (let i = 0; i < 80; i++) {
    const name = pick(names);
    const width = pick([2.5, 5, 5, 10]);
    const level = pick([3, 3, 4, 4, 5]);
    const price = 60 + Math.floor(rnd() * 400);
    const short = Math.round((price * (0.9 + rnd() * 0.04)) / 2.5) * 2.5;
    const net = Math.round(width * 100 * (0.1 + rnd() * 0.12) - 1.4);
    const loss = width * 100 - net;
    const hist = Math.round(loss * (0.05 + rnd() * 0.1) * 100) / 100;
    const vol = Math.round((hist * (0.5 + rnd() * 1.1)) * 100) / 100;
    const dis = Math.round(Math.abs(hist - vol) * 100) / 100;
    const expected = (hist + vol) / 2;
    const retExp = Math.round(((net - expected) / loss) * 1000) / 10;
    // Pierde con probabilidad algo mayor si los dos cálculos discrepan mucho.
    const lose = (together && GROUPS[name] === "SPY+XSP+QQQ+IWM") || rnd() < 0.06 + Math.min(0.1, dis / loss);
    const close = lose ? short - width * (0.1 + rnd() * (together ? 1.2 : 0.6)) : short * (1 + rnd() * 0.08);
    const base = { nombre: name, vencimiento: expiry, corto: short, largo: short - width, ancho: width, neto: net, nivel: level, retExp, err: Math.round(expected * 0.4 * 100) / 100, perdHist: hist, perdVol: vol, desacuerdo: dis, prob: Math.round((6 + rnd() * 9) * 10) / 10, bloque: blockOf.get(name) ?? "", grupo: GROUPS[name] ?? name, resultados: rnd() < 0.08, cierre: Math.round(close * 100) / 100 };
    base.resultado = resultOf(base, base.cierre);
    base.estado = base.resultado > 0 ? "ganado" : "perdido";
    // Sale entre uno y tres días, desde cuatro a seis semanas antes de vencer.
    const days = 1 + Math.floor(rnd() * 3);
    const start = 28 + Math.floor(rnd() * 14);
    for (let d = 0; d < days; d++) rows.push({ ...base, fecha: addDays(expiry, -(start - d * 2)), primera: d === 0 });
  }
});
rows.sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : a.nombre.localeCompare(b.nombre)));
await writeRegistry(path.join(out, "registro"), rows, { example: true });
console.log(`Registro de ejemplo: ${rows.length} filas en ${path.join(out, "registro")}`);
