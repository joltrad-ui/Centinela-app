#!/usr/bin/env node
// Barrido de Centinela. Sin dependencias: solo Node 22.
//
//   node scanner/scan.mjs                 un barrido y termina (modo nube)
//   node scanner/scan.mjs --serve         barre cada 30 min y sirve la app (modo ordenador)
//
// Opciones: --out <carpeta>  --port <n>  --prev-url <url>  --fixtures <carpeta>  --limit <n>
//           --lista rapida   solo la lista rápida; deja el universo como estaba.
//           --public   lo que se escribe va a publicarse: nada personal en claro.
//
// Modo --public. Las reglas y los favoritos no se leen de config.json sino del
// secreto CENTINELA_CONFIG, y nunca se escriben. El estado de los avisos se
// guarda cifrado con una clave sacada del secreto NTFY_TOPIC. El barrido que
// se publica es genérico: los mismos nombres y datos para cualquiera.

import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  alertText,
  cleanSymbol,
  daysBetween,
  normalizeConfig,
  nyToday,
  rankUniverse,
  readCboeChain,
  cboeUrl,
} from "../web/engine.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = parseArgs(process.argv.slice(2));
const OUT = path.resolve(args.out ?? path.join(ROOT, "out"));
const DATA = path.join(OUT, "data");
const CONFIG_PATH = path.join(ROOT, "config.json");
const FIXTURES = args.fixtures ? path.resolve(args.fixtures) : null;
const PUBLIC = Boolean(args.public);
// --lista rapida: solo la lista rápida (scanner/rapida.json), a data/rapido.json.
// Sin esa opción, el universo completo, a data/scan.json.
const FAST = args.lista === "rapida";
const OUT_FILE = FAST ? "rapido.json" : "scan.json";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
const SP500_CSV = "https://raw.githubusercontent.com/datasets/s-and-p-500-companies/main/data/constituents.csv";
const EARN_TTL_DAYS = 3;
const EARN_BUDGET = 220; // consultas de resultados por barrido
const IV_DAYS = 260;

function parseArgs(list) {
  const out = {};
  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    if (!item.startsWith("--")) continue;
    const key = item.slice(2);
    const next = list[i + 1];
    if (next && !next.startsWith("--")) {
      out[key] = next;
      i++;
    } else out[key] = true;
  }
  return out;
}

const log = (...parts) => console.log(new Date().toISOString().slice(11, 19), ...parts);

// ---------- red ----------

// Freno compartido: cuando un servidor contesta 429 (demasiadas peticiones), todas las
// peticiones esperan un poco antes de seguir. Así el barrido se ajusta solo al ritmo que admite.
let holdUntil = 0;
let holdStep = 2_000;

async function getJson(url, headers = {}, timeout = 15_000, tries = 3) {
  let last;
  for (let attempt = 0; attempt < tries; attempt++) {
    while (Date.now() < holdUntil) await sleep(holdUntil - Date.now() + Math.random() * 400);
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "application/json", ...headers },
        signal: AbortSignal.timeout(timeout),
        redirect: "follow",
      });
      if (res.status === 404 || res.status === 403) return { status: res.status, body: null };
      if (res.status === 429) {
        const asked = Number(res.headers.get("retry-after")) * 1000;
        const wait = Math.min(asked > 0 ? asked : holdStep, 30_000);
        if (Date.now() + wait > holdUntil) holdUntil = Date.now() + wait;
        holdStep = Math.min(holdStep * 1.5, 20_000);
        throw new Error("respondió 429");
      }
      if (!res.ok) throw new Error(`respondió ${res.status}`);
      holdStep = Math.max(2_000, holdStep * 0.9);
      return { status: res.status, body: await res.json() };
    } catch (error) {
      last = error;
      await sleep(400 * (attempt + 1));
    }
  }
  throw last;
}

