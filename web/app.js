import {
  DEFAULT_CONFIG,
  DEFAULT_RULES,
  RULES_V,
  cboeUrl,
  pricesOutsideMarket,
  labelOf,
  normalizeConfig,
  num,
  nyToday,
  readCboeChain,
  rulesLine,
} from "./engine.js";
import { createHoy } from "./hoy.js";
import { notice, sectionHead } from "./ui.js";
import { createBuscador } from "./buscador.js";
import { createReglas } from "./reglas.js";
import { fmtOf } from "./filtros.js";
import { createAvisos } from "./avisos.js";
import { createConexion } from "./conexion.js";
import { createCopia } from "./copia.js";

const LS_CONFIG = "centinela.config.v1";
const LS_GH = "centinela.github.v1";
const LS_SEEN = "centinela.avisos.vistos";
const LS_TAB = "centinela.pestana.v1";
const TABS = ["hoy", "buscador", "avisos", "reglas"];
const LS_COPIED = "centinela.secreto.copiado";
const LS_EQUAL = "centinela.igual.v1";
const root = document.getElementById("app");
// Versión de prueba: la página trae los datos dentro y no lee de la red.
const EMBED = typeof window !== "undefined" && window.__CENTINELA__ ? window.__CENTINELA__ : null;

function shiftIso(iso, days) {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}
/** Los datos de ejemplo se mueven a hoy para que los plazos sigan teniendo sentido. */
function refreshExample(scan) {
  const today = nyToday();
  const days = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${scan.today}T00:00:00Z`)) / 86_400_000);
  if (!days) return scan;
  for (const sym of scan.symbols) {
    for (const row of sym.x) row[0] = shiftIso(row[0], days);
    if (sym.er?.d) sym.er.d = shiftIso(sym.er.d, days);
  }
  scan.today = today;
  scan.at = Date.now();
  return scan;
}

const state = {
  tab: "hoy", // se abre en la última que usaste (`restoreTab`); la primera vez, Hoy
  scan: null,
  alerts: [],
  config: normalizeConfig(DEFAULT_CONFIG),
  publishedAt: 0,
  mode: "nube", // "nube" (GitHub) u "ordenador"
  loading: true,
  checking: false, // enseñando lo guardado mientras se mira si hay barrido nuevo
  offline: false,
  error: null,
  sync: { state: "idle", message: "" },
  gh: loadGh(),
  showGh: false,
  kept: "", // dónde quedó guardado el último barrido real: "cuenta", "dispositivo" o "no"
  copied: "",
  hist: null, // cierres diarios de la lista (historia/cierres.json), si los hay
  refresh: null, // última comprobación del barrido: { at, result: "nuevo" | "igual" | "sin-conexion" | "error" | "leido" }
};
migrateEqualFee();



/** La comisión de "Igual riesgo" vivía en esta pestaña (`centinela.igual.v1`); ahora es una regla (`equalFee`).
 *  Si había una guardada, pasa a las reglas del dispositivo una sola vez. */
function migrateEqualFee() {
  const saved = readLocal(LS_EQUAL);
  if (!saved || typeof saved.fee !== "number") return;
  const config = readLocal(LS_CONFIG);
  if (saved.fee >= 0 && saved.fee <= 20) {
    if (config && typeof config === "object") {
      if (config.rules && typeof config.rules === "object" && config.rules.equalFee === undefined) writeLocal(LS_CONFIG, { ...config, rules: { ...config.rules, equalFee: saved.fee } });
      else if (!config.rules) writeLocal(LS_CONFIG, { ...config, rules: { v: RULES_V, equalFee: saved.fee } });
    } else if (saved.fee !== DEFAULT_RULES.equalFee) {
      writeLocal(LS_CONFIG, { rules: { v: RULES_V, equalFee: saved.fee }, savedAt: 0 });
    }
  }
  const { fee, ...rest } = saved;
  writeLocal(LS_EQUAL, rest);
}


// ---------- almacenamiento ----------

function readLocal(key) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function writeLocal(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function loadGh() {
  const saved = readLocal(LS_GH) ?? {};
  const host = window.location.hostname;
  const guessOwner = host.endsWith(".github.io") ? host.slice(0, -".github.io".length) : "";
  return {
    owner: saved.owner || guessOwner,
    repo: saved.repo || "centinela",
    token: saved.token || "",
  };
}

async function getJson(url) {
  const res = await fetch(`${url}${url.includes("?") ? "&" : "?"}t=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}

const b64encode = (text) => btoa(String.fromCharCode(...new TextEncoder().encode(text)));
const b64decode = (text) => new TextDecoder().decode(Uint8Array.from(atob(text.replace(/\s/g, "")), (c) => c.charCodeAt(0)));

