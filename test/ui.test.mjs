// Pruebas de las pantallas con un navegador de verdad (Playwright + Chromium) y los datos de ejemplo.
// Si no hay Playwright o Chromium en la máquina, se saltan (no rompen `npm test`).
// Arranca su propio servidor de ejemplo en otro puerto y deja `config.json` como estaba.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 8137;
const BASE = `http://localhost:${PORT}/`;
const CONFIG = path.join(ROOT, "config.json");

function findPlaywright() {
  const require = createRequire(import.meta.url);
  const roots = [undefined];
  try {
    roots.push(execFileSync("npm", ["root", "-g"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim());
  } catch {}
  for (const root of roots) {
    try {
      return require(root ? path.join(root, "playwright") : "playwright");
    } catch {}
  }
  return null;
}
const CHROMIUM = [process.env.CHROMIUM_PATH, "/opt/pw-browsers/chromium"].find((p) => p && existsSync(p));
const playwright = findPlaywright();
const skip = !playwright ? "no hay Playwright" : false;

let server, browser, out, configBackup;

before(async () => {
  if (skip) return;
  configBackup = readFileSync(CONFIG, "utf8");
  out = mkdtempSync(path.join(os.tmpdir(), "centinela-ui-"));
  const run = (args) => execFileSync("node", args, { cwd: ROOT, stdio: "ignore" });
  run(["test/make-fixtures.mjs"]);
  run(["scanner/cierres.mjs", "--fixtures", "test/fixtures", "--out", out]);
  server = spawn("node", ["scanner/scan.mjs", "--serve", "--fixtures", "test/fixtures", "--out", out, "--port", String(PORT)], { cwd: ROOT, stdio: "ignore" });
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${BASE}api/ping`)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  browser = await playwright.chromium.launch({ executablePath: CHROMIUM, args: ["--no-sandbox"] });
});

after(async () => {
  await browser?.close();
  server?.kill();
  if (configBackup != null) writeFileSync(CONFIG, configBackup);
  if (out) rmSync(out, { recursive: true, force: true });
});

/** Abre la app con un ancho de móvil y recoge los errores de consola. */
async function open(width) {
  const page = await browser.newPage({ viewport: { width, height: 800 } });
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && page.errors.push(m.text()));
  await page.goto(BASE);
  await page.waitForSelector(".hoy-grid, .empty, .stats", { timeout: 15000 });
  return page;
}
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const goTab = async (page, name) => {
  await page.getByRole("button", { name: new RegExp(name) }).last().click();
  await page.waitForTimeout(400);
};
const labels = (page, selector) => page.$$eval(selector, (els) => els.map((e) => e.innerText.trim()).filter((t) => /hasta|^Nivel$/.test(t)));
const ORDER = ["Nivel", "Vence hasta", "Ancho hasta", "Prob. hasta"];

for (const width of [360, 390]) {
  test(`${width} px: ninguna pantalla desborda ni da errores`, { skip }, async () => {
    const page = await open(width);
    for (const tab of ["Hoy", "Buscador", "Avisos", "Reglas"]) {
      await goTab(page, tab);
      assert.ok(await noOverflow(page), `${tab} desborda a ${width} px`);
    }
    for (const view of ["nube", "barras", "mis", "mapa"]) {
      await goTab(page, "Hoy");
      await page.locator(`[data-hoy="view"][data-v="${view}"]`).click();
      await page.waitForTimeout(300);
      assert.ok(await noOverflow(page), `Hoy/${view} desborda a ${width} px`);
    }
    assert.deepEqual(page.errors, []);
    await page.close();
  });
}

test("el orden de los filtros es siempre Nivel, Vence, Ancho, Prob.", { skip }, async () => {
  const page = await open(390);
  const hoy = await labels(page, ".filters .hoy-lab");
  assert.deepEqual(hoy, ["Ancho hasta", "Prob. hasta"]);
  await goTab(page, "Buscador");
  assert.deepEqual(await labels(page, ".fi-filters .fi-f-l"), ORDER);
  await page.locator('[data-hoy="cell"]').first().click();
  await page.waitForSelector(".fi-deals .fi-f-l");
  assert.deepEqual(await labels(page, ".fi-deals .fi-f-l"), ORDER);
  assert.deepEqual(page.errors, []);
  await page.close();
});

test("Más filtros se comprime, se despliega y se recuerda", { skip }, async () => {
  const page = await open(390);
  const rows = () => page.locator('[data-hoy="price"]').count();
  assert.equal(await rows(), 0, "de fábrica va comprimido");
  await page.locator('[data-hoy="filters-open"]').click();
  assert.ok((await rows()) > 0);
  await page.reload();
  await page.waitForSelector(".filters");
  assert.ok((await rows()) > 0, "se recuerda abierto");
  await page.locator('[data-hoy="filters-open"]').click();
  assert.equal(await rows(), 0);
  await page.close();
});

test("el Buscador: barra de ancho filtra, vacío con botón y Quitar filtros", { skip }, async () => {
  const page = await open(390);
  await goTab(page, "Buscador");
  const count = async () => Number((await page.locator("#bs-bar").innerText()).match(/(\d+) deals?/)[1]);
  const total = await count();
  await page.$eval("#bs-w-range", (e) => {
    e.value = 300;
    e.dispatchEvent(new Event("input", { bubbles: true }));
    e.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.waitForTimeout(500);
  assert.ok((await count()) < total, "$300 debe dejar menos deals");
  const widths = await page.$$eval("#bs-list .fi-dr", (els) => els.map((e) => Number(e.innerText.match(/ancho \$(\d+)/)?.[1])));
  assert.ok(widths.length > 0 && widths.every((w) => w <= 300), `anchos fuera de la barra: ${widths}`);
  await page.fill("#bs-q", "zzzz");
  await page.waitForTimeout(300);
  assert.match(await page.locator("#bs-list .empty").innerText(), /Ningún deal con estos filtros/);
  await page.fill("#bs-q", "");
  await page.locator('[data-bs="filters-open"]').click();
  await page.locator('[data-bs="reset"]').click();
  await page.waitForTimeout(400);
  assert.equal(await count(), total);
  assert.deepEqual(page.errors, []);
  await page.close();
});

test("los recuentos de nivel ocupan una sola línea", { skip }, async () => {
  for (const width of [320, 360]) {
    const page = await open(width);
    for (const tab of ["Hoy", "Buscador"]) {
      await goTab(page, tab);
      const height = await page.locator(".stats").first().evaluate((e) => e.getBoundingClientRect().height);
      assert.ok(height < 26, `${tab} a ${width} px: recuentos de ${height} px`);
    }
    await page.close();
  }
});

test("estados vacíos con el mismo bloque y alturas de las tres escalas", { skip }, async () => {
  const page = await open(390);
  await page.locator('[data-hoy="view"][data-v="mis"]').click();
  assert.match(await page.locator(".empty h2").innerText(), /Todavía no has apuntado/);
  const heights = await page.evaluate(() => {
    const h = (s) => Math.round(document.querySelector(s)?.getBoundingClientRect().height ?? -1);
    return { btn: h(".btn"), quiet: h(".btn.quiet"), chip: h(".chip"), sort: h(".sortbar button") };
  });
  for (const [name, value] of Object.entries(heights)) assert.ok([-1, 32, 36, 44].includes(value), `${name} mide ${value}`);
  await page.close();
});

test("Reglas y Avisos: pasos, interruptores, avisos y restaurar funcionan", { skip }, async () => {
  const page = await open(390);
  await goTab(page, "Reglas");
  await page.locator('[data-act="reset"]').first().click(); // reglas de fábrica, sea cual sea la configuración guardada
  await page.waitForTimeout(300);
  const before = await page.locator("#app").innerText();
  await page.locator("[data-step]").first().click();
  await page.waitForTimeout(300);
  await page.locator("[data-rule-switch]").first().click();
  await page.waitForTimeout(300);
  assert.notEqual(await page.locator("#app").innerText(), before, "los controles de Reglas no cambian nada");
  await page.locator('[data-act="reset"]').first().click();
  await page.waitForTimeout(300);
  assert.equal(await page.locator("#app").innerText(), before, "Restaurar debe volver a las reglas de fábrica");
  await goTab(page, "Avisos");
  const alerts = page.locator("[data-alert]");
  if (await alerts.count()) {
    const was = await alerts.first().getAttribute("aria-checked");
    await alerts.first().click();
    await page.waitForTimeout(300);
    assert.notEqual(await page.locator("[data-alert]").first().getAttribute("aria-checked"), was);
  }
  assert.deepEqual(page.errors, []);
  await page.close();
});

test("Hoy: las barras de ancho y prob. cambian el contador", { skip }, async () => {
  const page = await open(390);
  const sum = async () => (await page.locator(".stats").first().innerText()).replace(/\s+/g, " ");
  const set = async (id, value) => {
    await page.$eval(`#${id}`, (e, v) => {
      e.value = v;
      e.dispatchEvent(new Event("input", { bubbles: true }));
      e.dispatchEvent(new Event("change", { bubbles: true }));
    }, value);
    await page.waitForTimeout(500);
  };
  const a = await sum();
  await set("hoy-w-range", 200);
  assert.equal(await page.locator("#hoy-w-range-val").innerText(), "$200");
  assert.notEqual(await sum(), a);
  await set("hoy-range", 30);
  assert.equal(await page.locator("#hoy-range-val").innerText(), "30 %");
  assert.deepEqual(page.errors, []);
  await page.close();
});