async function getText(url, timeout = 20_000) {
  const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(timeout) });
  if (!res.ok) throw new Error(`respondió ${res.status}`);
  return res.text();
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function mapPool(items, limit, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      out[index] = await fn(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

// ---------- universo ----------

async function loadUniverse(config) {
  const reserve = JSON.parse(await readFile(path.join(ROOT, "scanner", "universe.json"), "utf8"));
  const names = new Map();
  const kinds = new Map();
  let sp500 = reserve.sp500;
  let fresh = false;
  if (!FIXTURES) {
    try {
      const csv = await getText(SP500_CSV);
      const rows = csv.split(/\r?\n/).slice(1).map(parseCsvLine).filter((row) => row[0]);
      if (rows.length >= 450) {
        sp500 = rows.map((row) => row[0]);
        for (const row of rows) if (row[1]) names.set(row[0], row[1]);
        fresh = true;
      }
    } catch {
      /* se usa la lista de reserva */
    }
  }
  for (const [symbol, name] of Object.entries(reserve.etf)) {
    names.set(symbol, name);
    kinds.set(symbol, "etf");
  }
  const symbols = [];
  // En modo público el barrido es el mismo para cualquiera: los nombres que alguien
  // añada por su cuenta no entran, porque su sola presencia los delataría.
  const own = PUBLIC ? [] : [...config.favorites, ...config.extra];
  for (const raw of [...own, ...Object.keys(reserve.etf), ...sp500, ...reserve.ndx]) {
    const symbol = cleanSymbol(raw);
    if (symbol && !symbols.includes(symbol)) symbols.push(symbol);
  }
  return { symbols, names, kinds, fresh };
}

function parseCsvLine(line) {
  const out = [];
  let cell = "";
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (ch === "," && !quoted) {
      out.push(cell.trim());
      cell = "";
    } else cell += ch;
  }
  out.push(cell.trim());
  return out;
}

// ---------- cadena de CBOE ----------

async function fetchChain(symbol) {
  if (FIXTURES) {
    const file = path.join(FIXTURES, `${symbol}.json`);
    if (!existsSync(file)) return null;
    return JSON.parse(await readFile(file, "utf8"));
  }
  const variants = symbol.includes(".") ? [symbol, symbol.replace(".", "")] : [symbol];
  for (const variant of variants) {
    const res = await getJson(cboeUrl(variant));
    if (res.body) return res.body;
  }
  return null;
}

export const readChain = readCboeChain;

// ---------- resultados ----------

function sessionLabel(raw) {
  const hour = Number(String(raw ?? "").slice(0, 2));
  if (Number.isFinite(hour) && hour >= 16) return "después del cierre";
  if (Number.isFinite(hour) && hour > 0 && hour < 12) return "antes de la apertura";
  return "hora sin confirmar";
}

async function fetchEarnings(symbol, today) {
  const res = await getJson(
    `https://stockanalysis.com/api/symbol/s/${encodeURIComponent(symbol.toLowerCase())}/earnings`,
    { Referer: "https://stockanalysis.com/" },
    12_000,
    2,
  );
  if (res.status === 403) throw new Error("respondió 403");
  const rows = Array.isArray(res.body?.data) ? res.body.data : [];
  let next = null;
  for (const row of rows) {
    const date = typeof row?.date === "string" ? row.date : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < today) continue;
    if (!next || date < next.date) next = row;
  }
  if (!next) return { d: null, x: "" };
  const confirmed = next.confirmed === true ? "fecha confirmada" : "fecha estimada";
  return { d: next.date, x: `${sessionLabel(next.time)}, ${confirmed}` };
}

async function refreshEarnings(symbols, kinds, state, today) {
  if (FIXTURES) {
    const file = path.join(FIXTURES, "_earnings.json");
    if (existsSync(file)) {
      const rows = JSON.parse(await readFile(file, "utf8"));
      for (const [symbol, d] of Object.entries(rows)) state.earn[symbol] = { at: today, d, x: "fecha estimada" };
    }
    return { asked: 0, failed: 0 };
  }
  const due = symbols.filter((symbol) => {
    if (kinds.get(symbol) === "etf") return false;
    const hit = state.earn[symbol];
    if (!hit) return true;
    if (hit.d && hit.d < today) return true;
    return daysBetween(hit.at, today) >= EARN_TTL_DAYS;
  });
  const batch = due.slice(0, EARN_BUDGET);
  let failed = 0;
  await mapPool(batch, 4, async (symbol) => {
    try {
      const hit = await fetchEarnings(symbol, today);
      state.earn[symbol] = { at: today, ...hit };
    } catch {
      failed++;
    }
  });
  return { asked: batch.length, failed };
}

