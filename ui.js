// Piezas de pantalla compartidas por Hoy, el Buscador y Reglas: un solo aspecto para lo mismo.

/** "No hay nada": un título corto, una o varias líneas de motivo y, si ayuda, un botón.
 *  `notes` es un texto o una lista de textos (ya escapados); `action` = { attrs, label } con los data-* del botón, o una lista de ellos. */
export const emptyBox = (title, notes = [], action = null) => {
  const lines = (Array.isArray(notes) ? notes : [notes]).filter(Boolean);
  const actions = (Array.isArray(action) ? action : [action]).filter(Boolean);
  return `<div class="empty"><h2>${title}</h2>${lines.map((line) => `<p class="small muted">${line}</p>`).join("")}${actions.length ? `<div class="empty-actions">${actions.map((a) => `<button class="btn quiet" ${a.attrs}>${a.label}</button>`).join("")}</div>` : ""}</div>`;
};

/** Un aviso en una línea o dos. Un solo lenguaje de color en toda la app: gris = informa, ámbar = conviene mirar, rojo = algo falla o baja el nivel (verde = bien, solo en números y en la caja de lectura).
 *  `kind`: "info" | "watch" | "bad". `text` va ya escapado. */
export const notice = (kind, text, style = "") => `<p class="notice small ${kind}"${style ? ` style="${style}"` : ""}>${text}</p>`;

/** El título de cada apartado (Hoy, ficha, Reglas, Avisos): mismo tamaño y margen, y a la derecha, si hace falta, un dato apagado. `title` y `meta` van ya escapados. */
export const sectionHead = (title, meta = "") => `<h2 class="group"><span>${title}</span>${meta ? `<span class="small muted num">${meta}</span>` : ""}</h2>`;
