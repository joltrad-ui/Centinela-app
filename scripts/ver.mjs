#!/usr/bin/env node
// Mirar la app como la vería un móvil, sin escribir un script cada vez. Imprime poco: errores, desbordes y lo que pidas medir.
//
//   node scripts/ver.mjs --pestana Buscador --clic '[data-bs=filters-open]' --medir '.fi-f' --texto '#bs-bar'
//
// Opciones (las repetibles se pueden poner varias veces, y se aplican en el orden dado):
//   --ancho 360,390        anchos de pantalla (por defecto 360 y 390)
//   --pestana Nombre       Hoy | Buscador | Avisos | Mis deals | Reglas
//   --clic SEL             hacer clic en SEL (la primera coincidencia)
//   --escribir SEL=texto   escribir en un campo
//   --barra SEL=valor      mover una barra (input range) y soltarla
//   --esperar ms           esperar (por defecto 300 tras cada paso)
//   --medir SEL            alto × ancho y texto corto de cada elemento que coincida (máx. 40)
//   --texto SEL            el texto completo del primer elemento que coincida
//   --contar SEL           cuántos elementos coinciden
//   --url URL              otra dirección (por defecto http://localhost:8080; si no responde, arranca la de ejemplo)
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CHROMIUM, findPlaywright } from "./playwright.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const opts = { ancho: "360,390", url: "http://localhost:8080", pasos: [] };
for (let i = 0; i < args.length; i++) {
  const key = args[i].replace(/^--/, "");
  const value = args[++i];
  if (["clic", "escribir", "barra", "esperar", "medir", "texto", "contar", "pestana"].includes(key)) opts.pasos.push([key, value]);
  else if (key in opts) opts[key] = value;
  else {
    console.error(`Opción desconocida: --${key}`);
    process.exit(2);
  }
}

const playwright = findPlaywright();
if (!playwright) {
  console.error("No hay Playwright. Instálalo en global (npm i -g playwright) o en el proyecto con --no-save.");
  process.exit(2);
}
try {
  const res = await fetch(`${opts.url}/api/ping`, { signal: AbortSignal.timeout(2000) });
  if (!res.ok) throw new Error();
} catch {
  if (opts.url !== "http://localhost:8080") {
    console.error(`No responde ${opts.url}`);
    process.exit(2);
  }
  console.error("Arrancando la app de ejemplo…");
  execFileSync("bash", [path.join(ROOT, "scripts/ejemplo-fondo.sh")], { stdio: ["ignore", "inherit", "inherit"] });
}

const short = (text, n = 70) => String(text).replace(/\s+/g, " ").trim().slice(0, n);
const browser = await playwright.chromium.launch({ executablePath: CHROMIUM, args: ["--no-sandbox"] });
let failed = false;
for (const width of opts.ancho.split(",").map(Number)) {
  const page = await browser.newPage({ viewport: { width, height: 800 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(opts.url);
  await page.waitForSelector(".hoy-grid, .stats, .empty", { timeout: 15000 });
  const lines = [];
  for (const [kind, value] of opts.pasos) {
    try {
      if (kind === "pestana") await page.getByRole("button", { name: new RegExp(value) }).last().click();
      else if (kind === "clic") await page.locator(value).first().click({ timeout: 5000 });
      else if (kind === "escribir") {
        const at = value.indexOf("=");
        await page.fill(value.slice(0, at), value.slice(at + 1));
      } else if (kind === "barra") {
        const at = value.lastIndexOf("=");
        await page.$eval(value.slice(0, at), (e, v) => {
          e.value = v;
          e.dispatchEvent(new Event("input", { bubbles: true }));
          e.dispatchEvent(new Event("change", { bubbles: true }));
        }, value.slice(at + 1));
      } else if (kind === "esperar") {
        await page.waitForTimeout(Number(value));
        continue;
      } else if (kind === "medir") {
        const rows = await page.$$eval(value, (els) => els.slice(0, 40).map((e) => { const r = e.getBoundingClientRect(); return `${Math.round(r.height)}×${Math.round(r.width)}  ${e.innerText}`; }));
        lines.push(`medir ${value}: ${rows.length ? "" : "(nada)"}`, ...rows.map((r) => `  ${short(r, 100)}`));
      } else if (kind === "texto") lines.push(`texto ${value}: ${short(await page.locator(value).first().innerText(), 400)}`);
      else if (kind === "contar") lines.push(`contar ${value}: ${await page.locator(value).count()}`);
    } catch (error) {
      lines.push(`✗ ${kind} ${value}: ${short(error.message, 120)}`);
      failed = true;
    }
    await page.waitForTimeout(300);
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  console.log(`── ${width} px · ${overflow ? "DESBORDA" : "sin desborde"} · ${errors.length ? `${errors.length} errores: ${short(errors.join(" | "), 200)}` : "sin errores"}`);
  for (const line of lines) console.log(line);
  if (overflow || errors.length) failed = true;
  await page.close();
}
await browser.close();
process.exit(failed ? 1 : 0);
