import {
  DEFAULT_CONFIG,
  DEFAULT_RULES,
  RULES_V,
  ORDERS,
  PROB_OFF,
  assessSymbol,
  cboeUrl,
  daysBetween,
  cleanSymbol,
  commonExpiries,
  compareSpreads,
  defaultExpiry,
  equalRiskList,
  gateReason,
  volatilities,
  pricesOutsideMarket,
  favoriteDeals,
  fmtStrike,
  ivFromPut,
  labelOf,
  liquidityNotes,
  normalizeConfig,
  num,
  nyToday,
  readCboeChain,
  rulesLine,
  spreadLine,
  spreadRow,
  statusLabel,
  withHistory,
  yearRange,
} from "./engine.js";

const LS_CONFIG = "centinela.config.v1";
const LS_GH = "centinela.github.v1";
const LS_SEEN = "centinela.avisos.vistos";
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

const EQ_PROBS = [5, 8, 10];
const EQ_WIDTHS = [1, 2, 3, 5, 10];
const EQ_PROB_MIN = 1;
const EQ_PROB_MAX = 15;
const EQ_OK = { prob: (v) => Number.isInteger(v) && v >= EQ_PROB_MIN && v <= EQ_PROB_MAX, width: (v) => EQ_WIDTHS.includes(v) };

const state = {
  tab: "favoritos",
  scan: null,
  alerts: [],
  config: normalizeConfig(DEFAULT_CONFIG),
  publishedAt: 0,
  mode: "nube", // "nube" (GitHub) u "ordenador"
  loading: true,
  checking: false, // enseñando lo guardado mientras se mira si hay barrido nuevo
  offline: false,
  error: null,
  detail: null,
  detailDeal: null, // bull put elegido en la ficha: "vencimiento|corto|largo"
  detailSrc: "", // "igual" si la ficha se abrió desde Igual riesgo
  sync: { state: "idle", message: "" },
  gh: loadGh(),
  showGh: false,
  kept: "", // dónde quedó guardado el último barrido real: "cuenta", "dispositivo" o "no"
  copied: "",
  dealsPerName: 10, // 0 = todos
  dealsShown: 60,
  dealFilter: { expiries: [], maxWidth: 0, minOtm: 0, maxProb: 0 },
  hist: null, // cierres diarios de la lista (historia/cierres.json), si los hay
  equal: loadEqual(), // pestaña de prueba "Igual riesgo": solo en el dispositivo
};



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

