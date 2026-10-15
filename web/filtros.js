// Los filtros de barra, definidos una sola vez para Hoy, la ficha y el Buscador: mismos rótulos, mismos topes,
// mismo formato y, sobre todo, siempre el mismo orden: Nivel, Vence hasta, Ancho hasta, Prob. hasta.
// Cada pantalla dice cuáles tiene y con qué ids/atributos; aquí se pintan y aquí se cambian los topes.

export const W = { min: 100, max: 1000, step: 50 }; // ancho hasta, en dólares por contrato ("ancho $600" en las filas)
export const PR = { min: 3, max: 30, step: 1 }; // prob. de asignación hasta, en %

export const fmtUsd = (v) => `$${v}`;
export const fmtPct = (v) => `${v} %`;
export const fmtDays = (v) => `${v} d`;

const BARS = {
  days: { label: "Vence hasta", fmt: fmtDays, aria: "Vence en estos días o menos", step: 1 },
  w: { label: "Ancho hasta", fmt: fmtUsd, aria: "Ancho máximo del spread, en dólares por contrato", ...W },
  pr: { label: "Prob. hasta", fmt: fmtPct, aria: "Prob. de asignación máxima", ...PR },
};
/** Formato de la etiqueta de un deslizador por su id (`hoy-pr-range`, `fi-days-range`...). */
export const fmtOf = (id) => BARS[id.split("-")[1]]?.fmt;

/** Una fila de filtro: etiqueta a la izquierda y los controles a la derecha. */
export const filterRow = (label, inner, cls = "") => `<div class="fi-f"><span class="fi-f-l small muted">${label}</span><div class="fi-f-c${cls}">${inner}</div></div>`;

const bar = (kind, id, value, min = BARS[kind].min, max = BARS[kind].max) => {
  const b = BARS[kind];
  return filterRow(b.label, `<input type="range" class="range" id="${id}" min="${min}" max="${max}" step="${b.step}" value="${value}" aria-label="${b.aria}"><b class="num fi-range-v" id="${id}-val">${b.fmt(value)}</b>`, " sl");
};

/** Los chips de nivel 0–5. `attr` = los atributos del botón (p. ej. `data-bs="lv"`). */
export const levelRow = (attr, selected) => filterRow("Nivel", [0, 1, 2, 3, 4, 5].map((l) => `<button class="lv lv${l} fi-lvb" ${attr} data-v="${l}" aria-pressed="${selected.includes(l)}" aria-label="Nivel ${l}">${l}</button>`).join(""));

/** Una fila plegable con el mismo aspecto que las demás: la etiqueta a la izquierda y un campo (fondo de barra, ▾ a la derecha) que enseña lo marcado
 *  o "ninguno". Al tocarlo se abren las opciones debajo, con "Listo". `toggle` = atributos del botón; `options` = html de las opciones.
 *  `summary` = texto de lo marcado ("" = ninguno, se enseña apagado con `none`). `note` = una línea de explicación al abrir. */
export const foldRow = (label, toggle, open, summary, options, { none = "ninguno", note = "" } = {}) => {
  const field = `<button class="fi-field${summary ? "" : " none"}" ${toggle} aria-expanded="${open}"><span>${summary || none}</span><i aria-hidden="true">${open ? "▴" : "▾"}</i></button>`;
  if (!open) return `<div class="fi-f"><span class="fi-f-l small muted">${label}</span><div class="fi-f-c fi-fc">${field}</div></div>`;
  return `<div class="fi-f fi-open"><span class="fi-f-l small muted">${label}</span><div class="fi-f-c fi-fc fi-fc-open">${field}<div class="fi-chips">${options}<button class="chip quiet hoy-edit" ${toggle} aria-expanded="true">Listo</button></div>${note ? `<p class="xs muted fi-fnote">${note}</p>` : ""}</div></div>`;
};

/** "Elegir una" entre varias: una barra segmentada (la misma que la de orden). `attr` = atributos de cada botón (p. ej. `data-bs="margin"`);
 *  `options` = [[valor, texto], ...]; el valor va en `data-v`. Para varias casillas independientes se usan chips en una fila plegable. */
export const choiceRow = (label, attr, options, current) =>
  filterRow(label, `<div class="sortbar eq" role="group" aria-label="${label}">${options.map(([id, text]) => `<button ${attr} data-v="${id}" aria-pressed="${current === id}">${text}</button>`).join("")}</div>`, " sl");

/** Las barras de una pantalla, en el orden de siempre. Las que no se pasan no salen.
 *  `prefix` da los ids (`bs-w-range`...); `lv` = { attr, selected }; `days` = { min, max, value }; `w` y `pr` = valor actual. */
export function filterBars({ prefix, lv, days, w, pr }) {
  return [
    lv ? levelRow(lv.attr, lv.selected) : "",
    days && days.max > days.min ? bar("days", `${prefix}-days-range`, Math.min(days.max, days.value ?? days.max), days.min, days.max) : "",
    w != null ? bar("w", `${prefix}-w-range`, w) : "",
    pr != null ? bar("pr", `${prefix}-pr-range`, pr) : "",
  ].join("\n");
}

/** "Más filtros ▾ · N activos": el desplegable de los filtros menos usados. `attr` = atributos del botón.
 *  `extra.help` = { attr, open } pone un "?" a la derecha; `extra.reset` = atributos del botón "Quitar filtros" (solo sale si hay filtros puestos). */
export const moreHead = (attr, open, n, extra = {}) => {
  const right = [
    extra.help ? `<button class="fhead-i" ${extra.help.attr} aria-expanded="${Boolean(extra.help.open)}" aria-label="Qué significan los filtros">?</button>` : "",
    extra.reset && n ? `<button class="fhead-q" ${extra.reset}>Quitar filtros</button>` : "",
  ].join("");
  return `<div class="fhead"><button class="fhead-b" ${attr} aria-expanded="${open}">${open ? "Menos filtros ▴" : "Más filtros ▾"}</button><span class="small">· ${n ? `${n} ${n === 1 ? "activo" : "activos"}` : "ninguno activo"}</span>${right ? `<span class="fhead-r">${right}</span>` : ""}</div>`;
};

/** El recuadro de los filtros de "Más filtros": las filas juntas, sobre un fondo suave. */
export const morePanel = (inner) => `<div class="fi-more">${inner}</div>`;