// ---------- estado entre barridos ----------

const emptyState = () => ({ v: 1, primed: false, fav: {}, top: [], sent: {}, earn: {}, log: [] });

async function loadPrev(name, fallback) {
  const local = path.join(DATA, name);
  if (args["prev-url"]) {
    const url = `${String(args["prev-url"]).replace(/\/$/, "")}/data/${name}?t=${Date.now()}`;
    const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20_000) });
    if (res.status === 404) return fallback;
    if (!res.ok) throw new Error(`No pude leer el estado anterior (${name}: ${res.status}). No sobrescribo.`);
    return res.json();
  }
  if (existsSync(local)) {
    try {
      return JSON.parse(await readFile(local, "utf8"));
    } catch {
      return fallback;
    }
  }
  return fallback;
}

async function writeJson(file, value) {
  const tmp = `${file}.tmp`;
  await writeFile(tmp, JSON.stringify(value));
  await rename(tmp, file);
}

/** Reglas y favoritos. En modo público salen del secreto CENTINELA_CONFIG;
 *  sin secreto no hay nada personal: ni favoritos ni avisos. */
async function loadConfig() {
  if (PUBLIC) {
    const raw = process.env.CENTINELA_CONFIG;
    if (!raw) return { config: normalizeConfig({ favorites: [], extra: [] }), personal: false };
    try {
      return { config: normalizeConfig(JSON.parse(raw)), personal: true };
    } catch {
      log("El secreto CENTINELA_CONFIG no es un JSON válido: barrido sin avisos.");
      return { config: normalizeConfig({ favorites: [], extra: [] }), personal: false };
    }
  }
  try {
    return { config: normalizeConfig(JSON.parse(await readFile(CONFIG_PATH, "utf8"))), personal: true };
  } catch {
    return { config: normalizeConfig({}), personal: true };
  }
}

// Estado privado de los avisos (qué favorito cumplía, qué se avisó hoy), cifrado.
// La clave sale de NTFY_TOPIC con scrypt, para que probar nombres a ciegas sea lento.
// El texto se rellena hasta un tamaño fijo: el archivo no delata cuántos favoritos hay.
let keyCache = null;
const privateKey = () => {
  const topic = process.env.NTFY_TOPIC;
  if (!topic) return null;
  if (keyCache?.topic !== topic) keyCache = { topic, key: scryptSync(topic, "centinela:v2", 32, { N: 1 << 15, r: 8, p: 1, maxmem: 128 * 1024 * 1024 }) };
  return keyCache.key;
};
const emptyPrivate = () => ({ primed: false, fav: {}, top: [], sent: {} });
const PRIVATE_BLOCK = 4096;

function sealPrivate(value) {
  const key = privateKey();
  if (!key) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plain = Buffer.from(JSON.stringify(value), "utf8");
  const padded = Buffer.alloc(Math.ceil((plain.length + 1) / PRIVATE_BLOCK) * PRIVATE_BLOCK, " ");
  plain.copy(padded);
  const data = Buffer.concat([cipher.update(padded), cipher.final()]);
  return { v: 2, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64") };
}

function openPrivate(box) {
  const key = privateKey();
  if (!key || !box?.data) return emptyPrivate();
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(box.iv, "base64"));
    decipher.setAuthTag(Buffer.from(box.tag, "base64"));
    const text = Buffer.concat([decipher.update(Buffer.from(box.data, "base64")), decipher.final()]).toString("utf8");
    return { ...emptyPrivate(), ...JSON.parse(text) };
  } catch {
    return emptyPrivate(); // cambió la clave: se empieza de cero, sin avisar en este barrido
  }
}

