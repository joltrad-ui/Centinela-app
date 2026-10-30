// Registro de deals: el archivo de texto (CSV), el resultado al vencimiento y el análisis de la pestaña Registro.
// Sin pantalla ni red: lo usan el barrido (scanner/registro.mjs) y la app (registro.js). Nada personal: solo lo que
// propone Centinela con las reglas de fábrica sobre la lista base, que ya es pública.
import { sessionsBetween, DEFAULT_RULES } from "./engine.js";

/** Columnas del archivo, en orden: [campo, nombre en el CSV, tipo]. El mismo orden en todos los meses. */
export const COLUMNS = [
  ["fecha", "fecha", "s"],
  ["primera", "primera_aparicion", "b"],
  ["nombre", "nombre", "s"],
  ["vencimiento", "vencimiento", "s"],
  ["corto", "corto", "n"],
  ["largo", "largo", "n"],
  ["ancho", "ancho", "n"],
  ["neto", "cobro_neto", "n"],
  ["nivel", "nivel", "n"],
  ["retExp", "rentab_esperada", "n"],
  ["err", "error", "n"],
  ["perdHist", "perdida_historia", "n"],
  ["perdVol", "perdida_volatilidad", "n"],
  ["desacuerdo", "desacuerdo", "n"],
  ["prob", "prob_mercado", "n"],
  ["bloque", "bloque", "s"],
  ["grupo", "grupo", "s"],
  ["resultados", "resultados_en_plazo", "b"],
  ["cierre", "cierre_vencimiento", "n"],
  ["resultado", "resultado", "n"],
  ["estado", "estado", "s"],
];

/** Lo que significa cada columna, para quien lea el CSV sin la app (se publica como registro/columnas.txt). */
export const COLUMN_HELP = `Registro de deals de Centinela: una fila por deal y día, un archivo por mes (AAAA-MM.csv).
Son los bull puts de nivel 3 o más que proponía Centinela con las reglas de fábrica sobre la lista base, tras el último barrido del día.
Solo lo que Centinela propone: nada de lo que apunta nadie ni de sus reglas.

fecha                 Día del barrido (hora de Nueva York).
primera_aparicion     1 si es la primera vez que sale ese deal (mismo nombre, vencimiento y strikes); 0 si ya había salido otro día. El análisis usa solo las 1.
nombre                Símbolo.
vencimiento           Día en que vence.
corto, largo          Strike que se vende y strike que se compra.
ancho                 corto menos largo, en puntos (dólares por acción). Por contrato son ancho x 100 dólares.
cobro_neto            Dólares por contrato que se cobran, ya descontada la comisión de abrir.
nivel                 3, 4 o 5.
rentab_esperada       (cobro neto menos pérdida esperada) / lo que se arriesga, en %.
error                 El ± del cálculo de la pérdida esperada, en dólares por contrato.
perdida_historia      Pérdida esperada con 5 años de precios, en dólares por contrato.
perdida_volatilidad   Pérdida esperada con la volatilidad reciente, en dólares por contrato.
desacuerdo            Valor absoluto de la diferencia entre esos dos cálculos, en dólares por contrato. Solo se guarda: no cambia ninguna regla.
prob_mercado          Probabilidad de acabar por debajo del corto que sale de los precios del mercado, en %.
bloque                Bloque de la lista base.
grupo                 Nombres que se mueven casi igual (correlación diaria de 250 días de 0,85 o más), unidos con +.
resultados_en_plazo   1 si el nombre presenta resultados antes del vencimiento.
cierre_vencimiento    Cierre del subyacente el día del vencimiento (vacío hasta que vence).
resultado             Dólares por contrato: cobro neto menos la pérdida al vencimiento (como mucho el ancho x 100). Vacío hasta que vence.
estado                ganado si el resultado es positivo, perdido si no; vacío hasta que vence.
`;