async function ghRequest(method, body) {
  const { owner, repo, token } = state.gh;
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/config.json${method === "GET" ? `?t=${Date.now()}` : ""}`, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(res.status === 401 || res.status === 403 ? "La llave no vale o no tiene permiso" : res.status === 404 ? "No encuentro ese repositorio" : `GitHub respondió ${res.status}`);
  return res.json();
}

const ghReady = () => Boolean(state.gh.owner && state.gh.repo && state.gh.token);

/** App publicada sin llave: el barrido es público y genérico; las reglas se quedan en el dispositivo. */
const isPublic = () => state.mode === "nube" && !ghReady();

/** Lee un archivo JSON del repositorio privado. Los barridos están en la rama "data". */
async function ghJson(file, ref) {
  const { owner, repo, token } = state.gh;
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${file}?ref=${ref}&t=${Date.now()}`, {
    headers: { Accept: "application/vnd.github.raw+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28" },
  });
  if (!res.ok) throw Object.assign(new Error(String(res.status)), { status: res.status });
  return res.json();
}

// ---------- barrido guardado en el dispositivo ----------
// La app publicada enseña al momento lo último que guardó y solo descarga un archivo
// del barrido cuando data/version.json dice que ha cambiado.

const DATA_CACHE = "centinela-datos-v1";
const SCAN_FILE = "data/scan.json";

async function keptJson(name) {
  try {
    const cache = await caches.open(DATA_CACHE);
    const hit = await cache.match(name);
    return hit ? await hit.json() : null;
  } catch {
    return null;
  }
}

/** Descarga el barrido y lo deja guardado para la próxima vez. */
async function fetchAndKeep(name, stamp) {
  const res = await fetch(`${name}?v=${stamp}`, { cache: "no-store" });
  if (!res.ok) throw Object.assign(new Error(String(res.status)), { status: res.status });
  const text = await res.text();
  const json = JSON.parse(text);
  try {
    const cache = await caches.open(DATA_CACHE);
    await cache.put(name, new Response(text, { headers: { "Content-Type": "application/json" } }));
    await cache.delete("data/rapido.json"); // de la versión anterior
  } catch {
    /* sin sitio para guardar: se descargará otra vez la próxima */
  }
  return json;
}

// Cierres diarios para la pestaña "Igual riesgo". Mismo trato que el barrido: se enseña lo
// guardado y solo se descarga cuando historia/version.json dice que ha cambiado.
const HIST_FILE = "historia/cierres.json";

async function loadHist() {
  if (EMBED) return;
  const show = (hist) => {
    if (!hist?.symbols) return;
    state.hist = hist;
    if (state.tab === "igual" || state.tab === "hoy") render();
  };
  let hist = state.hist ?? (await keptJson(HIST_FILE));
  show(hist);
  try {
    const stamp = Number((await getJson("historia/version.json")).cierres) || 0;
    if (stamp > 0 && hist?.at !== stamp) show(await fetchAndKeep(HIST_FILE, stamp));
  } catch {
    /* todavía no hay cierres publicados, o no hay conexión: se sigue con lo guardado */
  }
}

async function loadPublic() {
  const local = readLocal(LS_CONFIG);
  if (local) state.config = normalizeConfig(local);
  state.alerts = [];
  state.publishedAt = 0;
  let scan = await keptJson(SCAN_FILE);
  if (scan?.symbols?.length) {
    state.scan = scan;
    state.loading = false;
    state.checking = true;
    render();
  }
  let offline = false;
  let downloaded = false;
  let fetchFailed = false;
  try {
    let stamp = 0;
    try {
      stamp = Number((await getJson("data/version.json")).scan) || 0;
    } catch (error) {
      if (error?.message !== "404") throw error; // 404: todavía no hay archivo de versiones
    }
    if (!scan?.symbols?.length || (stamp > 0 && scan.at !== stamp)) {
      try {
        scan = await fetchAndKeep(SCAN_FILE, stamp || Date.now());
        downloaded = true;
      } catch (error) {
        if (!error?.status) throw error;
        fetchFailed = true;
      }
    }
  } catch {
    offline = true;
  }
  state.checking = false;
  state.loading = false;
  state.scan = scan?.symbols?.length ? scan : null;
  state.error = state.scan ? null : offline ? "No se pudo leer el barrido. Comprueba la conexión." : "Todavía no hay ningún barrido publicado.";
  state.offline = offline && Boolean(state.scan);
  state.refresh = { at: Date.now(), result: !state.scan ? "error" : offline ? "sin-conexion" : fetchFailed ? "error" : downloaded ? "nuevo" : "igual" };
  render();
}

// ---------- carga ----------