// ---------- avisos ----------

function marketOpenNow(now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
      .formatToParts(now)
      .map((part) => [part.type, part.value]),
  );
  if (parts.weekday === "Sat" || parts.weekday === "Sun") return false;
  const minutes = (Number(parts.hour) % 24) * 60 + Number(parts.minute);
  return minutes >= 9 * 60 + 40 && minutes <= 16 * 60 + 30;
}

function buildAlerts(config, symbols, state, today, commit) {
  const born = [];
  const { rows, bySymbol } = rankUniverse(symbols, config.rules, config.order, today);
  const keyOf = (sp) => `${sp.expiry}:${sp.shortStrike}/${sp.longStrike}`;

  const fav = {};
  for (const symbol of config.favorites) {
    const res = bySymbol.get(symbol);
    if (!res) continue;
    const now = res.status === "entrada" ? keyOf(res.best) : "no";
    const before = state.fav[symbol];
    fav[symbol] = now;
    if (!state.primed || !config.alerts.favorites) continue;
    if (now !== "no" && (before == null || before === "no")) {
      born.push({ s: symbol, kind: "favorito", title: `${symbol} ya cumple`, text: alertText(res.best) });
    }
  }

  const topN = config.alerts.universeTop;
  const top = rows.slice(0, topN).map((row) => row.sym.s);
  if (state.primed && topN > 0) {
    for (const row of rows.slice(0, topN)) {
      const symbol = row.sym.s;
      if (state.top.includes(symbol) || config.favorites.includes(symbol)) continue;
      born.push({
        s: symbol,
        kind: "universo",
        title: `${symbol} entra entre los ${topN} primeros`,
        text: alertText(row.res.best),
      });
    }
  }

  // Con el mercado cerrado no se toca el estado: el cambio se detecta
  // (y se avisa) en el primer barrido con mercado abierto.
  if (!commit && state.primed) return { alerts: [], passing: rows.length };

  // Un aviso por nombre y día, para que un valor que entra y sale no repita.
  const fresh = born.filter((alert) => state.sent[alert.s] !== today);
  for (const alert of fresh) state.sent[alert.s] = today;
  for (const symbol of Object.keys(state.sent)) if (state.sent[symbol] !== today) delete state.sent[symbol];

  state.fav = fav;
  state.top = top;
  state.primed = true;
  return { alerts: fresh, passing: rows.length };
}

async function pushAlerts(alerts) {
  const topic = process.env.NTFY_TOPIC;
  if (!topic || !alerts.length) return { sent: 0, configured: Boolean(topic) };
  const server = (process.env.NTFY_SERVER || "https://ntfy.sh").replace(/\/$/, "");
  const click = process.env.APP_URL || undefined;
  let sent = 0;
  const list =
    alerts.length > 6
      ? [
          {
            title: `${alerts.length} avisos de Centinela`,
            text: alerts.map((alert) => alert.title).join("\n"),
          },
        ]
      : alerts;
  for (const alert of list) {
    try {
      const res = await fetch(server, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, title: alert.title, message: alert.text, click, tags: ["chart_with_upwards_trend"] }),
        signal: AbortSignal.timeout(15_000),
      });
      if (res.ok) sent++;
    } catch {
      /* un aviso que no sale no tumba el barrido */
    }
  }
  return { sent, configured: true };
}

// ---------- barrido ----------

let scanning = null;

