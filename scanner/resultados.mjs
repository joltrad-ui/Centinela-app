// Fechas de resultados: piezas puras del barrido (sin red), para poder probarlas.
// Fuente principal: el calendario de resultados de Nasdaq (una consulta por día, para todos los nombres).
// Respaldo: la fuente anterior (stockanalysis.com, una consulta por nombre).

const DAY = 86_400_000;

/** Días laborables desde `today` y los siguientes `ahead` días naturales (YYYY-MM-DD). */
export function calendarDays(today, ahead = 75) {
  const out = [];
  const start = Date.parse(`${today}T12:00:00Z`);
  for (let i = 0; i <= ahead; i++) {
    const t = new Date(start + i * DAY);
    const weekday = t.getUTCDay();
    if (weekday !== 0 && weekday !== 6) out.push(t.toISOString().slice(0, 10));
  }
  return out;
}

/** "antes de la apertura", "después del cierre" u "hora sin confirmar", según lo que dice Nasdaq. */
export function nasdaqSession(time) {
  const raw = String(time ?? "").toLowerCase();
  if (raw.includes("pre")) return "antes de la apertura";
  if (raw.includes("after")) return "después del cierre";
  return "hora sin confirmar";
}

/** De la respuesta de Nasdaq para un día: los nombres que nos interesan con su hora. */
export function parseNasdaq(body, date, wanted) {
  const rows = Array.isArray(body?.data?.rows) ? body.data.rows : [];
  const out = [];
  for (const row of rows) {
    const symbol = typeof row?.symbol === "string" ? row.symbol.trim().toUpperCase() : "";
    if (symbol && wanted.has(symbol)) out.push({ s: symbol, d: date, x: `${nasdaqSession(row.time)}, según Nasdaq` });
  }
  return out;
}

/** La fecha más próxima de cada nombre entre todas las consultas. */
export function earliest(found) {
  const best = new Map();
  for (const hit of found) {
    const old = best.get(hit.s);
    if (!old || hit.d < old.d) best.set(hit.s, hit);
  }
  return best;
}

/** Qué se guarda de un nombre: la fecha nueva si la hay; si no, la que ya tenía mientras no haya pasado
 *  (una consulta vacía no borra una fecha buena). */
export function mergeEarnings(prev, hit, today) {
  if (hit?.d) return { d: hit.d, x: hit.x };
  if (prev?.d && prev.d >= today) return { d: prev.d, x: prev.x ?? "" };
  return { d: null, x: "" };
}

/** ¿Pinta mal? Muchas consultas y ninguna con fecha: la fuente ha cambiado o falla, no es que no haya resultados. */
export const suspicious = (asked, withDate) => asked >= 5 && withDate === 0;