async function load() {
  state.loading = true;
  state.error = null;
  render();
  if (EMBED) {
    state.mode = "muestra";
    const savedScan0 = readLocal(LS_REAL)?.scan;
    state.scan = savedScan0?.symbols?.length ? savedScan0 : refreshExample(EMBED.scan);
    state.alerts = EMBED.alerts ?? [];
    const mine = readLocal(LS_CONFIG);
    state.config = normalizeConfig(mine ?? EMBED.config ?? DEFAULT_CONFIG);
    // Si cambia la lista de nombres de la versión de prueba, los favoritos
    // vuelven a los de la muestra; las reglas guardadas se conservan.
    if (EMBED.id && readLocal("centinela.muestra") !== EMBED.id) {
      state.config = normalizeConfig({ ...state.config, favorites: EMBED.config?.favorites ?? [], extra: [] });
      writeLocal(LS_CONFIG, state.config);
      writeLocal("centinela.muestra", EMBED.id);
    }
    state.sync = { state: "local", message: "" };
    state.kept = state.scan?.real ? "dispositivo" : "";
    state.loading = false;
    render();
    // Lo guardado en la cuenta manda si es más reciente que lo de este dispositivo.
    const [savedScan, savedConfig] = await Promise.all([cloudRead("scan"), cloudRead("config")]);
    if (savedScan?.symbols?.length && (!state.scan?.real || savedScan.at >= state.scan.at)) {
      state.scan = savedScan;
      state.kept = "cuenta";
    }
    if (savedConfig && (savedConfig.savedAt ?? 0) > state.config.savedAt) {
      state.config = normalizeConfig(savedConfig);
      writeLocal(LS_CONFIG, state.config);
    }
    render();
    return;
  }
  if (window.location.hostname.endsWith(".github.io")) {
    state.mode = "nube"; // publicada: no hay ordenador al que preguntar
  } else {
    try {
      await getJson("api/ping");
      state.mode = "ordenador";
    } catch {
      state.mode = "nube";
    }
  }
  if (isPublic()) return loadPublic();
  // Con la llave puesta, los datos salen del repositorio privado; si no, de la propia dirección.
  const fromRepo = state.mode === "nube" && ghReady();
  try {
    state.scan = fromRepo ? await ghJson("data/scan.json", "data") : await getJson("data/scan.json");
  } catch (error) {
    state.scan = null;
    state.error = !fromRepo
      ? state.mode === "nube"
        ? "Todavía no hay ningún barrido publicado. El primero tarda unos diez minutos."
        : "Todavía no hay ningún barrido."
      : error?.status === 401 || error?.status === 403
        ? "La llave no vale o no tiene permiso para leer el repositorio. Revísala en Reglas."
        : error?.status === 404
          ? "No encuentro el barrido en tu repositorio. O aún no se ha hecho el primero, o el usuario y el repositorio de Reglas no son los correctos."
          : "No se pudo leer el barrido de tu repositorio. Comprueba la conexión.";
  }
  // En la versión pública los avisos no se publican: llegan solo a ntfy.
  try {
    state.alerts = isPublic() ? [] : ((fromRepo ? await ghJson("data/alerts.json", "data") : await getJson("data/alerts.json")).log ?? []);
  } catch {
    state.alerts = [];
  }

  let published = null;
  try {
    published = state.mode === "ordenador" ? await getJson("api/config") : null;
  } catch {
    /* sin reglas publicadas todavía */
  }
  if (state.mode === "nube" && ghReady()) {
    try {
      const file = await ghRequest("GET");
      published = JSON.parse(b64decode(file.content));
    } catch {
      /* se queda con la copia publicada */
    }
  }
  const pub = published ? normalizeConfig(published) : null;
  state.publishedAt = pub?.savedAt ?? 0;
  const local = readLocal(LS_CONFIG);
  const mine = local ? normalizeConfig(local) : null;
  if (mine && (!pub || mine.savedAt > pub.savedAt)) {
    state.config = mine;
    if (pub && mine.savedAt > pub.savedAt) queueSave();
  } else if (pub) {
    state.config = pub;
    writeLocal(LS_CONFIG, pub);
  }
  state.loading = false;
  state.refresh = { at: Date.now(), result: state.scan ? "leido" : "error" };
  render();
}

// ---------- guardar reglas y favoritos ----------

let saveTimer = null;

function changeConfig(mutate) {
  const next = structuredClone(state.config);
  mutate(next);
  state.config = normalizeConfig({ ...next, savedAt: Date.now() });
  writeLocal(LS_CONFIG, state.config);
  queueSave();
  render();
}

function queueSave() {
  if (saveTimer != null) window.clearTimeout(saveTimer);
  if (state.mode === "muestra") {
    state.sync = { state: "local", message: "" };
    saveTimer = window.setTimeout(() => {
      saveTimer = null;
      void cloudWrite("config", state.config).then((ok) => {
        state.sync = { state: ok ? "saved" : "local", message: "" };
        if (state.tab === "reglas" || state.tab === "avisos") render();
      });
    }, 1500);
    return;
  }
  if (state.mode === "nube" && !ghReady()) {
    state.sync = { state: "local", message: "" };
    return;
  }
  state.sync = { state: "pending", message: "" };
  saveTimer = window.setTimeout(saveNow, 1800);
}