export async function scanOnce({ force = false } = {}) {
  if (scanning) return scanning;
  scanning = (async () => {
    const started = Date.now();
    await mkdir(DATA, { recursive: true });
    const today = nyToday();
    const { config, personal } = await loadConfig();
    const state = { ...emptyState(), ...(await loadPrev("state.json", emptyState())) };
    if (PUBLIC) Object.assign(state, openPrivate(await loadPrev("privado.json", null)), { log: [] });
    const canAlert = !PUBLIC || (personal && Boolean(privateKey()));
    const ivHist = await loadPrev("iv.json", { dates: [], s: {} });

    const universe = await loadUniverse(config);
    let list = universe.symbols;
    if (FAST) {
      const fast = JSON.parse(await readFile(path.join(ROOT, "scanner", "rapida.json"), "utf8"));
      const wanted = new Set(Object.values(fast.bloques ?? {}).flat().map(cleanSymbol).filter(Boolean));
      list = [...wanted];
    }
    if (args.limit) list = list.slice(0, Number(args.limit));
    log(`${FAST ? "Lista rápida" : "Barrido"} de ${list.length} nombres${universe.fresh ? "" : " (lista de reserva)"}`);

    // Motivo de cada nombre sin lectura, para poder ver qué pasa desde la app.
    const why = new Map();
    const deadline = started + 13 * 60_000;
    const readOne = async (symbol) => {
      if (Date.now() > deadline) {
        if (!why.has(symbol)) why.set(symbol, "sin tiempo");
        return null;
      }
      try {
        const body = await fetchChain(symbol);
        const sym = body ? readChain(symbol, body, today) : null;
        if (!sym) {
          why.set(symbol, body ? "cadena sin puts útiles" : "CBOE no tiene ese símbolo");
          return null;
        }
        sym.n = universe.names.get(symbol) ?? symbol;
        if (universe.kinds.get(symbol) === "etf") sym.k = "etf";
        why.delete(symbol);
        return sym;
      } catch (error) {
        const code = error?.cause?.code ?? error?.name;
        why.set(symbol, String(error?.message ?? error).slice(0, 60) + (code ? ` (${code})` : ""));
        return null;
      }
    };
    // Cada barrido empieza por un punto distinto de la lista: si no da tiempo a todo,
    // no se quedan siempre fuera los mismos nombres.
    const shift = FIXTURES ? 0 : (Math.floor(started / (30 * 60_000)) * 97) % list.length;
    const turn = [...list.keys()].map((index) => (index + shift) % list.length);
    const read = new Array(list.length).fill(null);
    await mapPool(turn, FIXTURES ? 16 : 4, async (index) => {
      read[index] = await readOne(list[index]);
    });
    // Repesca: CBOE corta a ratos cuando se le pide mucho seguido. Se vuelve a pedir más despacio.
    for (const [pause, pool] of FIXTURES ? [] : [[10_000, 2], [20_000, 1]]) {
      const pending = list.map((symbol, index) => ({ symbol, index })).filter(({ index }) => !read[index]);
      if (!pending.length) break;
      log(`Repesca de ${pending.length} nombres`);
      await sleep(pause);
      await mapPool(pending, pool, async ({ symbol, index }) => {
        read[index] = await readOne(symbol);
        if (pool === 1) await sleep(150);
      });
    }
    const reasons = {};
    for (const reason of why.values()) reasons[reason] = (reasons[reason] ?? 0) + 1;
    // Un nombre que hoy no se ha podido leer conserva los datos del barrido anterior
    // (como mucho de hace tres horas), marcado con la hora de esos datos.
    const kept = [];
    if (why.size && !FIXTURES) {
      const before = await loadPrev(OUT_FILE, null).catch(() => null);
      const old = new Map((before?.symbols ?? []).map((sym) => [sym.s, sym]));
      list.forEach((symbol, index) => {
        if (read[index]) return;
        const sym = old.get(symbol);
        const from = sym?.old ?? before?.at;
        if (!sym || !from || started - from > 3 * 3600_000) return;
        read[index] = { ...sym, old: from };
        kept.push(symbol);
        why.delete(symbol);
      });
    }
    const failures = [...why.keys()];
    // Por orden alfabético, para que el archivo publicado no delate qué nombres son favoritos.
    const symbols = read.filter(Boolean).sort((a, b) => a.s.localeCompare(b.s));
    if (!symbols.length) throw new Error(`Ningún nombre respondió. No sobrescribo el barrido anterior. Motivos: ${JSON.stringify(reasons)}`);

    const earn = await refreshEarnings(
      symbols.map((sym) => sym.s),
      universe.kinds,
      state,
      today,
    );
    for (const sym of symbols) {
      const hit = state.earn[sym.s];
      sym.er = hit && hit.d && hit.d >= today ? { d: hit.d, x: hit.x } : null;
    }

    // IV diaria por nombre, para tener historia propia. La anota el barrido completo.
    const dates = ivHist.dates ?? [];
    let col = dates.indexOf(today);
    if (col < 0) {
      dates.push(today);
      col = dates.length - 1;
    }
    for (const sym of FAST ? [] : symbols) {
      if (sym.iv30 == null) continue;
      const serie = ivHist.s[sym.s] ?? [];
      while (serie.length < col) serie.push(null);
      serie[col] = sym.iv30;
      ivHist.s[sym.s] = serie;
    }
    if (dates.length > IV_DAYS) {
      const cut = dates.length - IV_DAYS;
      dates.splice(0, cut);
      for (const key of Object.keys(ivHist.s)) ivHist.s[key].splice(0, cut);
    }
    ivHist.dates = dates;

    // Los avisos miran siempre el universo entero: en la lista rápida, el último barrido
    // completo con los nombres recién leídos puestos encima.
    let seen = symbols;
    if (FAST) {
      const full = await loadPrev("scan.json", null).catch(() => null);
      const fresh = new Map(symbols.map((sym) => [sym.s, sym]));
      seen = [...(full?.symbols ?? []).filter((sym) => !fresh.has(sym.s)), ...symbols];
    }
    const open = force || FIXTURES ? true : marketOpenNow();
    const { alerts: live, passing } = canAlert ? buildAlerts(config, seen, state, today, open) : { alerts: [], passing: 0 };
    const pushed = await pushAlerts(live);
    const at = Date.now();
    state.log = [...live.map((alert) => ({ at, ...alert })), ...(state.log ?? [])].slice(0, 80);

    const scan = {
      v: 1,
      at,
      today,
      source: FIXTURES ? "Datos de ejemplo" : "CBOE, con 15 minutos de retraso",
      example: Boolean(FIXTURES),
      failed: failures.sort(),
      kept: kept.sort(),
      why: reasons,
      earnings: earn,
      push: PUBLIC ? canAlert : pushed.configured,
      symbols,
    };
    await writeJson(path.join(DATA, OUT_FILE), scan);
    if (!FAST) await writeJson(path.join(DATA, "iv.json"), ivHist);
    // Hora de cada archivo, para que la app solo descargue el que ha cambiado.
    const version = { scan: 0, rapido: 0, ...(await loadPrev("version.json", {}).catch(() => ({}))) };
    version[FAST ? "rapido" : "scan"] = at;
    // Si falta la hora del otro archivo (primer barrido tras estrenar esto), se toma del propio archivo.
    const other = FAST ? "scan" : "rapido";
    if (!(Number(version[other]) > 0)) version[other] = (await loadPrev(`${other}.json`, null).catch(() => null))?.at ?? 0;
    await writeJson(path.join(DATA, "version.json"), { scan: Number(version.scan) || 0, rapido: Number(version.rapido) || 0 });
    if (PUBLIC) {
      // Público: solo lo genérico en claro; lo de los avisos, cifrado.
      await writeJson(path.join(DATA, "state.json"), { v: 1, earn: state.earn });
      const box = canAlert ? sealPrivate({ primed: state.primed, fav: state.fav, top: state.top, sent: state.sent }) : null;
      if (box) await writeJson(path.join(DATA, "privado.json"), box);
    } else {
      await writeJson(path.join(DATA, "state.json"), state);
      await writeJson(path.join(DATA, "alerts.json"), { at, log: state.log });
      await writeJson(path.join(DATA, "config.json"), config);
    }

    const secs = ((Date.now() - started) / 1000).toFixed(0);
    // El registro de un repositorio público lo puede leer cualquiera: sin cifras personales.
    log(
      PUBLIC
        ? `Leídos ${symbols.length}, sin lectura ${failures.length}, avisos ${canAlert ? "activos" : "sin configurar"}, ${secs}s${open ? "" : " · mercado cerrado"}`
        : `Leídos ${symbols.length}, sin lectura ${failures.length}, cumplen ${passing}, avisos ${live.length}` +
            ` (enviados ${pushed.sent}), ${secs}s${open ? "" : " · mercado cerrado: sin avisos"}`,
    );
    if (process.env.GITHUB_ACTIONS) console.log(`::notice title=${FAST ? "Lista rápida" : "Barrido"}::Leídos ${symbols.length - kept.length}, del barrido anterior ${kept.length}, sin lectura ${failures.length}, ${secs}s. Motivos: ${JSON.stringify(reasons)}`);
    if (failures.length) log(`Motivos: ${JSON.stringify(reasons)}`);
    if (failures.length) log(`Sin lectura: ${failures.slice(0, 30).join(" ")}${failures.length > 30 ? " …" : ""}`);
    return { symbols: symbols.length, failures: failures.length, passing, alerts: live.length };
  })();
  try {
    return await scanning;
  } finally {
    scanning = null;
  }
}