const csvCell = (value) => {
  const text = value == null ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export function toCsv(rows) {
  const lines = [COLUMNS.map(([, name]) => name).join(",")];
  for (const row of rows) {
    lines.push(
      COLUMNS.map(([key, , type]) => {
        const v = row[key];
        return csvCell(type === "b" ? (v ? 1 : 0) : v);
      }).join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}

function splitCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else cell += ch;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/** Lee un CSV del registro. Las filas con otra forma se saltan. */
export function parseCsv(text) {
  const table = splitCsv(String(text ?? ""));
  if (table.length < 2) return [];
  const index = new Map(table[0].map((name, i) => [name.trim(), i]));
  const out = [];
  for (const cells of table.slice(1)) {
    const row = {};
    let ok = true;
    for (const [key, name, type] of COLUMNS) {
      const raw = index.has(name) ? (cells[index.get(name)] ?? "") : "";
      if (type === "n") {
        row[key] = raw === "" ? null : Number(raw);
        if (row[key] != null && !Number.isFinite(row[key])) ok = false;
      } else if (type === "b") row[key] = raw === "1";
      else row[key] = raw;
    }
    if (ok && row.fecha && row.nombre && row.vencimiento && row.corto != null && row.largo != null) out.push(row);
  }
  return out;
}

/** Clave de un deal: el mismo spread sale muchos días con esta misma clave. */
export const keyOf = (row) => `${row.nombre}|${row.vencimiento}|${row.corto}|${row.largo}`;

const addDay = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Cierre del subyacente el día `date` (si no hubo sesión, el de la sesión anterior). null si la serie aún no llega. */
export function closeOn(series, date) {
  const closes = series?.c;
  if (!Array.isArray(closes) || !series.d || date < series.d) return null;
  let day = date;
  for (let i = 0; i < 5 && sessionsBetween(addDay(day, -1), day) !== 1; i++) day = addDay(day, -1);
  const index = day === series.d ? 0 : sessionsBetween(series.d, day);
  const close = closes[index];
  return index < closes.length && Number.isFinite(close) ? close : null;
}

/** Resultado por contrato al vencimiento: lo cobrado menos la pérdida (como mucho el ancho), en dólares. */
export function resultOf(row, close) {
  const loss = Math.min(Math.max(row.corto - close, 0), row.ancho) * 100;
  return Math.round((row.neto - loss) * 100) / 100;
}

/** Apunta el resultado de las filas que ya vencieron y tienen cierre. Devuelve cuántas resolvió. */
export function resolveRows(rows, hist, lastDate) {
  let done = 0;
  for (const row of rows) {
    if (row.estado || row.vencimiento > lastDate) continue;
    const close = closeOn(hist?.[row.nombre], row.vencimiento);
    if (close == null) continue;
    row.cierre = Math.round(close * 100) / 100;
    row.resultado = resultOf(row, close);
    row.estado = row.resultado > 0 ? "ganado" : "perdido";
    done++;
  }
  return done;
}

// ---------- análisis ----------

export const MIN_MONTHS = 3; // vencimientos mensuales para que las señales se enciendan
export const MIN_N = 20; // deals vencidos que hacen falta en cada lado de una comparación

const mean = (list) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : null);
const sd = (list) => {
  if (list.length < 2) return null;
  const m = mean(list);
  return Math.sqrt(list.reduce((a, b) => a + (b - m) ** 2, 0) / (list.length - 1));
};

/** Lo que se esperaba ganar en dólares por contrato: rentab. esperada sobre lo que se arriesga. */
export const expectedUsd = (row) => (row.retExp == null ? null : (row.retExp / 100) * (row.ancho * 100 - row.neto));

export function stat(list) {
  const real = list.map((row) => row.resultado);
  const exp = list.map(expectedUsd).filter((v) => v != null);
  const ret = list.filter((row) => row.retExp != null).map((row) => row.retExp);
  return {
    n: list.length,
    won: list.filter((row) => row.estado === "ganado").length,
    pctWon: list.length ? (list.filter((row) => row.estado === "ganado").length / list.length) * 100 : null,
    real: mean(real),
    exp: mean(exp),
    retExp: mean(ret),
    sd: sd(real),
  };
}

const usd = (n) => `${n > 0.5 ? "+" : n < -0.5 ? "−" : ""}$${Math.round(Math.abs(n)).toLocaleString("es-ES")}`;
const dayLabel = (iso) => `${Number(iso.slice(8))} ${["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"][Number(iso.slice(5, 7)) - 1]}`;
const joinNames = (list) => (list.length < 2 ? list.join("") : `${list.slice(0, -1).join(", ")} y ${list[list.length - 1]}`);

/** Tres tramos de desacuerdo con el mismo número de deals: bajo, medio y alto. */
function thirds(list) {
  const sorted = [...list].sort((a, b) => a.desacuerdo - b.desacuerdo);
  const cut = (i) => Math.round((sorted.length * i) / 3);
  return { bajo: sorted.slice(0, cut(1)), medio: sorted.slice(cut(1), cut(2)), alto: sorted.slice(cut(2)) };
}

/** Todo lo que enseña la pestaña, con los deals ya vencidos y contados una vez (su primera aparición). */
export function analyze(rows, rules = DEFAULT_RULES) {
  const all = rows ?? [];
  const done = all.filter((row) => row.primera && row.estado && row.resultado != null);
  const months = new Set(done.map((row) => row.vencimiento.slice(0, 7)));
  const since = all.reduce((min, row) => (!min || row.fecha < min ? row.fecha : min), "");
  const level = (l) => done.filter((row) => row.nivel === l);
  const byLevel = [5, 4, 3].map((l) => ({ level: l, ...stat(level(l)) }));
  const hasDis = done.filter((row) => row.desacuerdo != null);
  const t = thirds(hasDis);
  const byDis = [["Bajo", t.bajo], ["Medio", t.medio], ["Alto", t.alto]].map(([label, list]) => ({ label, ...stat(list) }));

  // Por grupo, y los vencimientos en que varios nombres del mismo grupo perdieron a la vez.
  const groups = new Map();
  for (const row of done) {
    const key = row.grupo || row.nombre;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const need = Math.round(rules.sigGroup ?? DEFAULT_RULES.sigGroup);
  const events = [];
  const byGroup = [...groups.entries()]
    .map(([key, list]) => {
      const lost = new Map();
      for (const row of list) if (row.estado === "perdido") lost.set(row.vencimiento, [...(lost.get(row.vencimiento) ?? []), row.nombre]);
      let together = 0;
      for (const [expiry, names] of lost) {
        const distinct = [...new Set(names)];
        if (distinct.length >= need) {
          together++;
          events.push({ expiry, names: distinct, group: key });
        }
      }
      return { key, names: key.split("+"), together, ...stat(list) };
    })
    .sort((a, b) => b.n - a.n || a.key.localeCompare(b.key));
  events.sort((a, b) => (a.expiry < b.expiry ? 1 : a.expiry > b.expiry ? -1 : b.names.length - a.names.length));

  const on = months.size >= MIN_MONTHS;
  const total = stat(done);
  const signals = [];
  const lit = (color, title, text) => signals.push({ color: on ? color : "x", title, text: on ? text : `Se enciende con ${MIN_MONTHS} vencimientos mensuales; ahora hay ${months.size}.` });

  // 1. El nivel 5 rinde más que el 3.
  const l5 = byLevel[0];
  const l3 = byLevel[2];
  if (l5.n < MIN_N || l3.n < MIN_N) lit("a", "Nivel 5 frente a 3: todavía no se sabe", `Hay ${l5.n} deals vencidos de nivel 5 y ${l3.n} de nivel 3; hacen falta ${MIN_N} de cada.`);
  else if (l5.real > l3.real) lit("g", "El nivel 5 rinde más que el 3", `Media real: nivel 5 ${usd(l5.real)}, nivel 3 ${usd(l3.real)}.`);
  else lit("r", "El nivel 5 no rinde más que el 3", `Media real: nivel 5 ${usd(l5.real)}, nivel 3 ${usd(l3.real)}. El nivel no está ordenando bien.`);

  // 2. El desacuerdo alto rinde peor que el bajo (y no cabe en el azar).
  const lo = byDis[0];
  const hi = byDis[2];
  if (lo.n < MIN_N || hi.n < MIN_N) lit("a", "Desacuerdo: todavía no se sabe", `Hay ${hi.n} deals vencidos con desacuerdo alto y ${lo.n} con bajo; hacen falta ${MIN_N} de cada.`);
  else {
    const gap = lo.real - hi.real;
    const se = Math.sqrt((lo.sd ** 2) / lo.n + (hi.sd ** 2) / hi.n);
    const pair = `Alto ${usd(hi.real)} frente a bajo ${usd(lo.real)}`;
    if (gap <= 0) lit("g", "El desacuerdo no predice pérdidas", `${pair}.`);
    else if (se > 0 && gap > 2 * se) lit("r", "El desacuerdo predice pérdidas", `${pair}. Plantea meterlo en el error.`);
    else lit("a", "Desacuerdo: todavía no se sabe", `${pair}, pero la diferencia cabe en el azar.`);
  }

  // 3. Lo real no queda muy por debajo de lo esperado.
  const limit = (rules.sigReal ?? DEFAULT_RULES.sigReal) / 100;
  if (total.n < MIN_N || total.exp == null) lit("a", "Lo real frente a lo esperado: todavía no se sabe", `Hay ${total.n} deals vencidos; hacen falta ${MIN_N}.`);
  else if (total.real < total.exp - limit * Math.abs(total.exp)) lit("r", "Lo real queda por debajo de lo esperado", `Real ${usd(total.real)} de media; esperado ${usd(total.exp)}. La app es optimista; plantea endurecer el error.`);
  else lit("g", "Lo real se acerca a lo esperado", `Real ${usd(total.real)} de media; esperado ${usd(total.exp)}. Dentro de lo previsto.`);

  // 4. Ningún vencimiento con varios nombres de un mismo grupo perdiendo a la vez.
  if (events.length) {
    const e = events[0];
    lit("r", "Un grupo perdió junto", `${dayLabel(e.expiry)}: ${e.names.length} nombres (${joinNames(e.names)}) en pérdida a la vez. Revisa el umbral de correlación.`);
  } else lit("g", "Ningún grupo ha perdido junto", `En ningún vencimiento han perdido a la vez ${need} nombres o más del mismo grupo.`);

  return { n: done.length, months: months.size, since, few: months.size < MIN_MONTHS, signals, byLevel, byDis, byGroup, total, dayLabel };
}