async function saveNow() {
  saveTimer = null;
  const config = state.config;
  state.sync = { state: "saving", message: "" };
  render();
  try {
    if (state.mode === "ordenador") {
      const res = await fetch("api/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(config) });
      if (!res.ok) throw new Error(`El ordenador respondió ${res.status}`);
    } else {
      const current = await ghRequest("GET");
      await ghRequest("PUT", {
        message: "Reglas y favoritos desde la app",
        content: b64encode(`${JSON.stringify(config, null, 2)}\n`),
        sha: current.sha,
      });
    }
    state.publishedAt = config.savedAt;
    state.sync = { state: "saved", message: "" };
  } catch (error) {
    state.sync = { state: "error", message: error instanceof Error ? error.message : "No se pudo guardar" };
  }
  render();
}

function syncLine() {
  const s = state.sync.state;
  if (state.mode === "muestra") {
    return s === "saved"
      ? "Reglas y favoritos guardados en tu cuenta de Claude. No barre ni avisa sola."
      : "Tus cambios se guardan en este dispositivo. No barre ni avisa sola.";
  }
  if (state.mode === "ordenador") {
    if (s === "error") return `No se pudo guardar en el ordenador: ${state.sync.message}`;
    return s === "saving" || s === "pending" ? "Guardando en el ordenador…" : "Guardado en este ordenador. Los avisos usan estas reglas.";
  }
  if (!ghReady()) {
    return "Guardado solo en este dispositivo. No se publica.";
  }
  if (s === "error") return `No se pudo guardar en tu repositorio: ${state.sync.message}`;
  if (s === "saving" || s === "pending") return "Guardando en tu repositorio privado…";
  return "Guardado en tu repositorio privado. El siguiente barrido ya usa estas reglas y favoritos.";
}

// ---------- datos reales en la versión de prueba ----------
// Solo para la app con datos incrustados (un archivo suelto o una página de prueba).
// La app publicada no usa nada de esto: sus datos vienen del barrido.

const LS_REAL = "centinela.real.v1";
const real = { busy: false, done: 0, total: 0, note: "", error: "", lastPaint: 0 };
/** Otra fuente de datos, si la página que incrusta la app trae una. */
let extraSource = null;

// Guardado en la cuenta de Claude de quien mira la página: sobrevive a cerrar
// la app y vale en todos sus dispositivos. Fuera de Claude no existe.
let cloud = null; // null = sin mirar todavía; false = no disponible
async function cloudStore() {
  if (cloud !== null) return cloud || null;
  try {
    const [db, user] = await Promise.all([window.claude?.use?.("db"), window.claude?.use?.("user")]);
    const id = db && user ? await user.id() : null;
    cloud = id ? { scan: db.doc(`data/users/${id}/scan`), config: db.doc(`data/users/${id}/config`) } : false;
  } catch {
    cloud = false;
  }
  return cloud || null;
}
async function cloudRead(kind) {
  const store = await cloudStore();
  if (!store) return null;
  try {
    const snap = await store[kind].get();
    const json = snap.exists ? snap.data()?.json : null;
    return typeof json === "string" ? JSON.parse(json) : null;
  } catch {
    return null;
  }
}
async function cloudWrite(kind, value) {
  const store = await cloudStore();
  if (!store) return false;
  try {
    await store[kind].set({ json: JSON.stringify(value), savedAt: Date.now() });
    return true;
  } catch {
    return false;
  }
}

/** Guarda el barrido real donde se pueda y deja dicho dónde quedó. */
async function keepScan(scan, ids) {
  const local = writeLocal(LS_REAL, { ids, scan });
  const account = await cloudWrite("scan", scan);
  state.kept = account ? "cuenta" : local ? "dispositivo" : "no";
}

function realPaint(force = false) {
  const now = Date.now();
  if (!force && now - real.lastPaint < 500) return;
  real.lastPaint = now;
  render();
}

// Un archivo suelto no puede leer CBOE directamente si CBOE no lo permite.
// Un "puente" es un servicio que pide los datos por la página y se los devuelve.
// Los tres de la lista son gratuitos y de terceros: pueden fallar o cambiar.
const LS_BRIDGE = "centinela.puente";
const BRIDGES = [
  { id: "directo", url: (u) => u },
  { id: "allorigins", url: (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}` },
  { id: "corsproxy", url: (u) => `https://corsproxy.io/?url=${encodeURIComponent(u)}` },
  { id: "codetabs", url: (u) => `https://api.codetabs.com/v1/proxy/?quest=${encodeURIComponent(u)}` },
];
function bridgeList() {
  const own = String(readLocal(LS_BRIDGE) ?? "").trim();
  return own.startsWith("https://") ? [{ id: "propio", url: (u) => own + encodeURIComponent(u) }, ...BRIDGES] : BRIDGES;
}

/** Pide la cadena de un nombre probando los puentes por orden; recuerda el que funciona. */
async function fetchCboe(name, bridges, memo) {
  const variants = name.includes(".") ? [name.replace(".", ""), name] : [name];
  const order = memo.good ? [memo.good, ...bridges.filter((item) => item !== memo.good)] : bridges;
  let lastError = "sin respuesta";
  for (const bridge of order) {
    if (memo.dead.has(bridge.id)) continue;
    for (const variant of variants) {
      try {
        const res = await fetch(bridge.url(cboeUrl(variant)), { cache: "no-store", signal: AbortSignal.timeout(45_000) });
        if (!res.ok) {
          lastError = `${bridge.id}: respondió ${res.status}`;
          continue;
        }
        const body = await res.json();
        if (body?.data?.options) {
          memo.good = bridge;
          return { body, via: bridge.id };
        }
        lastError = `${bridge.id}: respuesta sin datos`;
      } catch (error) {
        lastError = `${bridge.id}: ${error?.name === "TimeoutError" ? "tardó demasiado" : "el navegador no pudo leerlo"}`;
        // Si el navegador niega la lectura directa, no se vuelve a intentar con los demás nombres.
        if (bridge.id === "directo" && error instanceof TypeError) memo.dead.add("directo");
        break;
      }
    }
  }
  throw new Error(lastError);
}

/** Una línea del resumen de lectura: qué se leyó de un nombre (`readSummary` la enseña). */
function logLine(sym, via) {
  return { s: sym.s, ok: true, p: sym.p, exp: sym.x.length, puts: sym.x.reduce((sum, item) => sum + item[2].length, 0), via };
}

/** Lectura de CBOE desde el navegador (archivo descargado, sin servidor). */
async function loadCboe() {
  if (real.busy) return;
  real.busy = true;
  real.error = "";
  real.done = 0;
  const names = (state.config.favorites.length ? state.config.favorites : listSymbols().map((sym) => sym.s)).slice(0, 12);
  real.total = names.length;
  realPaint(true);
  const today = nyToday();
  const known = new Map((EMBED?.scan?.symbols ?? []).map((sym) => [sym.s, sym.n]));
  const bridges = bridgeList();
  const memo = { good: null, dead: new Set() };
  const symbols = [];
  const failed = [];
  const log = [];
  for (const name of names) {
    real.note = `Leyendo ${name} en CBOE…`;
    realPaint(true);
    try {
      const { body, via } = await fetchCboe(name, bridges, memo);
      const sym = readCboeChain(name, body, today);
      if (!sym) throw new Error("respuesta sin precio");
      sym.n = known.get(name) ?? name;
      sym.er = null;
      symbols.push(sym);
      log.push(logLine(sym, via));
    } catch (error) {
      failed.push(name);
      log.push({ s: name, ok: false, why: String(error?.message ?? "error").slice(0, 140) });
    }
    real.done++;
  }
  if (symbols.length) {
    const via = memo.good?.id ?? "directo";
    const scan = {
      v: 1,
      at: Date.now(),
      today,
      source: `CBOE, con 15 minutos de retraso${via === "directo" ? "" : `, por el puente ${via}`}`,
      real: true,
      failed,
      log,
      symbols,
    };
    state.scan = scan;
    state.error = null;
    await keepScan(scan, readLocal(LS_REAL)?.ids ?? {});
  } else {
    real.error = `No se pudo leer CBOE ni directamente ni por los puentes. Último intento: ${log.at(-1)?.why ?? "sin respuesta"}.`;
  }
  real.busy = false;
  real.note = "";
  realPaint(true);
}

/** Con la fuente propia de la página, si la trae; si no, directo a CBOE. */
function loadReal() {
  return extraSource ? extraSource() : loadCboe();
}

function useExample() {
  if (!EMBED) return;
  const saved = readLocal(LS_REAL) ?? {};
  writeLocal(LS_REAL, { ids: saved.ids ?? {} });
  void cloudWrite("scan", { symbols: [] });
  state.kept = "";
  state.scan = refreshExample(EMBED.scan);
  real.error = "";
  render();
}

// ---------- formato ----------

const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
// Números a la española en toda la app: coma decimal y "%" separado (ver `num` en el motor).
const money = (n) => `$${num(n, 2)}`;
const whenFmt = new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const when = (ms) => whenFmt.format(new Date(ms));
const hourFmt = new Intl.DateTimeFormat("es-ES", { hour: "2-digit", minute: "2-digit" });
/** "hace 5 min", "hace 3 h", "hace 2 días". */
function ago(ms) {
  const min = Math.max(0, Math.round((Date.now() - ms) / 60_000));
  if (min < 1) return "hace un momento";
  if (min < 60) return `hace ${min} min`;
  if (min < 48 * 60) return `hace ${Math.round(min / 60)} h`;
  return `hace ${Math.round(min / 1440)} días`;
}

/** Lo que pasó al actualizar y de cuándo son los datos: el barrido, los cierres y si el mercado está abierto. */
function refreshBox() {
  const scan = state.scan;
  const busy = state.loading || state.checking;
  const r = state.refresh;
  const at = r ? hourFmt.format(new Date(r.at)) : "";
  const result = busy
    ? "Comprobando si hay un barrido nuevo…"
    : !r
      ? ""
      : {
          nuevo: `Última comprobación, a las ${at}: había un barrido nuevo y se ha cargado.`,
          igual: `Última comprobación, a las ${at}: no hay barrido nuevo; tienes el último publicado.`,
          leido: `Última comprobación, a las ${at}: se ha leído el barrido otra vez.`,
          "sin-conexion": `Última comprobación, a las ${at}: no se pudo comprobar, sin conexión. Se sigue con el último barrido guardado.`,
          error: `Última comprobación, a las ${at}: no se pudo leer el barrido.`,
        }[r.result];
  const warn = !busy && (r?.result === "sin-conexion" || r?.result === "error");
  const lines = [];
  if (scan?.at) {
    const source = scan.example ? "datos de ejemplo" : scan.source ? esc(scan.source) : "";
    lines.push(`Precios de las opciones: barrido del ${when(scan.at)} (${ago(scan.at)})${source ? `, ${source}` : ""}.${!scan.example && pricesOutsideMarket(scan.at) ? " Son de fuera de horario: las horquillas son más anchas." : ""}`);
  } else {
    lines.push("Todavía no hay ningún barrido cargado.");
  }
  if (state.hist?.last) lines.push(`Cierres diarios, para la historia de 5 años: hasta el ${esc(labelOf(state.hist.last))}.`);
  lines.push(
    pricesOutsideMarket(Date.now())
      ? "El mercado está cerrado ahora: no hay barridos nuevos hasta que abra, así que los datos son los del último barrido."
      : "El mercado está abierto: el barrido se repite cada media hora y los precios llevan 15 minutos de retraso.",
  );
  return `<div class="readbox small${warn ? " warn" : ""}" role="status" aria-live="polite">
    ${result ? `<p><b>${result}</b></p>` : ""}
    <ul>${lines.map((line) => `<li>${line}</li>`).join("")}</ul>
  </div>`;
}

// ---------- vistas ----------

const ICONS = {
  hoy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><rect x="4" y="4" width="4.5" height="4.5" rx="1"/><rect x="9.75" y="4" width="4.5" height="4.5" rx="1"/><rect x="15.5" y="4" width="4.5" height="4.5" rx="1" fill="currentColor"/><rect x="4" y="9.75" width="4.5" height="4.5" rx="1"/><rect x="9.75" y="9.75" width="4.5" height="4.5" rx="1" fill="currentColor"/><rect x="15.5" y="9.75" width="4.5" height="4.5" rx="1"/><rect x="4" y="15.5" width="4.5" height="4.5" rx="1"/><rect x="9.75" y="15.5" width="4.5" height="4.5" rx="1"/><rect x="15.5" y="15.5" width="4.5" height="4.5" rx="1"/></svg>',
  buscador: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>',
  avisos: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 16V11a6 6 0 1112 0v5l1.5 2h-15z"/><path d="M10 20a2 2 0 004 0"/></svg>',
  reglas: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/></svg>',
};

/** Sin título a la vista, para dejar sitio: el nombre de la pantalla queda para lectores de pantalla.
 *  Sin botón de actualizar: se actualiza arrastrando hacia abajo (recarga la página, que mira si hay barrido nuevo). */
function header(title, showRules = true) {
  const scan = state.scan;
  const times = scan ? `Barrido ${when(scan.at)}` : "";
  const status = state.loading
    ? "Leyendo el barrido…"
    : scan
      ? `${times} · ${esc(scan.source)}${state.checking ? " · comprobando si hay uno nuevo…" : ""}`
      : "Sin barrido todavía";
  return `
    <header class="top">
      <h1 class="sr-only">${title}</h1>
      ${
        EMBED
          ? `<div class="top-row"><button class="btn primary" data-act="real" ${real.busy ? "disabled" : ""}>${real.busy ? (real.total ? `Leyendo ${real.done}/${real.total}` : "Leyendo…") : "Datos reales"}</button></div>`
          : ""
      }
      <p class="status small muted">${real.busy && real.note ? esc(real.note) : status}</p>
      ${showRules ? `<button class="rules-line small" data-tab="reglas">${esc(rulesLine(state.config.rules))}</button>` : ""}
    </header>
    ${state.offline && scan ? notice("info", `Sin conexión: se enseña el último barrido guardado, del ${when(scan.at)} (${ago(scan.at)}).`) : ""}
    ${scan?.example ? notice("watch", 'Datos de ejemplo. No son precios de mercado. Pulsa "Datos reales" para leer la lista.') : ""}
    ${scan?.real ? readSummary(scan) : ""}
    ${real.error ? notice("bad", esc(real.error)) : ""}
    ${state.error && !state.loading ? notice("bad", esc(state.error)) : ""}`;
}

/** Resumen de la última lectura real: qué se leyó, si quedó guardada y el detalle por nombre. */
function readSummary(scan) {
  const log = scan.log ?? [];
  const ok = log.filter((row) => row.ok);
  const puts = ok.reduce((sum, row) => sum + (row.puts ?? 0), 0);
  const kept =
    state.kept === "cuenta"
      ? "Guardada en tu cuenta de Claude: seguirá aquí al volver a entrar."
      : state.kept === "dispositivo"
        ? "Guardada en este dispositivo."
        : state.kept === "no"
          ? "No se pudo guardar: al salir habrá que leer de nuevo."
          : "";
  const allOk = log.length > 0 && ok.length === log.length;
  const lines = log
    .map((row) =>
      row.ok
        ? `<li><b>${esc(row.s)}</b> ${money(row.p)} · ${row.exp} ${row.exp === 1 ? "vencimiento" : "vencimientos"} · ${row.puts} puts${row.via && row.via !== "directo" ? ` · puente ${esc(row.via)}` : ""}</li>`
        : `<li class="down"><b>${esc(row.s)}</b> no se pudo leer: ${esc(row.why ?? "")}</li>`,
    )
    .join("");
  return `<div class="readbox ${allOk ? "ok" : "warn"}">
    <p class="small"><b>${allOk ? "Lectura correcta" : `Lectura incompleta`}</b>: ${ok.length} de ${log.length} nombres, ${puts} puts, ${when(scan.at)}. ${kept}</p>
    <details><summary class="small muted">Detalle de la lectura</summary>
      <ul class="small">${lines}</ul>
      <p class="small muted">${scan.window ? `Leído para ${esc(scan.window)}. Si cambias el plazo o el % abajo, pulsa "Datos reales" otra vez. ` : ""}Sin fechas de resultados.</p>
      <button class="btn quiet" data-act="example">Volver a los datos de ejemplo</button>
    </details>
  </div>`;
}


/** Bloques en el orden de la lista base; los nombres sin bloque van al final. */
function blockOrder() {
  const order = [...(state.scan?.blocks ?? [])];
  for (const sym of state.scan?.symbols ?? []) if (sym.b && !order.includes(sym.b)) order.push(sym.b);
  return order;
}

/** La lista: los nombres de la lista base, que es lo único que se barre.
 *  Fuera de la app publicada (ordenador, versión de prueba), todo lo que traiga el barrido. */
function allListSymbols() {
  const symbols = state.scan?.symbols ?? [];
  if (symbols.some((sym) => sym.b)) return symbols.filter((sym) => sym.b);
  return isPublic() ? [] : symbols;
}

/** Los nombres que él deja puestos: la lista base menos los que ha quitado (solo en el dispositivo). */
function listSymbols() {
  const off = state.config.off ?? [];
  return allListSymbols().filter((sym) => !off.includes(sym.s));
}

function foot() {
  const failed = state.scan?.failed?.length ?? 0;
  const kept = state.scan?.kept?.length ?? 0;
  return `<p class="foot xs muted">${failed ? `Sin lectura en el último barrido: ${failed} nombres. ` : ""}${kept ? `Con datos del barrido anterior: ${kept} nombres. ` : ""}Un bull put puede perder el ancho menos el crédito. No es una orden ni un consejo, y los datos van con retraso.</p>`;
}


// La pestaña "Hoy" (mapa, nube, ficha del deal y Mis deals) vive en hoy.js.
const hoy = createHoy({ state, render, listSymbols, blockOrder, readLocal, writeLocal, esc, header, foot });
// El Buscador sustituye a Lista y a Deals: todos los deals de todas las acciones con el esquema de la ficha (buscador.js).
const buscador = createBuscador({ state, root, listSymbols, allSymbols: allListSymbols, blockOrder, readLocal, writeLocal, esc, header, foot, hoy, changeConfig });
const reload = () => void load().then(loadHist, loadHist);
const conexion = createConexion({ state, root, esc, readLocal, writeLocal, render, ghReady, reload, sectionHead, LS_COPIED, LS_BRIDGE, LS_GH });
const copia = createCopia({ state, root, esc, readLocal, writeLocal, render, sectionHead, notice });
const reglas = createReglas({ state, esc, num, sectionHead, changeConfig, refreshBox, syncLine, foot, conexion, copia, DEFAULT_CONFIG });
const avisos = createAvisos({ state, esc, when, sectionHead, changeConfig, foot, syncLine, isPublic });

function dock() {
  const seen = Number(readLocal(LS_SEEN) ?? 0);
  const unseen = state.alerts.filter((alert) => alert.at > seen).length;
  const item = (id, label) =>
    `<button data-tab="${id}" ${state.tab === id ? 'aria-current="page"' : ""}>${ICONS[id]}<span>${label}</span>${id === "avisos" && unseen ? `<span class="badge">${unseen > 9 ? "9+" : unseen}</span>` : ""}</button>`;
  return `<nav class="dock" aria-label="Secciones"><div>
    ${item("hoy", "Hoy")}${item("buscador", "Buscador")}${item("avisos", "Avisos")}${item("reglas", "Reglas")}
  </div></nav>`;
}

function render() {
  const view =
    state.tab === "hoy" ? hoy.view() : state.tab === "reglas" ? reglas.view() : state.tab === "avisos" ? avisos.view() : buscador.view();
  const before = root.querySelector(".sheet");
  const keep = before ? { name: before.getAttribute("aria-label"), top: before.scrollTop } : null;
  root.innerHTML = `<main class="wrap">${view}</main>${dock()}${hoy.sheet()}`;
  // Al pulsar dentro de la ficha (otro bull put, otro orden) se queda donde estaba.
  const after = root.querySelector(".sheet");
  if (keep && after && after.getAttribute("aria-label") === keep.name) after.scrollTop = keep.top;
  if (state.tab === "hoy") scheduleWarm();
}

// Con Hoy en pantalla, en un rato libre se calculan los deals del Buscador: al abrirlo ya están (la caché es por barrido, reglas, precio y acciones).
let warmPending = false;
function scheduleWarm() {
  if (warmPending || !state.scan?.symbols?.length) return;
  warmPending = true;
  const run = () => {
    warmPending = false;
    if (state.tab === "hoy") buscador.warm();
  };
  if ("requestIdleCallback" in window) window.requestIdleCallback(run, { timeout: 4000 });
  else setTimeout(run, 2000);
}

// ---------- eventos ----------


// Las barras "hasta" (Hoy, ficha y Buscador): mientras se arrastra solo cambia el número; al soltar, se aplica.
const RANGES = {
  "hoy-pr-range": { apply: (v) => hoy.setProb(v) },
  "hoy-w-range": { apply: (v) => hoy.setWidth(v) },
  "fi-w-range": { apply: (v, max) => hoy.setFl("w", v, max) },
  "fi-pr-range": { apply: (v, max) => hoy.setFl("pr", v, max) },
  "fi-days-range": { apply: (v, max) => hoy.setFl("days", v, max) },
  "bs-w-range": { apply: (v) => buscador.setRange("w", v) },
  "bs-pr-range": { apply: (v) => buscador.setRange("pr", v) },
  "bs-days-range": { apply: (v) => buscador.setRange("days", v) },
};
root.addEventListener("input", (event) => {
  const id = event.target.id;
  if (id === "bs-q") {
    buscador.setQuery(event.target.value);
  } else if (RANGES[id]) {
    const label = root.querySelector(`#${id}-val`);
    if (label) label.textContent = fmtOf(id)(event.target.value);
  }
});
root.addEventListener("change", (event) => {
  const range = RANGES[event.target.id];
  if (range && range.apply(Number(event.target.value), Number(event.target.max))) render();
});

root.addEventListener("click", (event) => {
  const el = event.target.closest("[data-bs],[data-hoy],[data-step],[data-gate],[data-rule-switch],[data-rule-set],[data-alert],[data-tab],[data-act],[data-open]");
  if (!el) return;
  if (el.classList.contains("sheet-back") && event.target !== el) return; // clic dentro de la ficha
  if (el.dataset.bs) {
    if (buscador.click(el)) render();
    return;
  }
  if (el.dataset.hoy) {
    hoy.click(el);
    return;
  }
  if (reglas.click(el) || avisos.click(el) || copia.click(el) || conexion.click(el)) return;
  if (el.dataset.tab) {
    state.tab = el.dataset.tab;
    writeLocal(LS_TAB, state.tab);
    if (state.tab === "avisos") writeLocal(LS_SEEN, Date.now());
    window.scrollTo(0, 0);
    render();
  } else if (el.dataset.open) {
    hoy.openName(el.dataset.open); // la ficha única, con el mejor deal puntuado del nombre
  } else if (el.dataset.act === "reload") {
    void load().then(loadHist, loadHist);
  } else if (el.dataset.act === "real") {
    void loadReal();
  } else if (el.dataset.act === "example") {
    useExample();
  }
});

root.addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.target;
  if (form.matches("[data-hoy-form]")) {
    hoy.submit(form);
  } else if (form.matches("[data-bs-form]")) {
    if (buscador.submit(form)) render();
  } else if (!copia.submit(form)) conexion.submit(form);
});

window.addEventListener("keydown", (event) => {
  // Los puntos de la nube son botones dibujados: Intro o espacio los abre.
  if ((event.key === "Enter" || event.key === " ") && event.target instanceof Element && event.target.matches("g[data-hoy]")) {
    event.preventDefault();
    hoy.click(event.target);
    return;
  }
  if (event.key === "Escape") hoy.escape();
});

// Abrir donde lo dejaste, y enterarse solo de que vuelve o se va la conexión.
const lastTab = readLocal(LS_TAB);
if (TABS.includes(lastTab)) {
  state.tab = lastTab;
  if (lastTab === "avisos") writeLocal(LS_SEEN, Date.now());
}
window.addEventListener("online", () => {
  state.offline = false;
  void load().then(loadHist, loadHist);
});
window.addEventListener("offline", () => {
  if (!state.scan) return;
  state.offline = true;
  render();
});

if (!EMBED && "serviceWorker" in navigator && window.location.protocol !== "file:") {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

void load().then(loadHist, loadHist);