// ---------- modo ordenador ----------

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

function serve(port) {
  const web = path.join(ROOT, "web");
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://x");
      const send = (code, body, type = "application/json; charset=utf-8") => {
        res.writeHead(code, { "Content-Type": type, "Cache-Control": "no-store" });
        res.end(body);
      };
      if (url.pathname === "/api/ping") return send(200, JSON.stringify({ ok: true, mode: "ordenador" }));
      if (url.pathname === "/api/config" && req.method === "GET") return send(200, JSON.stringify((await loadConfig()).config));
      if (url.pathname === "/api/config" && req.method === "POST") {
        let raw = "";
        for await (const chunk of req) {
          raw += chunk;
          if (raw.length > 200_000) return send(413, JSON.stringify({ ok: false }));
        }
        const config = normalizeConfig(JSON.parse(raw));
        config.savedAt = Date.now();
        await writeFile(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`);
        await mkdir(DATA, { recursive: true });
        await writeJson(path.join(DATA, "config.json"), config);
        return send(200, JSON.stringify({ ok: true, savedAt: config.savedAt }));
      }
      if (url.pathname === "/api/scan" && req.method === "POST") {
        scanOnce({ force: true }).catch((error) => log("Barrido fallido:", error.message));
        return send(202, JSON.stringify({ ok: true }));
      }
      const rel = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
      const base = rel.startsWith("/data/") ? OUT : web;
      const file = path.normalize(path.join(base, rel));
      if (!file.startsWith(base) || !existsSync(file)) return send(404, "No encontrado", "text/plain; charset=utf-8");
      return send(200, await readFile(file), MIME[path.extname(file)] ?? "application/octet-stream");
    } catch (error) {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(String(error?.message ?? error));
    }
  });
  server.listen(port, "0.0.0.0", () => {
    log(`Centinela en este ordenador: http://localhost:${port}`);
    for (const list of Object.values(os.networkInterfaces())) {
      for (const net of list ?? []) {
        if (net.family === "IPv4" && !net.internal) log(`Desde el móvil, con el mismo Wi-Fi: http://${net.address}:${port}`);
      }
    }
  });
}

async function main() {
  if (args.serve) {
    const port = Number(args.port ?? 8080);
    const every = Math.max(5, Number(args.every ?? 30));
    serve(port);
    const tick = async () => {
      if (!FIXTURES && !marketOpenNow() && existsSync(path.join(DATA, "scan.json"))) return;
      try {
        await scanOnce();
      } catch (error) {
        log("Barrido fallido:", error.message);
      }
    };
    if (existsSync(path.join(DATA, "scan.json"))) log("Hay un barrido guardado; el siguiente saldrá con el mercado abierto.");
    else await scanOnce({ force: false }).catch((error) => log("Barrido fallido:", error.message));
    setInterval(tick, every * 60_000);
    return;
  }
  try {
    await scanOnce();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