function loadEqual() {
  migrateEqualFee();
  const saved = readLocal(LS_EQUAL) ?? {};
  const num = (value, ok) => (EQ_OK[ok](value) ? value : null);
  return {
    prob: num(saved.prob, "prob"),
    width: num(saved.width, "width"),
    expiry: typeof saved.expiry === "string" ? saved.expiry : null,
  };
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
    if (state.tab === "igual") render();
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
      } catch (error) {
        if (!error?.status) throw error;
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
const usd = (n) => `$${num(Math.round(n), 0)}`;
const pct = (n, d = 0) => `${num(n, d)} %`;
const signed = (n) => `${n > 0 ? "+" : ""}${num(n, 2)} %`;
const shortMoney = (n) => `$${Number.isInteger(n) ? String(n) : num(n, 2).replace(/0$/, "")}`;
const whenFmt = new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const when = (ms) => whenFmt.format(new Date(ms));
const nameOf = (sym) => (sym.n && sym.n !== sym.s ? sym.n : "");
const kpiText = (sp) => (sp.balance == null ? "—" : num(sp.balance, 2));
const widthText = (sp) => shortMoney(sp.width);
const probText = (sp) => (sp.prob == null ? "—" : pct(sp.prob));

// ---------- vistas ----------

const ICONS = {
  favoritos: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/></svg>',
  deals: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/></svg>',
  avisos: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 16V11a6 6 0 1112 0v5l1.5 2h-15z"/><path d="M10 20a2 2 0 004 0"/></svg>',
  igual: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M5 9h14M5 15h14"/></svg>',
  reglas: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/></svg>',
};

function header(eyebrow, title, showRules = true) {
  const scan = state.scan;
  const times = scan ? `Barrido ${when(scan.at)}` : "";
  const status = state.loading
    ? "Leyendo el barrido…"
    : scan
      ? `${times} · ${esc(scan.source)}${state.checking ? " · comprobando si hay uno nuevo…" : state.offline ? " · sin conexión: es el último guardado" : ""}`
      : "Sin barrido todavía";
  return `
    <header class="top">
      <p class="eyebrow">${eyebrow}</p>
      <div class="top-row">
        <h1>${title}</h1>
        ${
          EMBED
            ? `<button class="btn primary" data-act="real" ${real.busy ? "disabled" : ""}>${real.busy ? (real.total ? `Leyendo ${real.done}/${real.total}` : "Leyendo…") : "Datos reales"}</button>`
            : `<button class="btn primary" data-act="reload" ${state.loading ? "disabled" : ""}>Actualizar</button>`
        }
      </div>
      <p class="status small muted">${real.busy && real.note ? esc(real.note) : status}</p>
      ${showRules ? `<button class="rules-line small" data-tab="reglas">${esc(rulesLine(state.config.rules))}</button>` : ""}
    </header>
    ${scan?.example ? '<p class="banner small">Datos de ejemplo. No son precios de mercado. Pulsa "Datos reales" para leer la lista.</p>' : ""}
    ${scan?.real ? readSummary(scan) : ""}
    ${real.error ? `<p class="banner err small">${esc(real.error)}</p>` : ""}
    ${state.error && !state.loading ? `<p class="banner err small">${esc(state.error)}</p>` : ""}`;
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

function metrics(sp) {
  return `<dl class="metrics">
    <div class="metric"><dt>Prob. asignación</dt><dd>${probText(sp)}</dd></div>
    <div class="metric"><dt>Rentabilidad</dt><dd>${pct(sp.ret)}</dd></div>
    <div class="metric kpi"><dt>Equilibrio</dt><dd>${kpiText(sp)}</dd></div>
    <div class="metric"><dt>Ancho</dt><dd>${widthText(sp)}</dd></div>
    <div class="metric"><dt>Cobras</dt><dd>${usd(sp.creditUsd)}</dd></div>
    <div class="metric"><dt>Pérdida máx.</dt><dd>${usd(sp.lossUsd)}</dd></div>
  </dl>`;
}

function card(sym, res, withToggle = false) {
  const sp = res.best;
  const up = sym.c >= 0;
  const earn = sp?.earnInside && sym.er ? `<p class="small brass" style="margin-top:8px">Resultados ${esc(labelOf(sym.er.d))}</p>` : "";
  const why = res.status !== "entrada" && sp?.fails.length ? `<p class="small muted" style="margin-top:6px">No pasa: ${esc(sp.fails.join(" · "))}</p>` : "";
  const noSpread = !sp
    ? `<p class="small muted line">${res.status === "sin-cadena" ? "No llegaron puts de este nombre." : res.status === "sin-plazo" ? "No hay vencimientos en tu plazo." : "No hay ningún bull put cerca de tu punto."}</p>`
    : "";
  return `<li class="card ${res.status}">
    <button class="row-open" data-open="${esc(sym.s)}" aria-label="Ver ${esc(sym.s)}"></button>
    <div class="card-head">
      <div style="min-width:0">
        <p class="sym">${esc(sym.s)} <span class="pill ${res.status}" style="margin-left:6px">${statusLabel(res.status)}</span></p>
        <p class="name small muted">${esc(nameOf(sym))}</p>
        ${sym.b ? `<p style="margin-top:6px"><span class="pill">${esc(sym.b)}</span></p>` : ""}
      </div>
      <div style="display:flex;gap:6px;align-items:flex-start">
        <div class="price"><p class="num" style="font-weight:500">${money(sym.p)}</p><p class="num small ${up ? "up" : "down"}">${signed(sym.c)}</p></div>
        ${withToggle ? toggle(sym.s, true) : ""}
      </div>
    </div>
    ${sp ? `<p class="line">${esc(spreadLine(sp))}</p>${metrics(sp)}` : noSpread}
    ${why}${earn}
  </li>`;
}

const NO_BLOCK = "Sin bloque";

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

function offCard(sym) {
  return `<li class="card off" style="opacity:.6">
    <div class="card-head">
      <div style="min-width:0"><p class="sym">${esc(sym.s)}</p><p class="name small muted">${esc(nameOf(sym))} · fuera de tu lista</p></div>
      ${toggle(sym.s, false)}
    </div>
  </li>`;
}

function toggle(symbol, on) {
  return `<button class="chip quiet toggle" data-off="${esc(symbol)}" aria-pressed="${on}" aria-label="${on ? "Quitar" : "Poner"} ${esc(symbol)} ${on ? "de" : "en"} mi lista">${on ? "Quitar" : "Poner"}</button>`;
}

function viewFavoritos() {
  const today = nyToday();
  const everyone = allListSymbols();
  const offNames = state.config.off ?? [];
  const rows = listSymbols().map((sym) => ({ sym, res: assessSymbol(sym, state.config.rules, state.config.order, today) }));
  const rank = (row) => (row.res.status === "entrada" ? 0 : row.res.status === "no-pasa" ? 1 : 2);
  rows.sort((a, b) => rank(a) - rank(b) || (a.res.best && b.res.best ? compareSpreads(a.res.best, b.res.best, state.config.order) : 0));
  const passing = rows.filter((row) => row.res.status === "entrada").length;
  const groups = [...blockOrder(), NO_BLOCK]
    .map((name) => {
      const own = rows.filter((row) => (row.sym.b ?? NO_BLOCK) === name);
      const out = everyone.filter((sym) => (sym.b ?? NO_BLOCK) === name && offNames.includes(sym.s));
      if (!own.length && !out.length) return "";
      const ok = own.filter((row) => row.res.status === "entrada").length;
      return `<h2 class="group">${esc(name)}<span class="small muted">${ok} de ${own.length} ${own.length === 1 ? "cumple" : "cumplen"}</span></h2>
        <ul class="cards">${own.map((row) => card(row.sym, row.res, true)).join("")}${out.map(offCard).join("")}</ul>`;
    })
    .join("");
  const order = ORDERS.find((o) => o.id === state.config.order);
  const empty = state.scan
    ? '<div class="empty"><h2>Esperando el primer barrido de la lista</h2><p class="small muted" style="margin-top:8px">Sale cada media hora en horario de mercado. Pulsa Actualizar dentro de un rato.</p></div>'
    : "";
  return `
    ${header("Bull put", "Lista")}
    <div class="tools">
      <div class="chips" role="group" aria-label="Orden">
        ${ORDERS.map((o) => `<button class="chip" data-order="${o.id}" aria-pressed="${o.id === state.config.order}">${o.label}</button>`).join("")}
      </div>
    </div>
    <p class="small muted" style="margin:-6px 0 4px">${esc(order?.hint ?? "")}</p>
    <p class="small muted" style="margin:0 0 6px">${everyone.length ? `${passing} de ${rows.length} ${rows.length === 1 ? "nombre cumple" : "nombres cumplen"} (${rows.length} de ${everyone.length} en tu lista). Con Quitar / Poner eliges cuáles ves; la elección se queda solo en este dispositivo.` : ""}</p>
    ${everyone.length ? groups : empty}
    ${foot()}`;
}

function stepper(path, label, hint, min, max, step, format) {
  const value = path.split(".").reduce((obj, key) => obj[key], state.config);
  return `<div class="field">
    <div class="txt"><b>${label}</b><span class="small muted">${hint}</span></div>
    <div class="stepper">
      <button data-step="${path}" data-dir="-1" data-min="${min}" data-max="${max}" data-by="${step}" aria-label="Bajar ${esc(label)}">−</button>
      <span>${format(value)}</span>
      <button data-step="${path}" data-dir="1" data-min="${min}" data-max="${max}" data-by="${step}" aria-label="Subir ${esc(label)}">+</button>
    </div>
  </div>`;
}

function gate(key, title, hint, inner = "") {
  const on = state.config.rules.gates[key];
  return `<div class="gate">
    <button role="switch" aria-checked="${on}" data-gate="${key}">
      <span style="min-width:0"><b>${title}</b><span class="small muted">${hint}</span></span>
      <span class="switch"><i></i></span>
    </button>
    ${on ? inner : ""}
  </div>`;
}

function viewReglas() {
  const r = state.config.rules;
  const days = (n) => `${n} d`;
  const p0 = (n) => `${num(n, 0)} %`;
  const d0 = (n) => `$${num(n, 0)}`;
  return `<div class="narrow">
    <header class="top">
      <p class="eyebrow">Bull put</p>
      <h1 style="margin-top:4px">Reglas</h1>
      <p class="small muted" style="margin-top:8px">Filtran tu lista al instante en este dispositivo. ${esc(syncLine())}</p>
    </header>
    <div class="panel">
      ${stepper("rules.minDte", "Vencimiento desde", "No mires puts que caduquen antes.", 5, 60, 1, days)}
      ${stepper("rules.maxDte", "Vencimiento hasta", "Ni los que caduquen después.", 5, 60, 1, days)}
      ${stepper("rules.maxProb", "Prob. de asignación máxima", "Elige el corto: en cada nombre, los puts con esta probabilidad o menos de acabar en dinero.", 1, PROB_OFF, 1, (n) => (n >= PROB_OFF ? "sin límite" : p0(n)))}
      ${stepper("rules.width", "Ancho máximo del spread", "Dólares entre el put que vendes y el que compras. Vale ese ancho y cualquiera menor.", 1, 50, 1, d0)}
      ${stepper("rules.minCredit", "Cobras, mínimo", "Crédito por contrato, en dólares. Por debajo, el spread no pasa.", 0, 500, 5, (n) => (n <= 0 ? "sin mínimo" : d0(n)))}
      ${stepper("rules.minBalance", "Equilibrio mínimo", "Lo que esperas ganar por cada dólar que esperas perder. En 1 se igualan.", 0, 1.5, 0.05, (n) => (n <= 0 ? "sin mínimo" : num(n, 2)))}
      <div class="gate">
        <button role="switch" aria-checked="${r.otmOn}" data-rule-switch="otmOn">
          <span style="min-width:0"><b>Limitar además el % abajo</b><span class="small muted">Apagado, el % abajo es solo una columna. Encendido, el corto tiene que caer además en este tramo.</span></span>
          <span class="switch"><i></i></span>
        </button>
        ${
          r.otmOn
            ? stepper("rules.minOtm", "% abajo, desde", "El put corto, como mínimo así de lejos del precio.", 1, 30, 1, p0) +
              stepper("rules.maxOtm", "% abajo, hasta", "Y como máximo así de lejos.", 1, 35, 1, p0)
            : ""
        }
      </div>
    </div>

    <section class="block">
      <h2>Si lo enciendes</h2>
      <p class="small muted">Apagado, no cuenta. Encendido, el nombre deja de cumplir y la lista dice por qué.</p>
      <div class="panel">
        ${gate("event", "Sin resultados en el plazo", "Hasta dos días después del vencimiento.")}
        ${gate(
          "liquid",
          "Corto con mercado",
          "Interés abierto en el corto y horquilla que no se coma el crédito.",
          stepper("rules.gates.oiMin", "Interés abierto mínimo", "Contratos abiertos en el put corto.", 0, 5000, 50, (n) => num(n, 0)) +
            stepper("rules.gates.spreadPct", "Horquilla máxima", "Suma de las dos horquillas, sobre el crédito a precio medio.", 5, 100, 5, p0),
        )}
        ${gate(
          "loss",
          "Pérdida por contrato",
          "El ancho menos el crédito, en dólares.",
          stepper("rules.gates.lossMin", "Desde", "Por debajo de esto, no pasa.", 20, 2000, 10, d0) +
            stepper("rules.gates.lossMax", "Hasta", "Por encima, tampoco.", 20, 5000, 10, d0),
        )}
        ${gate("room", "Fuera del movimiento", "El corto, más lejos que la mitad de lo que el mercado espera que se mueva el precio.")}
      </div>
    </section>

    <section class="block">
      <h2>Pestaña Igual riesgo (prueba)</h2>
      <p class="small muted">Solo cuenta ahí; Lista y Deals no cambian.</p>
      <div class="panel">
        ${stepper("rules.equalFee", "Comisión por spread al abrir", "Lo que cobra tu broker por abrir un spread, en dólares. Se descuenta del cobro, y para salir cuenta otra vez en el coste total (entrar y salir).", 0, 20, 0.1, (n) => `$${num(n, 2)}`)}
        ${stepper("rules.equalGapPct", "Horquilla máxima", "Las dos horquillas, sobre el crédito a precio medio. Por encima, la fila se aparta.", 10, 100, 5, p0)}
      </div>
    </section>

    <section class="block">
      <h2>Cómo se calcula</h2>
      <div class="panel">
        <details>
          <summary>Las columnas, una a una</summary>
          <dl>
            <div><dt>Crédito (cobras)</dt><dd>Bid del put corto menos ask del put largo, por 100. Es el precio al que entra seguro, no el medio.</dd></div>
            <div><dt>% del ancho</dt><dd>Crédito partido por el ancho.</dd></div>
            <div><dt>Pérdida máx.</dt><dd>Ancho menos crédito, por 100.</dd></div>
            <div><dt>Rentabilidad</dt><dd>Crédito partido por la pérdida máxima.</dd></div>
            <div><dt>Prob. de asignación</dt><dd>Probabilidad de que el precio acabe por debajo del corto el día del vencimiento, tal como la descuentan los precios: lo que cambia el precio del put al subir un dólar el strike, medido con los dos strikes vecinos a precio medio. Es la misma cuenta que el crédito partido por el ancho de un spread estrecho. Si faltan precios para medirla, se usa la fórmula con la volatilidad implícita del strike y la ficha lo dice. No mide la asignación anticipada.</dd></div>
            <div><dt>Equilibrio</dt><dd>Lo que esperas ganar partido por lo que esperas perder: rentabilidad × (100 − prob. de asignación) ÷ prob. de asignación. Sube con la rentabilidad y baja con la probabilidad. En 1, lo esperado a ganar iguala lo esperado a perder. Cuenta cada asignación como la pérdida máxima, así que es prudente. Como la probabilidad sale de los mismos precios que el crédito, suele quedar algo por debajo de 1: lo que falta es sobre todo lo que se lleva la horquilla.</dd></div>
            <div><dt>Movimiento esperado</dt><dd>Precio × volatilidad implícita al dinero × raíz de (días / 365).</dd></div>
          </dl>
        </details>
      </div>
    </section>

    ${state.mode === "nube" ? (ghReady() ? ghBlock() : secretBlock()) : ""}
    ${state.mode === "muestra" && !window.claude?.use ? bridgeBlock() : ""}

    <button class="btn quiet" style="margin-top:16px" data-act="reset">Volver al bull put de mesa</button>
    ${foot()}
  </div>`;
}

/** Texto para pegar en el secreto CENTINELA_CONFIG de GitHub. */
function secretText() {
  const { rules, order, alerts, off } = state.config;
  return JSON.stringify({ rules, order, alerts, off });
}

function secretBlock() {
  const copiedAt = Number(readLocal(LS_COPIED) ?? 0);
  const stale = copiedAt > 0 && state.config.savedAt > copiedAt;
  const status = !copiedAt
    ? "Todavía no has copiado la configuración desde este dispositivo."
    : stale
      ? "Has cambiado las reglas después de la última copia: los avisos siguen con las anteriores."
      : "Los avisos usan lo que copiaste por última vez desde este dispositivo.";
  return `<section class="block">
    <h2>Avisos al móvil</h2>
    <p class="small muted">Tus reglas se guardan solo en este dispositivo; no se publican. Para que los avisos las sigan, copia la configuración y pégala en GitHub como secreto <b>CENTINELA_CONFIG</b>. Repítelo cuando cambies las reglas.</p>
    <div class="panel"><div class="form">
      <p class="small${stale ? "" : " muted"}">${status}</p>
      <button class="btn primary" style="margin-top:10px" data-act="copy-secret">Copiar configuración para avisos</button>
      ${state.copied ? `<p class="small" style="margin-top:10px">${esc(state.copied)}</p>` : ""}
      ${state.copied && state.copied.startsWith("No") ? `<textarea class="textfield" id="secreto" readonly style="height:120px;padding:10px;margin-top:10px">${esc(secretText())}</textarea>` : ""}
    </div></div>
  </section>`;
}

function bridgeBlock() {
  const own = String(readLocal(LS_BRIDGE) ?? "");
  return `<section class="block">
    <h2>Puente de datos</h2>
    <p class="small muted">Este archivo prueba a leer CBOE directamente y, si no puede, por tres puentes gratuitos de terceros. Si tienes un puente propio, pon aquí su dirección y será el primero que pruebe.</p>
    <div class="panel"><div class="form">
      <form data-bridge>
        <label for="puente">Dirección del puente propio (opcional)<input class="textfield" id="puente" name="bridge" value="${esc(own)}" placeholder="https://…/?url=" autocomplete="off"></label>
        <button class="btn primary" style="margin-top:12px" type="submit">Guardar</button>
      </form>
    </div></div>
  </section>`;
}

function ghBlock() {
  const ready = ghReady();
  return `<section class="block">
    <h2>Tu repositorio privado</h2>
    <p class="small muted">${ready ? "Conectada. Los barridos, las reglas y los favoritos se leen y se guardan en tu repositorio privado." : "La app necesita tu usuario, el nombre del repositorio y una llave de acceso para leer tus barridos. La llave se queda solo en este dispositivo."}</p>
    <div class="panel">
      <div class="form">
        ${
          state.showGh || !ready
            ? `<form data-gh>
                <label for="gh-owner">Usuario de GitHub<input class="textfield" id="gh-owner" name="owner" value="${esc(state.gh.owner)}" autocomplete="off" autocapitalize="none"></label>
                <label for="gh-repo">Repositorio<input class="textfield" id="gh-repo" name="repo" value="${esc(state.gh.repo)}" autocomplete="off" autocapitalize="none"></label>
                <label for="gh-token">Llave de acceso<input class="textfield" id="gh-token" name="token" type="password" value="${esc(state.gh.token)}" autocomplete="off"></label>
                <button class="btn primary" style="margin-top:12px" type="submit">Conectar</button>
              </form>`
            : `<p class="small">${esc(state.gh.owner)}/${esc(state.gh.repo)}</p>
               <button class="btn quiet" style="margin-top:8px" data-act="gh-edit">Cambiar</button>
               <button class="btn quiet" style="margin-top:8px" data-act="gh-clear">Desconectar</button>`
        }
      </div>
    </div>
  </section>`;
}

/** El número que se enseña a la derecha de cada deal: el del orden elegido. */
function orderText(sp, order) {
  if (order === "rentab") return pct(sp.ret);
  if (order === "prob") return probText(sp);
  if (order === "abajo") return pct(sp.otm, 1);
  if (order === "credito") return usd(sp.creditUsd);
  return kpiText(sp);
}

// Deslizadores de los filtros de Deals: ancho máximo ($1 a $8) y prob. de asignación máxima (1 a 15 %).
const DW_MIN = 1;
const DW_MAX = 8;
const DP_MIN = 1;
const DP_MAX = 15;
const PER_NAME = [
  [3, "3 por nombre"],
  [10, "10 por nombre"],
  [0, "Sin tope"],
];
function viewDeals() {
  const symbols = state.scan?.symbols ?? [];
  const f = state.dealFilter;
  const order = state.config.order;
  const { deals, counts, expiries, widths, otmRange, matched } = favoriteDeals(symbols, listSymbols().map((sym) => sym.s), state.config.rules, order, nyToday(), {
    perName: state.dealsPerName,
    expiries: f.expiries,
    maxWidth: f.maxWidth,
    minOtm: f.minOtm,
    maxProb: f.maxProb,
  });
  // Escalones dentro de lo que hay en la lista: "desde 8%", "desde 10%"… De 2 en 2,
  // o de 4 en 4 si el tramo es largo, para que la fila no se haga interminable.
  const otmSteps = [];
  const otmBy = otmRange && otmRange[1] - otmRange[0] > 16 ? 4 : 2;
  if (otmRange) for (let n = Math.ceil((otmRange[0] + 0.01) / otmBy) * otmBy; n <= otmRange[1]; n += otmBy) otmSteps.push(n);
  const today = nyToday();
  const money0 = shortMoney;
  const names = Object.keys(counts);
  const okTotal = names.reduce((sum, name) => sum + counts[name].ok, 0);
  const noTotal = names.reduce((sum, name) => sum + counts[name].no, 0);
  const shown = deals.slice(0, state.dealsShown);
  const filtered = f.expiries.length > 0 || f.maxWidth > 0 || f.minOtm > 0 || f.maxProb > 0;
  const summary = names.length
    ? `${okTotal} cumplen y ${noTotal} no, en ${names.length} nombres.${filtered ? ` Con tus filtros quedan ${matched}.` : ""} Ves ${shown.length}${
        deals.length < matched ? `, con el tope de ${state.dealsPerName} por nombre` : shown.length < deals.length ? ` de ${deals.length}` : ""
      }.`
    : "";
  const why = (sp) => (sp.ok ? "" : `No pasa: ${sp.fails.join(" · ")}`);
  const rows = shown
    .map(
      ({ sym, sp }) => `<li>
        <button class="deal ${sp.ok ? "ok" : "no"}" data-open="${esc(sym.s)}" data-deal="${esc(dealKey(sp))}">
          <span class="deal-top"><i class="dot" aria-hidden="true"></i><b>${esc(sym.s)}</b> <span class="muted">${esc(sp.expiryLabel)} · ${sp.dte} d ·</span> ${fmtStrike(sp.shortStrike)}/${fmtStrike(sp.longStrike)} <span class="muted">· ancho ${widthText(sp)}</span>
            <span class="deal-kpi num">${orderText(sp, order)}</span></span>
          <span class="deal-sub small muted">${pct(sp.otm, 1)} abajo · prob. ${probText(sp)} · rentab. ${pct(sp.ret)} · equilibrio ${kpiText(sp)} · cobras ${usd(sp.creditUsd)} · pierdes máx. ${usd(sp.lossUsd)}${sp.earnInside && sym.er ? ` · resultados ${esc(labelOf(sym.er.d))}` : ""}</span>
          ${sp.ok ? "" : `<span class="deal-why small">${esc(why(sp))}</span>`}
        </button>
      </li>`,
    )
    .join("");
  const head = [
    ["abajo", "% abajo"],
    ["credito", "Cobras"],
    [null, "% del ancho"],
    ["prob", "Prob. asig."],
    ["rentab", "Rentab."],
    [null, "Pérdida máx."],
    ["equilibrio", "Equilibrio"],
  ]
    .map(([id, label]) => (id ? `<th><button data-order="${id}" aria-pressed="${order === id}">${label}${order === id ? " ↓" : ""}</button></th>` : `<th>${label}</th>`))
    .join("");
  const body = shown
    .map(
      ({ sym, sp }) => `<tr data-open="${esc(sym.s)}" data-deal="${esc(dealKey(sp))}" class="${sp.ok ? "ok" : "no"}">
        <td class="l"><i class="dot" aria-hidden="true"></i><b style="font-weight:500">${esc(sym.s)}</b></td>
        <td class="l">${esc(sp.expiryLabel)} <span class="xs muted">${sp.dte} d</span></td>
        <td class="l">${fmtStrike(sp.shortStrike)}/${fmtStrike(sp.longStrike)}</td>
        <td>${widthText(sp)}</td>
        <td>${pct(sp.otm, 1)}</td>
        <td>${usd(sp.creditUsd)}</td>
        <td>${pct(sp.creditPct)}</td>
        <td>${probText(sp)}</td>
        <td>${pct(sp.ret)}</td>
        <td>${usd(sp.lossUsd)}</td>
        <td>${kpiText(sp)}</td>
        <td class="l small ${sp.ok ? "up" : "brass"}" style="white-space:normal;min-width:150px">${sp.ok ? "Cumple" : esc(sp.fails.join(" · "))}${sp.earnInside && sym.er && sp.ok ? ` <span class="brass">· resultados ${esc(labelOf(sym.er.d))}</span>` : ""}</td>
      </tr>`,
    )
    .join("");
  const list = shown.length
    ? `<p class="small muted deal-head"><span>Bull put</span><span>${esc(ORDERS.find((o) => o.id === order)?.label ?? "")}</span></p>
       <ul class="rows">${rows}</ul>
       <div class="table-wrap"><table>
         <thead><tr><th class="l">Nombre</th><th class="l">Vence</th><th class="l">Corto/largo</th><th>Ancho</th>${head}<th class="l">Cumple o por qué no</th></tr></thead>
         <tbody>${body}</tbody></table></div>
       ${deals.length > shown.length ? `<button class="btn" style="margin-top:12px" data-act="more-deals">Ver ${Math.min(60, deals.length - shown.length)} más (quedan ${deals.length - shown.length})</button>` : ""}`
    : `<div class="empty"><h2>${!listSymbols().length ? "Esperando el primer barrido de la lista" : filtered ? "Nada con esos filtros" : "Sin bull puts cerca de tu punto"}</h2>
        <p class="small muted" style="margin-top:8px">${!listSymbols().length ? "Sale cada media hora en horario de mercado." : filtered ? "Quita algún filtro para ver más." : "Ningún nombre tiene puts en tu plazo y dentro de tus reglas."}</p>
        ${filtered ? '<button class="btn" style="margin-top:12px" data-act="clear-filters">Quitar filtros</button>' : ""}</div>`;
  const chip = (attr, value, label, on) => `<button class="chip quiet" ${attr}="${esc(value)}" aria-pressed="${on}">${esc(label)}</button>`;
  return `<div class="deals">
    ${header("Bull put · lista", "Deals")}
    ${summary ? `<p class="small" style="margin-top:12px">${summary}</p>` : ""}
    <div class="tools">
      <div class="chips" role="group" aria-label="Orden">
        ${ORDERS.map((o) => `<button class="chip" data-order="${o.id}" aria-pressed="${o.id === order}">${o.label}</button>`).join("")}
      </div>
    </div>
    <div class="filters" aria-label="Filtros">
      ${
        widths.length
          ? `<div class="frow" role="group" aria-label="Ancho máximo del spread"><span class="flabel xs muted">Ancho</span>
        ${chip("data-f-width", "0", "Todos", !(f.maxWidth > 0))}
        <input type="range" class="range" id="f-width-range" min="${DW_MIN}" max="${DW_MAX}" step="1" value="${f.maxWidth > 0 ? Math.min(DW_MAX, Math.max(DW_MIN, Math.round(f.maxWidth))) : DW_MAX}" style="min-width:90px" aria-label="Ancho máximo, de ${DW_MIN} a ${DW_MAX} dólares">
        <b class="num small" id="f-width-val" style="flex:none;min-width:5.2em;text-align:right">${f.maxWidth > 0 ? `hasta ${money0(f.maxWidth)}` : "Todos"}</b></div>`
          : ""
      }
      <div class="frow" role="group" aria-label="Prob. de asignación máxima"><span class="flabel xs muted">Prob.</span>
        ${chip("data-f-prob", "0", "Todos", !(f.maxProb > 0))}
        <input type="range" class="range" id="f-prob-range" min="${DP_MIN}" max="${DP_MAX}" step="1" value="${f.maxProb > 0 ? f.maxProb : DP_MAX}" style="min-width:90px" aria-label="Prob. de asignación máxima, de ${DP_MIN} % a ${DP_MAX} %">
        <b class="num small" id="f-prob-val" style="flex:none;min-width:5.2em;text-align:right">${f.maxProb > 0 ? `hasta ${f.maxProb} %` : "Todos"}</b></div>
      ${
        expiries.length
          ? `<div class="frow" role="group" aria-label="Vencimiento"><span class="flabel xs muted">Vence</span>
        ${chip("data-f-exp", "", "Todos", f.expiries.length === 0)}${expiries.map((iso) => chip("data-f-exp", iso, `${labelOf(iso)} · ${daysBetween(today, iso)} d`, f.expiries.includes(iso))).join("")}</div>`
          : ""
      }
      ${
        otmSteps.length
          ? `<div class="frow" role="group" aria-label="Porcentaje abajo"><span class="flabel xs muted">% abajo</span>
        ${chip("data-f-otm", "0", "Todos", !(f.minOtm > 0))}${otmSteps.map((n) => chip("data-f-otm", String(n), `desde ${n} %`, f.minOtm === n)).join("")}</div>`
          : ""
      }
      <div class="frow" role="group" aria-label="Cuántos por nombre"><span class="flabel xs muted">Tope</span>
        ${PER_NAME.map(([n, label]) => chip("data-per-name", String(n), label, state.dealsPerName === n)).join("")}</div>
    </div>
    ${state.scan ? list : ""}
    ${foot()}
  </div>`;
}

function viewAvisos() {
  const a = state.config.alerts;
  const push = state.scan?.push;
  const items = state.alerts.length
    ? state.alerts
        .map(
          (alert) => `<div class="alert">
            <p class="xs muted num">${when(alert.at)}</p>
            <p><b>${esc(alert.title)}</b></p>
            <p class="small muted">${esc(alert.text)}</p>
          </div>`,
        )
        .join("")
    : `<div class="alert"><p class="small muted">${isPublic() ? "Los avisos se ven en la app ntfy. El primer barrido solo toma nota; avisa cuando algo cambia." : "Sin avisos todavía. El primer barrido solo toma nota; avisa cuando algo cambia."}</p></div>`;
  return `<div class="narrow">
    <header class="top">
      <p class="eyebrow">Bull put</p>
      <h1 style="margin-top:4px">Avisos</h1>
      <p class="small muted" style="margin-top:8px">${
        state.mode === "muestra" ? "Versión de prueba: aquí se anotarán los avisos cuando la app barra de verdad." : isPublic() ? (push ? "Avisos al móvil activos. Llegan a la app ntfy; aquí no se anotan, porque esta página la puede abrir cualquiera." : "Avisos al móvil sin configurar. Faltan los secretos NTFY_TOPIC y CENTINELA_CONFIG en GitHub.") : push ? "Avisos al móvil activos." : state.mode === "nube" ? "Avisos al móvil sin configurar: se anotan aquí, pero no llegan al teléfono. Falta el secreto NTFY_TOPIC en tu repositorio." : "Avisos al móvil sin configurar: se anotan aquí, pero no llegan al teléfono. El LEEME explica cómo activarlos con ntfy."
      }</p>
    </header>
    <div class="panel">
      <div class="gate">
        <button role="switch" aria-checked="${a.favorites}" data-alert="favorites">
          <span><b>Un nombre pasa a cumplir</b><span class="small muted">Avisa cuando un nombre de la lista entra en tus reglas.</span></span>
          <span class="switch"><i></i></span>
        </button>
      </div>
    </div>
    <p class="small muted" style="margin-top:8px">${esc(syncLine())}</p>
    <section class="block">
      <h2>Bitácora</h2>
      <div class="panel">${items}</div>
    </section>
    ${foot()}
  </div>`;
}

function foot() {
  const failed = state.scan?.failed?.length ?? 0;
  const kept = state.scan?.kept?.length ?? 0;
  return `<p class="foot xs muted">${failed ? `Sin lectura en el último barrido: ${failed} nombres. ` : ""}${kept ? `Con datos del barrido anterior: ${kept} nombres. ` : ""}Un bull put puede perder el ancho menos el crédito. No es una orden ni un consejo, y los datos van con retraso.</p>`;
}

const dealKey = (sp) => `${sp.expiry}|${sp.shortStrike}|${sp.longStrike}`;

/** Ficha de un nombre: arriba el nombre, después el bull put elegido y abajo la lista de
 *  bull puts del nombre. Pulsar una fila de la lista vuelca ese bull put en la zona de arriba.
 *  Abierta desde "Igual riesgo" enseña las cuentas de esa pestaña (neto de comisión, historia). */
function sheet() {
  if (!state.detail) return "";
  const sym = (state.scan?.symbols ?? []).find((item) => item.s === state.detail);
  if (!sym) return "";
  const today = nyToday();
  const res = assessSymbol(sym, state.config.rules, state.config.order, today);
  const igual = state.detailSrc === "igual";
  const stat = (label, value, kpi = false) => `<div class="metric${kpi ? " kpi" : ""}"><dt>${label}</dt><dd>${value}</dd></div>`;
  const sub = (text) => `<span class="xs muted" style="display:block;font-weight:400">${text}</span>`;

  // El bull put elegido: el pulsado y, si no hay o ya no existe, el mejor según las reglas.
  let sp = null; // con las cuentas de las reglas (Lista y Deals)
  let row = null; // con las cuentas de "Igual riesgo"
  const wanted = state.detailDeal ?? (res.best ? dealKey(res.best) : null);
  if (igual && wanted) {
    const [expiry, short, long] = wanted.split("|");
    const made = withHistory(spreadRow(sym, expiry, Number(short), Number(long), state.config.rules.equalFee, today), state.hist?.symbols?.[sym.s], today);
    row = made.status === "ok" ? made : null;
  } else if (wanted) {
    sp = res.all.find((idea) => dealKey(idea) === wanted) ?? res.best;
  }
  const chosen = row ?? sp;
  const chosenKey = chosen ? dealKey(chosen) : null;

  const notes = [];
  if (sp?.fails.length) notes.push(`No pasa: ${sp.fails.join(" · ")}`);
  if (chosen) {
    const liquid = liquidityNotes(chosen, state.config.rules.gates).filter((note) => !(sp?.fails ?? []).includes(note));
    if (liquid.length) notes.push(`Aviso: ${liquid.join(" · ")}`);
    if (chosen.earnInside && sym.er) notes.push(`Resultados ${labelOf(sym.er.d)} · dentro del plazo`);
    if (row?.shortHistory && row.histProb != null) notes.push("Poca historia: menos de 2 años de cierres");
    if (row?.onlyOne) notes.push(`Solo con un cálculo: con historia ${signedUsd(row.marginHist)} · con lo reciente ${signedUsd(row.marginRecent)}. La media esconde que solo sale bien con uno de los dos`);
    else if (row?.distinct) notes.push("Estimaciones muy distintas: 5 años de precios y volatilidad reciente no se parecen");
    if (row?.trend?.length) notes.push(`Tendencia: ${row.trend.join(" · ")}`);
    if (row?.fed?.length) notes.push(`Fed el ${row.fed.map((date) => labelOf(date)).join(" y ")} · dentro del plazo`);
    if (row && gateReason(row, state.config.rules.equalGapPct)) notes.push(`Apartada de la comparación: ${gateReason(row, state.config.rules.equalGapPct)}`);
  }
  const title = chosen
    ? `${fmtStrike(chosen.shortStrike)}/${fmtStrike(chosen.longStrike)} · ${esc(chosen.expiryLabel)} · ${chosen.dte} d · ancho ${widthText(chosen)}`
    : "";
  const tiles = row
    ? `${stat("% abajo", `${dec(row.otm)} %`)}
       ${stat("Cobras neto", usdDec(row.net))}
       ${stat("Pérdida máx.", usdDec(row.loss))}
       ${stat("Prob. asignación", `${row.prob == null ? "—" : `${dec(row.prob)} %`}${row.probSrc === "formula" ? sub("por fórmula") : ""}${row.histProb != null ? sub(`historia ${dec(row.histProb)} %`) : ""}`)}
       ${stat("Rentab. neta", `${dec(row.ret)} %`)}
       ${stat(row.balanceHist != null ? "Equilibrio con historia" : "Equilibrio", row.balanceHist == null ? "—" : row.balanceHist > 99 ? ">99" : dec(row.balanceHist, 1), true)}`
    : sp
      ? `${stat("% abajo", pct(sp.otm, 1))}
       ${stat("Cobras", usd(sp.creditUsd))}
       ${stat("Pérdida máx.", usd(sp.lossUsd))}
       ${stat("Prob. asignación", `${probText(sp)}${sp.probSrc === "formula" ? sub("por fórmula") : ""}`)}
       ${stat("Rentabilidad", pct(sp.ret))}
       ${stat("Equilibrio", kpiText(sp), true)}`
      : "";
  const lose = row
    ? `Pierdes por debajo de ${usdDec(row.breakeven)}. Cobras ya con la comisión de ${usdDec(state.config.rules.equalFee)}.`
    : sp
      ? `Pierdes por debajo de ${money(sp.breakeven)}.`
      : "";
  const chosenBlock = chosen
    ? `<div class="chosen">
        <p class="chosen-title">${title}</p>
        <dl class="stats">${tiles}</dl>
        <p class="small" style="margin-top:8px">${lose}</p>
        ${notes.map((note) => `<p class="small brass" style="margin-top:4px">${esc(note)}</p>`).join("")}
      </div>`
    : `<p class="small muted" style="margin-top:14px">${igual && wanted ? "Ese bull put ya no tiene precio." : "No hay ningún bull put cerca de tu punto en tu plazo."}</p>`;

  const year = yearRange(state.hist?.symbols?.[sym.s]?.c, sym.p);
  const vols = volatilities(state.hist?.symbols?.[sym.s]?.c);
  // De un vistazo: dónde está el precio dentro de su rango de 52 semanas y cuánto se mueve (tres volatilidades en la misma escala).
  const spread = year && year.max > year.min ? year.max - year.min : 0;
  const at = spread ? Math.min(100, Math.max(0, ((sym.p - year.min) / spread) * 100)) : null;
  const rangeBlock =
    year && at != null
      ? `<div class="glance-block">
        <div class="glance-head"><span>${year.sessions > 250 ? "52 semanas" : `Últimas ${year.sessions} sesiones`}</span><b class="num">${num(at, 0)} % del rango</b></div>
        <div class="range-bar" role="img" aria-label="El precio está al ${num(at, 0)} % entre el mínimo y el máximo"><i style="left:${at.toFixed(1)}%"></i></div>
        <div class="glance-ends"><span class="num"><b>${money(year.min)}</b> mín.</span><span class="num">máx. <b>${money(year.max)}</b></span></div>
      </div>`
      : "";
  const volRows = [];
  if (sym.iv30 != null) volRows.push(["Implícita 30 d", sym.iv30, "implied"]);
  if (vols?.recentPct != null && vols.longPct != null) {
    volRows.push(["Ahora", vols.recentPct, "recent"]);
    volRows.push([spanText(state.hist.symbols[sym.s].c.length / 252), vols.longPct, "long"]);
  }
  const volMax = Math.max(1, ...volRows.map((row) => row[1])) * 1.1;
  const ratio = vols?.recentPct != null && vols.longPct > 0 ? vols.recentPct / vols.longPct : null;
  const volNote = ratio == null ? "" : ratio < 0.75 ? "Ahora se mueve bastante menos que de costumbre: el cálculo reciente es el optimista." : ratio > 1.33 ? "Ahora se mueve bastante más que de costumbre." : "";
  const volBlock = volRows.length
    ? `<div class="glance-block">
        <div class="glance-head"><span>Volatilidad: cuánto se mueve al año</span></div>
        ${volRows.map(([label, value, kind]) => `<div class="vol-row"><span class="vol-label">${esc(label)}</span><span class="vol-track"><i class="${kind}" style="width:${((value / volMax) * 100).toFixed(1)}%"></i></span><b class="num">${num(value, 0)} %</b></div>`).join("")}
        ${volNote ? `<p class="xs brass" style="margin-top:6px">${volNote}</p>` : ""}
      </div>`
    : "";
  const glance = rangeBlock || volBlock ? `<div class="glance">${rangeBlock}${volBlock}</div>` : "";
  const byOrder = (a, b) => compareSpreads(a, b, state.config.order);
  const okIdeas = res.all.filter((idea) => idea.ok).sort(byOrder);
  const otherIdeas = res.all.filter((idea) => !idea.ok).sort((a, b) => b.stage - a.stage || byOrder(a, b));
  const MAX_OK = 40;
  const MAX_OTHER = 12;
  const ideaRow = (idea) => `<li class="${dealKey(idea) === chosenKey ? "watched" : ""}">
      <button data-pick="${esc(dealKey(idea))}" aria-pressed="${dealKey(idea) === chosenKey}">
      <p class="small">${esc(idea.expiryLabel)} · ${fmtStrike(idea.shortStrike)}/${fmtStrike(idea.longStrike)} · ancho ${widthText(idea)} · ${pct(idea.otm, 1)} abajo · cobras ${usd(idea.creditUsd)}</p>
      <p class="small muted">prob. ${probText(idea)} · rentab. ${pct(idea.ret)} · equilibrio ${kpiText(idea)}${idea.ok ? "" : ` · ${esc(idea.fails.join(" · "))}`}</p>
      </button>
    </li>`;
  return `<div class="sheet-back" data-close>
    <div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(sym.s)}">
      <div class="sheet-head">
        <div style="min-width:0">
          <h2 style="font-size:2rem">${esc(sym.s)} <span class="pill ${res.status}" style="vertical-align:middle;font-family:var(--sans)">${statusLabel(res.status)}</span></h2>
          <p class="small muted">${esc(nameOf(sym))}</p>
        </div>
        <div style="display:flex;gap:4px;align-items:center"><button class="btn quiet" data-close>Cerrar</button></div>
      </div>
      <p style="margin-top:10px"><span class="num" style="font-size:1.75rem;font-weight:500">${money(sym.p)}</span>
        <span class="num ${sym.c >= 0 ? "up" : "down"}" style="margin-left:8px">${signed(sym.c)}</span></p>
      ${glance}
      ${chosenBlock}
      ${
        res.all.length
          ? `<h3 style="font-size:1.25rem;margin-top:18px">Bull puts de ${esc(sym.s)}</h3>
        <p class="small muted" style="margin-top:4px">Pulsa uno para verlo arriba.</p>
        <div class="chips" role="group" aria-label="Orden" style="margin-top:8px">
          ${ORDERS.map((o) => `<button class="chip" data-order="${o.id}" aria-pressed="${o.id === state.config.order}">${o.label}</button>`).join("")}
        </div>
        <p class="small muted" style="margin-top:10px">Cumplen ${okIdeas.length}${okIdeas.length > MAX_OK ? `, se ven los ${MAX_OK} primeros` : ""}.</p>
        ${okIdeas.length ? `<ul class="ideas">${okIdeas.slice(0, MAX_OK).map(ideaRow).join("")}</ul>` : ""}
        ${otherIdeas.length ? `<p class="small muted" style="margin-top:12px">No cumplen, los más cercanos:</p><ul class="ideas">${otherIdeas.slice(0, MAX_OTHER).map(ideaRow).join("")}</ul>` : ""}`
          : ""
      }
    </div>
  </div>`;
}

// ---------- Igual riesgo (pestaña de prueba) ----------

const nearest = (list, value) => list.reduce((best, item) => (Math.abs(item - value) < Math.abs(best - value) ? item : best), list[0]);
const dec = (n, d = 1) => num(n, d);
const usdDec = (n) => `$${dec(n, 2)}`;
/** Dólares: enteros desde $10, con céntimos por debajo. Con signo en `signedUsd`. */
const dollars = (n) => (Math.abs(n) >= 10 ? `$${num(Math.round(n), 0)}` : usdDec(n));
const signedUsd = (n) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${dollars(Math.abs(n))}`;
/** "5 años" con la historia completa; si hay menos, lo que hay. */
const spanText = (years) => (years >= 4.5 ? "5 años" : years >= 1.5 ? `${num(Math.round(years * 10) / 10, 1)} años` : "lo guardado");

function equalOpts(symbols) {
  const rules = state.config.rules;
  const eq = state.equal;
  const expiries = commonExpiries(symbols, rules, nyToday());
  const expiry = eq.expiry && expiries.some((item) => item.expiry === eq.expiry) ? eq.expiry : defaultExpiry(expiries);
  return {
    expiries,
    opts: {
      prob: eq.prob ?? (rules.maxProb >= PROB_OFF ? 10 : Math.min(EQ_PROB_MAX, Math.max(EQ_PROB_MIN, Math.round(rules.maxProb)))),
      width: eq.width ?? nearest(EQ_WIDTHS, rules.width),
      expiry,
      fee: rules.equalFee,
      gapPct: rules.equalGapPct,
    },
  };
}

function viewIgual() {
  const symbols = listSymbols();
  const { expiries, opts } = equalOpts(symbols);
  const hist = state.hist?.symbols ?? null;
  const { rows, gated, out } = opts.expiry ? equalRiskList(symbols, { ...opts, hist }, nyToday()) : { rows: [], gated: [], out: [] };
  const withHist = rows.some((row) => row.retExp != null);
  const balText = (row) => (row.balanceHist == null ? "—" : row.balanceHist > 99 ? ">99" : dec(row.balanceHist, 1));
  const expText = (row) => (row.retExp == null ? `${dec(row.ret)} %` : `${row.retExp > 0 ? "+" : ""}${dec(row.retExp)} %`);
  const costText = (row) => (row.roundTrip == null ? "coste total sin precio medio" : `coste total ${usdDec(row.roundTrip)}`);
  const chip = (attr, value, label, on) => `<button class="chip quiet" data-${attr}="${esc(value)}" aria-pressed="${on}">${label}</button>`;
  const blockOf = (sym) => sym.b ?? "";
  const widthNote = (row) => (Math.abs(row.width - opts.width) > 1e-6 ? ` <span class="muted">· ancho ${shortMoney(row.width)}</span>` : "");
  const volText = (row) => `ahora se mueve un ${num(row.vol, 0)} %; en ${spanText(row.years)}, un ${num(row.vol5, 0)} %`;
  // Avisos en rojo dentro de la fila: resultados dentro del plazo (la historia casi no contiene saltos de resultados)
  // y decisión de la Fed dentro del plazo (solo bonos largos y bolsa de EE. UU.). No apartan la fila.
  const earnTag = (row) => (row.earnInside && row.sym.er ? `<span class="tag-earn">Resultados ${esc(labelOf(row.sym.er.d))}</span> ` : "");
  const fedTag = (row) => (row.fed?.length ? `<span class="tag-earn">Fed el ${row.fed.map((date) => esc(labelOf(date))).join(" y ")}</span> ` : "");
  // Marcas de la fila, en píldoras: rojas (resultados, Fed), ámbar (solo con un cálculo) y discretas (el resto).
  const pills = (row) => {
    const notes = [];
    // "Solo con un cálculo" es más fuerte que "estimaciones muy distintas": si se dan las dos, solo la primera.
    if (row.distinct && !row.onlyOne) notes.push('<span class="tag-note">estimaciones muy distintas</span>');
    if (row.shortHistory && row.histProb != null) notes.push('<span class="tag-note">poca historia</span>');
    for (const note of row.trend ?? []) notes.push(`<span class="tag-note brass">${esc(note)}</span>`);
    if (row.onlyOne) notes.push('<span class="tag-warn">solo con un cálculo</span>');
    const all = `${earnTag(row)}${fedTag(row)}${notes.join("")}`;
    return all ? `<span class="eq-tags small">${all}</span>` : "";
  };
  // Barra: lo verde es lo que cobras; las marcas, lo que se espera pagar con cada cálculo. Una marca fuera de lo verde
  // = con ese cálculo se paga más de lo que se cobra. Debajo, los tres números y lo que queda (cobras − pagas).
  const payBar = (row) => {
    if (row.expected == null) return "";
    const max = Math.max(row.net, row.histLoss, row.recentLoss, 0.01) * 1.06;
    const frac = (value) => Math.max(0, Math.min(1, value / max));
    const at = (value) => `${(frac(value) * 100).toFixed(1)}%`;
    // Etiqueta de lo que cobras, pegada al final de lo verde (a la izquierda si lo verde es muy corto).
    const tagStyle = frac(row.net) < 0.3 ? "left:0" : `left:${at(row.net)};transform:translateX(-100%)`;
    const calc = (cls, label, paid, left) =>
      `<span class="eq-calc"><span class="eq-lab"><i class="eq-key ${cls}" aria-hidden="true"></i>${label}</span><b class="num">${dollars(paid)}</b><span class="num ${left < 0 ? "eq-minus" : "eq-plus"}">queda ${signedUsd(left)}</span></span>`;
    return `<span class="eq-pay">
            <span class="eq-got" style="${tagStyle}">Cobras neto <b>${usdDec(row.net)}</b></span>
            <span class="eq-track" aria-hidden="true"><i class="eq-fill" style="width:${at(row.net)}"></i><i class="eq-mark recent" style="left:${at(row.recentLoss)}"></i><i class="eq-mark hist" style="left:${at(row.histLoss)}"></i><i class="eq-mark mean" style="left:${at(row.expected)}"></i></span>
            <span class="eq-calcs">${calc("recent", "Con lo reciente", row.recentLoss, row.marginRecent)}${calc("mean", "Se espera pagar", row.expected, Math.round((row.net - row.expected) * 100) / 100)}${calc("hist", "Con historia", row.histLoss, row.marginHist)}</span>
            <span class="eq-balance small"><span class="muted">Equilibrio (cobras ÷ se espera pagar)</span><b class="num">${balText(row)}</b></span>
          </span>`;
  };
  const cell = (label, value) => `<span class="eq-cell"><span class="eq-lab">${label}</span><b class="num">${value}</b></span>`;
  const grid = (row) => {
    const formula = row.probSrc === "formula" ? " (fórmula)" : "";
    const probCell = cell(row.histProb == null ? "Prob. asignación" : "Prob. mercado", `${dec(row.prob)} %${formula}`);
    const longCell = cell("Prob. pérd. máx.", row.longProb == null ? "—" : `${dec(row.longProb)} %`);
    // Sin cierres para este nombre no hay barra ni prob. de historia.
    const cells = row.expected == null ? [probCell, longCell] : [probCell, cell("Prob. historia", `${dec(row.histProb)} %`), longCell];
    return `<span class="eq-grid">${cells.join("")}</span>`;
  };
  const stakes = (row) =>
    `<span class="eq-stakes"><span class="eq-stake"><span class="eq-lab">Cobras neto</span><b class="num up">${usdDec(row.net)}</b></span><span class="eq-stake"><span class="eq-lab">Coste total</span><b class="num">${row.roundTrip == null ? "—" : usdDec(row.roundTrip)}</b></span><span class="eq-stake"><span class="eq-lab">Pierdes máx.</span><b class="num down">${usdDec(row.loss)}</b></span></span>`;
  const kpiTone = (row) => (row.retExp == null ? "" : row.retExp > 0 ? " plus" : " minus");
  const item = (row) => `<li>
        <button class="deal ok eq-row" data-open="${esc(row.sym.s)}" data-deal="${esc(dealKey(row))}" data-src="igual">
          <span class="deal-top"><i class="dot" aria-hidden="true"></i><b>${esc(row.sym.s)}</b> <span class="muted">${esc(blockOf(row.sym))}</span>
            <span class="eq-legs">${fmtStrike(row.shortStrike)}/${fmtStrike(row.longStrike)}${widthNote(row)} <span class="muted">· ${dec(row.otm)} % abajo</span></span>
            <span class="deal-kpi num${kpiTone(row)}">${expText(row)}<small>${row.retExp == null ? "Rentab. neta" : "Rentab. esperada"}</small></span></span>
          ${stakes(row)}
          ${pills(row)}
          ${grid(row)}
          ${row.onlyOne || row.distinct ? `<span class="deal-sub small muted">${esc(volText(row).replace(/^a/, "A"))}</span>` : ""}
          ${payBar(row)}
        </button>
      </li>`;
  const list = rows.map(item).join("");
  const gatedList = gated
    .map(
      (row) => `<li style="opacity:.7">
        <button class="deal" data-open="${esc(row.sym.s)}" data-deal="${esc(dealKey(row))}" data-src="igual">
          <span class="deal-top"><b style="font-weight:500">${esc(row.sym.s)}</b> <span class="muted">${esc(blockOf(row.sym))} ·</span> ${fmtStrike(row.shortStrike)}/${fmtStrike(row.longStrike)}${widthNote(row)}</span>
          <span class="deal-sub small muted">${earnTag(row)}${fedTag(row)}${esc(row.gate)} · cobras neto ${usdDec(row.net)} · ${costText(row)}</span>
        </button>
      </li>`,
    )
    .join("");
  const rest = out
    .map(
      (row) => `<li class="muted" style="padding:9px 0;opacity:.7"><b style="font-weight:500">${esc(row.sym.s)}</b> <span class="small">${esc(blockOf(row.sym))} · ${esc(row.why)}</span></li>`,
    )
    .join("");
  const empty = !symbols.length
    ? "Esperando el primer barrido de la lista."
    : !opts.expiry
      ? "Ningún vencimiento cae dentro del plazo de Reglas."
      : "";
  const closed = state.scan && !state.scan.example && pricesOutsideMarket(state.scan.at);
  const noneCovers = withHist && rows.length > 0 && !rows.some((row) => row.retExp != null && row.retExp > 0);
  return `
    ${header("Prueba", "Igual riesgo", false)}
    ${closed ? '<p class="banner small">Precios tomados con el mercado cerrado: las horquillas son más anchas y salen menos filas.</p>' : ""}
    <div class="filters">
      <div class="frow" role="group" aria-label="Prob. objetivo"><span class="small muted">Prob. objetivo</span>${EQ_PROBS.map((n) => chip("eq-prob", n, `${n} %`, opts.prob === n)).join("")}</div>
      <div class="frow" role="group" aria-label="Prob. objetivo, de ${EQ_PROB_MIN} % a ${EQ_PROB_MAX} %"><span class="small muted">${EQ_PROB_MIN} %</span>
        <input type="range" class="range" id="eq-range" min="${EQ_PROB_MIN}" max="${EQ_PROB_MAX}" step="1" value="${opts.prob}" aria-label="Prob. objetivo">
        <span class="small muted">${EQ_PROB_MAX} %</span><b class="num" id="eq-range-val" style="min-width:3.2em;text-align:right">${opts.prob} %</b></div>
      ${opts.prob < 5 ? '<p class="small muted" style="margin:0 0 6px">Por debajo del 5 % hay muy pocos casos en la historia y los precios son de céntimos: la comparación es poco fiable.</p>' : ""}
      <div class="frow" role="group" aria-label="Ancho"><span class="small muted">Ancho</span>${EQ_WIDTHS.map((n) => chip("eq-width", n, `$${n}`, opts.width === n)).join("")}</div>
      <div class="frow" role="group" aria-label="Vencimiento"><span class="small muted">Vencimiento</span>${expiries.map((item) => chip("eq-exp", item.expiry, esc(item.label), opts.expiry === item.expiry)).join("") || '<span class="small muted">ninguno en el plazo</span>'}</div>
      <button class="rules-line small" data-tab="reglas">Comisión por spread al abrir ${usdDec(opts.fee)} · horquilla máxima ${opts.gapPct} % · se cambian en Reglas</button>
    </div>
    <button class="rules-line small" style="margin:0 0 10px" data-act="eq-help" aria-expanded="${state.eqHelp ? "true" : "false"}">Cómo se ordena y cómo se lee ${state.eqHelp ? "▴" : "▾"}</button>
    ${
      state.eqHelp
        ? `<div class="eq-help small muted">
      <p>Una fila por nombre: prob. de asignación hasta el objetivo, mismo vencimiento y el ancho más cercano al elegido. Antes de ordenar se apartan las filas que no se pueden comparar: horquilla ancha (más del ${opts.gapPct} % del crédito; se cambia en Reglas) y cobro que no cubre el coste de salir. Las que tienen resultados dentro del plazo se quedan en la lista, marcadas en rojo: la historia casi no contiene saltos de resultados, así que su número es menos fiable.</p>
      <p>${
        withHist
          ? `Orden: rentab. esperada = (cobras neto − lo que se espera pagar) ÷ pierdes máx. Lo que se espera pagar es la media de dos cálculos: 5 años de precios y la volatilidad reciente. Por encima de 0, lo cobrado supera lo que se espera pagar. Es una estimación para ordenar, no una previsión. Cierres hasta el ${esc(labelOf(state.hist.last))}${state.hist.example ? " (de ejemplo)" : ""}.`
          : "Orden: rentab. neta. Todavía no hay cierres diarios guardados para comparar con la historia."
      }</p>
      ${withHist ? "<p>La barra: lo verde es lo que cobras neto. Las marcas son lo que se espera pagar: la ámbar con la volatilidad reciente, la blanca con los 5 años de precios y el círculo, la media de las dos, que es lo que se espera pagar. Una marca fuera de lo verde quiere decir que con ese cálculo se paga más de lo que se cobra. «Queda» = cobras neto − lo que se espera pagar.</p>" : ""}
    </div>`
        : ""
    }
    ${noneCovers ? '<p class="banner small">Hoy ninguno cubre lo que se espera pagar. La lista enseña el orden, no candidatos.</p>' : ""}
    ${
      empty
        ? `<div class="empty"><h2>${empty}</h2></div>`
        : `<div class="deal-head small muted"><span>${rows.length} ${rows.length === 1 ? "fila" : "filas"}</span><span>${withHist ? "Rentab. esperada" : "Rentab. neta"}</span></div><ul class="rows">${list}</ul>
    ${gatedList ? `<p class="small muted" style="margin:16px 0 2px">Apartadas: no se pueden comparar</p><ul class="rows">${gatedList}</ul>` : ""}
    ${rest ? `<p class="small muted" style="margin:14px 0 2px">Sin fila</p><ul class="rows">${rest}</ul>` : ""}`
    }
    ${foot()}`;
}

function dock() {
  const seen = Number(readLocal(LS_SEEN) ?? 0);
  const unseen = state.alerts.filter((alert) => alert.at > seen).length;
  const item = (id, label) =>
    `<button data-tab="${id}" ${state.tab === id ? 'aria-current="page"' : ""}>${ICONS[id]}<span>${label}</span>${id === "igual" ? '<span class="tag">prueba</span>' : ""}${id === "avisos" && unseen ? `<span class="badge">${unseen > 9 ? "9+" : unseen}</span>` : ""}</button>`;
  return `<nav class="dock" aria-label="Secciones"><div>
    ${item("favoritos", "Lista")}${item("deals", "Deals")}${item("igual", "Igual")}${item("avisos", "Avisos")}${item("reglas", "Reglas")}
  </div></nav>`;
}

function render() {
  const view =
    state.tab === "deals" ? viewDeals() : state.tab === "igual" ? viewIgual() : state.tab === "reglas" ? viewReglas() : state.tab === "avisos" ? viewAvisos() : viewFavoritos();
  const before = root.querySelector(".sheet");
  const keep = before ? { name: before.getAttribute("aria-label"), top: before.scrollTop } : null;
  root.innerHTML = `<main class="wrap">${view}</main>${dock()}${sheet()}`;
  // Al pulsar dentro de la ficha (otro bull put, otro orden) se queda donde estaba.
  const after = root.querySelector(".sheet");
  if (keep && after && after.getAttribute("aria-label") === keep.name) after.scrollTop = keep.top;
}

// ---------- eventos ----------

function setPath(config, path, value) {
  const keys = path.split(".");
  let obj = config;
  for (const key of keys.slice(0, -1)) obj = obj[key];
  obj[keys.at(-1)] = value;
}

const PAIRS = { "rules.maxDte": "rules.minDte", "rules.maxOtm": "rules.minOtm", "rules.gates.lossMax": "rules.gates.lossMin" };

// Deslizador de la prob. objetivo: mientras se arrastra solo cambia el número; al soltar, se aplica.
root.addEventListener("input", (event) => {
  const id = event.target.id;
  if (id === "f-width-range" || id === "f-prob-range") {
    const label = root.querySelector(id === "f-width-range" ? "#f-width-val" : "#f-prob-val");
    if (label) label.textContent = id === "f-width-range" ? `hasta $${event.target.value}` : `hasta ${event.target.value} %`;
    return;
  }
  if (id !== "eq-range") return;
  const label = root.querySelector("#eq-range-val");
  if (label) label.textContent = `${event.target.value} %`;
});
root.addEventListener("change", (event) => {
  const id = event.target.id;
  if (id === "f-width-range" || id === "f-prob-range") {
    const value = Number(event.target.value);
    if (id === "f-width-range") state.dealFilter.maxWidth = value >= DW_MIN && value <= DW_MAX ? value : 0;
    else state.dealFilter.maxProb = value >= DP_MIN && value <= DP_MAX ? value : 0;
    state.dealsShown = 60;
    render();
    return;
  }
  if (event.target.id !== "eq-range") return;
  const value = Number(event.target.value);
  if (!EQ_OK.prob(value)) return;
  state.equal.prob = value;
  writeLocal(LS_EQUAL, state.equal);
  render();
});

root.addEventListener("click", (event) => {
  const el = event.target.closest("[data-pick],[data-eq-prob],[data-eq-width],[data-eq-exp],[data-off],[data-step],[data-gate],[data-rule-switch],[data-alert],[data-order],[data-per-name],[data-f-exp],[data-f-width],[data-f-otm],[data-tab],[data-act],[data-open],[data-close]");
  if (!el) return;
  if (el.classList.contains("sheet-back") && event.target !== el) return; // clic dentro de la ficha
  if (el.dataset.eqProb || el.dataset.eqWidth || el.dataset.eqExp) {
    const eq = state.equal;
    if (el.dataset.eqProb) eq.prob = Number(el.dataset.eqProb);
    if (el.dataset.eqWidth) eq.width = Number(el.dataset.eqWidth);
    if (el.dataset.eqExp) eq.expiry = el.dataset.eqExp;
    writeLocal(LS_EQUAL, eq);
    render();
  } else if (el.dataset.off) {
    const name = el.dataset.off;
    changeConfig((config) => {
      config.off = config.off.includes(name) ? config.off.filter((s) => s !== name) : [...config.off, name];
    });
  } else if (el.dataset.step) {
    const path = el.dataset.step;
    const current = path.split(".").reduce((obj, key) => obj[key], state.config);
    const by = Number(el.dataset.by);
    const next = Math.min(Number(el.dataset.max), Math.max(Number(el.dataset.min), Math.round((current + Number(el.dataset.dir) * by) * 100) / 100));
    changeConfig((config) => {
      setPath(config, path, next);
      const low = PAIRS[path];
      if (low && low.split(".").reduce((obj, key) => obj[key], config) > next) setPath(config, low, next);
    });
  } else if (el.dataset.gate) {
    changeConfig((config) => {
      config.rules.gates[el.dataset.gate] = !config.rules.gates[el.dataset.gate];
    });
  } else if (el.dataset.ruleSwitch) {
    changeConfig((config) => {
      config.rules[el.dataset.ruleSwitch] = !config.rules[el.dataset.ruleSwitch];
    });
  } else if (el.dataset.alert) {
    changeConfig((config) => {
      config.alerts[el.dataset.alert] = !config.alerts[el.dataset.alert];
    });
  } else if (el.dataset.order) {
    state.dealsShown = 60;
    changeConfig((config) => {
      config.order = el.dataset.order;
    });
  } else if (el.dataset.perName != null) {
    state.dealsPerName = Number(el.dataset.perName);
    state.dealsShown = 60;
    render();
  } else if (el.dataset.fWidth != null) {
    state.dealFilter.maxWidth = Number(el.dataset.fWidth) || 0;
    state.dealsShown = 60;
    render();
  } else if (el.dataset.fProb != null) {
    state.dealFilter.maxProb = Number(el.dataset.fProb) || 0;
    state.dealsShown = 60;
    render();
  } else if (el.dataset.fOtm != null) {
    state.dealFilter.minOtm = Number(el.dataset.fOtm) || 0;
    state.dealsShown = 60;
    render();
  } else if (el.dataset.fExp != null) {
    const value = el.dataset.fExp;
    const list = state.dealFilter.expiries;
    state.dealFilter.expiries = value === "" ? [] : list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
    state.dealsShown = 60;
    render();
  } else if (el.dataset.act === "eq-help") {
    state.eqHelp = !state.eqHelp;
    render();
  } else if (el.dataset.act === "clear-filters") {
    state.dealFilter = { expiries: [], maxWidth: 0, minOtm: 0, maxProb: 0 };
    state.dealsShown = 60;
    render();
  } else if (el.dataset.act === "copy-secret") {
    const done = (text) => {
      state.copied = text;
      render();
      root.querySelector("#secreto")?.select();
    };
    try {
      navigator.clipboard.writeText(secretText()).then(
        () => {
          writeLocal(LS_COPIED, Date.now());
          done("Copiado. Pégalo en GitHub: Settings → Secrets and variables → Actions → CENTINELA_CONFIG.");
        },
        () => done("No se pudo copiar solo. Mantén pulsado el texto de abajo y cópialo a mano."),
      );
    } catch {
      done("No se pudo copiar solo. Mantén pulsado el texto de abajo y cópialo a mano.");
    }
  } else if (el.dataset.act === "more-deals") {
    state.dealsShown += 60;
    render();
  } else if (el.dataset.tab) {
    state.tab = el.dataset.tab;
    state.detail = null;
    if (state.tab === "avisos") writeLocal(LS_SEEN, Date.now());
    window.scrollTo(0, 0);
    render();
  } else if (el.dataset.pick) {
    state.detailDeal = el.dataset.pick;
    render();
  } else if (el.dataset.open) {
    state.detail = el.dataset.open;
    state.detailDeal = el.dataset.deal ?? null;
    state.detailSrc = el.dataset.src ?? "";
    render();
  } else if (el.dataset.close != null) {
    state.detail = null;
    state.detailDeal = null;
    state.detailSrc = "";
    render();
  } else if (el.dataset.act === "reload") {
    void load().then(loadHist, loadHist);
  } else if (el.dataset.act === "real") {
    void loadReal();
  } else if (el.dataset.act === "example") {
    useExample();
  } else if (el.dataset.act === "reset") {
    changeConfig((config) => {
      config.rules = structuredClone(DEFAULT_CONFIG.rules);
      config.order = DEFAULT_CONFIG.order;
    });
  } else if (el.dataset.act === "gh-edit") {
    state.showGh = true;
    render();
  } else if (el.dataset.act === "gh-clear") {
    state.gh = { ...state.gh, token: "" };
    writeLocal(LS_GH, state.gh);
    state.sync = { state: "local", message: "" };
    render();
  }
});

root.addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.target;
  if (form.matches("[data-bridge]")) {
    writeLocal(LS_BRIDGE, String(new FormData(form).get("bridge") ?? "").trim());
    render();
  } else if (form.matches("[data-gh]")) {
    const data = new FormData(form);
    state.gh = {
      owner: String(data.get("owner") ?? "").trim(),
      repo: String(data.get("repo") ?? "").trim(),
      token: String(data.get("token") ?? "").trim(),
    };
    writeLocal(LS_GH, state.gh);
    state.showGh = false;
    state.tab = "favoritos";
    void load().then(loadHist, loadHist);
  }
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && state.detail) {
    state.detail = null;
    render();
  }
});

if (!EMBED && "serviceWorker" in navigator && window.location.protocol !== "file:") {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

void load().then(loadHist, loadHist);
