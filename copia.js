// Copia de seguridad de lo que vive solo en este dispositivo (Mis deals, las que tengo, filtros guardados, reglas...).
// Se copia como un texto que el dueño guarda donde quiera; no se sube a ningún sitio ni entra en CENTINELA_CONFIG.
// No incluye la llave de GitHub, el puente ni los barridos guardados.

const KEYS = [
  "centinela.config.v1",
  "centinela.hoy.v1",
  "centinela.misdeals.v1",
  "centinela.buscador.v1",
  "centinela.buscador.guardados.v1",
  "centinela.tengo.v1",
  "centinela.pestana.v1",
];
const MAX_CHARS = 1_500_000;

/** Lee un texto pegado y devuelve { entries, summary } o { error }. Solo acepta las claves de KEYS. */
export function parseBackup(text) {
  let data;
  try {
    data = JSON.parse(String(text ?? "").trim());
  } catch {
    return { error: "Eso no es una copia de Centinela: no se puede leer." };
  }
  if (!data || data.centinela !== 1 || typeof data.datos !== "object" || data.datos === null || Array.isArray(data.datos)) {
    return { error: "Eso no es una copia de Centinela." };
  }
  const entries = Object.entries(data.datos).filter(([key, value]) => KEYS.includes(key) && value !== null && typeof value !== "function");
  if (!entries.length) return { error: "La copia no trae nada que restaurar." };
  if (JSON.stringify(entries).length > MAX_CHARS) return { error: "La copia es demasiado grande." };
  const get = (key) => entries.find(([k]) => k === key)?.[1];
  const count = (key, open = false) => (Array.isArray(get(key)) ? get(key).filter((d) => !open || (d && !d.closedAt)).length : 0);
  const parts = [];
  if (get("centinela.misdeals.v1")) parts.push(`${count("centinela.misdeals.v1", true)} deals abiertos y ${count("centinela.misdeals.v1") - count("centinela.misdeals.v1", true)} cerrados`);
  if (get("centinela.tengo.v1")) parts.push(`${count("centinela.tengo.v1")} acciones marcadas`);
  if (get("centinela.buscador.guardados.v1")) parts.push(`${count("centinela.buscador.guardados.v1")} combinaciones de filtros`);
  if (get("centinela.config.v1")) parts.push("las reglas y los nombres quitados");
  if (get("centinela.hoy.v1") || get("centinela.buscador.v1")) parts.push("los filtros de Hoy y del Buscador");
  return { entries, summary: parts.join(", ") || "tus ajustes", at: typeof data.guardado === "string" ? data.guardado.slice(0, 10) : "" };
}

export function createCopia(ctx) {
  const { esc, readLocal, writeLocal, render, root, sectionHead, notice } = ctx;
  const st = { text: "", pending: null, msg: null };

  const backupText = () => {
    const datos = {};
    for (const key of KEYS) {
      const value = readLocal(key);
      if (value !== null && value !== undefined) datos[key] = value;
    }
    return JSON.stringify({ centinela: 1, guardado: new Date().toISOString(), datos });
  };

  function view() {
    const p = st.pending;
    return `<section class="block" id="copia-seccion">
      ${sectionHead("Tus datos")}
      <p class="small muted">Todo lo tuyo (Mis deals, las que tengo, filtros guardados, reglas) vive solo en este dispositivo. Si cambias de móvil o borras los datos del navegador, se pierde. Aquí puedes sacar una copia como texto y guardarla donde quieras; no se sube a ningún sitio.</p>
      <div style="margin-top:10px"><button class="btn quiet" data-act="copia-copiar">Copiar mis datos</button></div>
      ${st.text ? `<textarea class="textfield" id="copia" readonly rows="4" aria-label="Copia de tus datos">${esc(st.text)}</textarea><p class="xs muted">${esc(st.msg?.text ?? "")}</p>` : ""}
      <form data-copia style="margin-top:14px">
        <label class="small muted" for="restaurar">Restaurar desde una copia</label>
        <textarea class="textfield" id="restaurar" name="texto" rows="3" placeholder="Pega aquí la copia" autocomplete="off"></textarea>
        <div style="margin-top:8px"><button class="btn quiet" type="submit">Revisar</button></div>
      </form>
      ${st.msg?.kind === "bad" ? notice("bad", esc(st.msg.text)) : ""}
      ${p ? `<div class="notice watch small" role="status">Se va a restaurar: ${esc(p.summary)}${p.at ? ` (copia del ${esc(p.at)})` : ""}. Esto reemplaza lo que hay ahora en este dispositivo.<div style="margin-top:8px;display:flex;gap:8px"><button class="btn quiet" data-act="copia-ok">Sí, restaurar</button><button class="btn quiet" data-act="copia-no">Cancelar</button></div></div>` : ""}
    </section>`;
  }

  /** Clic en uno de sus botones; devuelve true si era suyo. */
  function click(el) {
    const act = el.dataset.act;
    if (act === "copia-copiar") {
      st.text = backupText();
      st.msg = { kind: "info", text: "Copia hecha. Si no se ha copiado sola, mantén pulsado el texto y cópialo a mano." };
      try {
        navigator.clipboard?.writeText(st.text).catch(() => {});
      } catch {
        /* se queda el texto a la vista para copiarlo a mano */
      }
      render();
      root.querySelector("#copia")?.select();
    } else if (act === "copia-ok" && st.pending) {
      for (const [key, value] of st.pending.entries) writeLocal(key, value);
      st.pending = null;
      window.location.reload();
    } else if (act === "copia-no") {
      st.pending = null;
      st.msg = null;
      render();
    } else return false;
    return true;
  }

  /** Envío del formulario de restaurar; devuelve true si era suyo. */
  function submit(form) {
    if (!form.matches("[data-copia]")) return false;
    const result = parseBackup(new FormData(form).get("texto"));
    if (result.error) {
      st.pending = null;
      st.msg = { kind: "bad", text: result.error };
    } else {
      st.pending = result;
      st.msg = null;
    }
    render();
    return true;
  }

  return { view, click, submit };
}
