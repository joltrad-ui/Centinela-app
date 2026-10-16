// Pruebas de las pantallas con un navegador de verdad (Playwright + Chromium) y los datos de ejemplo.
// Si no hay Playwright o Chromium en la máquina, se saltan (no rompen `npm test`).
// Arranca su propio servidor de ejemplo en otro puerto y deja `config.json` y `config.local.json` como estaban.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import http from "node:http";
import { existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CHROMIUM, findPlaywright } from "../scripts/playwright.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 8137;
const BASE = `http://localhost:${PORT}/`;
const CONFIG = path.join(ROOT, "config.json");
const LOCAL = path.join(ROOT, "config.local.json");

const playwright = findPlaywright();
const skip = !playwright ? "no hay Playwright" : false;
if (skip && process.env.PRUEBAS_EXIGENTES) throw new Error("PRUEBAS_EXIGENTES: falta Playwright, las pruebas de pantalla no pueden saltarse");

let server, browser, out, configBackup, localBackup;

before(async () => {
  if (skip) return;
  configBackup = readFileSync(CONFIG, "utf8");
  localBackup = existsSync(LOCAL) ? readFileSync(LOCAL, "utf8") : null;
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
  if (localBackup != null) writeFileSync(LOCAL, localBackup);
  else if (configBackup != null) rmSync(LOCAL, { force: true }); // lo que la prueba guardó, fuera
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
  const hoy = await labels(page, ".filters .fi-f-l");
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
  const count = async () => Number((await page.locator("#bs-bar").innerText()).match(/(\d+) de \d+ deals?/)[1]);
  const total = await count();
  await page.$eval("#bs-w-range", (e) => {
    e.value = 300;
    e.dispatchEvent(new Event("input", { bubbles: true }));
    e.dispatchEvent(new Event("change", { bubbles: true }));
  });
  // la lista se recalcula al soltar la barra: se espera a que todas las filas respeten el tope (en un equipo lento tarda más)
  const widthsNow = () => page.$$eval("#bs-list .fi-dr", (els) => els.map((e) => Number(e.innerText.match(/ancho \$(\d+)/)?.[1])));
  let widths = await widthsNow();
  for (let i = 0; i < 40 && !(widths.length > 0 && widths.every((w) => w <= 300)); i++) {
    await page.waitForTimeout(250);
    widths = await widthsNow();
  }
  assert.ok(widths.length > 0 && widths.every((w) => w <= 300), `anchos fuera de la barra: ${widths}`);
  assert.ok((await count()) <= total, "$300 no puede dejar más deals que sin tope");
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

test("Mis deals: apuntar a mano uno que ya tengo", { skip }, async () => {
  const page = await open(390);
  await page.locator('[data-hoy="view"][data-v="mis"]').click();
  await page.locator('[data-hoy="form-manual"]').click();
  await page.locator('[data-hoy-form="manual"] button[type=submit]').click();
  assert.match(await page.locator('[data-hoy-form="manual"] [role=alert]').innerText(), /símbolo/);
  await page.fill("#hoy-m-s", "aapl");
  await page.fill("#hoy-m-e", "2099-01-15");
  await page.fill("#hoy-m-k", "100");
  await page.fill("#hoy-m-l", "95");
  await page.fill("#hoy-m-c", "6"); // más que el ancho: debe rechazarlo
  await page.locator('[data-hoy-form="manual"] button[type=submit]').click();
  assert.match(await page.locator('[data-hoy-form="manual"] [role=alert]').innerText(), /crédito/);
  await page.fill("#hoy-m-c", "1,25");
  await page.locator('[data-hoy-form="manual"] button[type=submit]').click();
  const list = await page.locator(".dl-card").first().innerText();
  assert.match(list, /AAPL/);
  assert.match(list, /Pierdes máx\.\s*\$37\d/); // (5 − 1,25) × 100 más la comisión
  assert.match(list, /Prob\./);
  assert.equal(await page.locator(".dl-sort").count(), 0, "con un solo deal no hace falta ordenar");
  assert.deepEqual(page.errors, []);
  await page.close();
});

test("Mis deals: barra de orden y días en ámbar cuando quedan 7 o menos", { skip }, async () => {
  const page = await open(390);
  await page.evaluate(() => {
    const d = (id, s, days, credit) => ({ id, s, b: "", expiry: new Date(Date.now() + days * 864e5).toISOString().slice(0, 10), short: 100, long: 95, credit, qty: 1, fee: 0, openedAt: Date.now(), level: null, retExp: null, price0: null, closedAt: null, result: null, manual: true });
    localStorage.setItem("centinela.misdeals.v1", JSON.stringify([d("a", "ZZA", 30, 1), d("b", "ZZB", 5, 2), d("c", "ZZC", 12, 0.5)]));
  });
  await page.reload();
  await page.locator('[data-hoy="view"][data-v="mis"]').click();
  const order = async () => (await page.locator(".dl-sym").allInnerTexts()).join(",");
  await page.locator('[data-hoy="msort"][data-v="dias"]').click();
  assert.equal(await order(), "ZZB,ZZC,ZZA");
  await page.locator('[data-hoy="msort"][data-v="perdida"]').click();
  assert.equal(await order(), "ZZC,ZZA,ZZB", "más pérdida máx. primero");
  const color = (n) => page.locator(".dl-days").nth(n).evaluate((e) => getComputedStyle(e).color);
  await page.locator('[data-hoy="msort"][data-v="dias"]').click();
  assert.notEqual(await color(0), await color(1), "5 días lleva otro color que 12");
  assert.equal(await color(1), await color(2));
  assert.deepEqual(page.errors, []);
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
  await set("hoy-pr-range", 30);
  assert.equal(await page.locator("#hoy-pr-range-val").innerText(), "30 %");
  assert.deepEqual(page.errors, []);
  await page.close();
});

test("se abre en la última pestaña usada y avisa de que no hay conexión", { skip }, async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 800 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(BASE);
  await page.waitForSelector(".hoy-grid, .stats");
  await goTab(page, "Buscador");
  await page.reload();
  await page.waitForSelector("#bs-bar");
  assert.ok(await page.locator("#bs-bar").count(), "debe abrir en el Buscador");
  assert.equal(await page.locator(".notice.info").count(), 0);
  await context.setOffline(true);
  await page.waitForSelector(".notice.info");
  assert.match(await page.locator(".notice.info").innerText(), /Sin conexión: se enseña el último barrido guardado/);
  await context.setOffline(false);
  await page.waitForFunction(() => !document.querySelector(".notice.info"), null, { timeout: 15000 });
  assert.deepEqual(errors, []);
  await context.close();
});

test("Buscador: Margen y Las que tengo son barras de tres posiciones", { skip }, async () => {
  const page = await open(390);
  await goTab(page, "Buscador");
  await page.locator('[data-bs="filters-open"]').click();
  const count = async () => Number((await page.locator("#bs-bar").innerText()).match(/(\d+) de \d+ deals?/)[1]);
  const pick = async (act, value) => {
    await page.locator(`[data-bs="${act}"][data-v="${value}"]`).click();
    await page.waitForTimeout(400);
  };
  // incluir todos los niveles, para que "con" y "sin" margen sumen el total
  for (const l of [0, 1, 2]) await page.locator(`[data-bs="lv"][data-v="${l}"]`).click();
  await page.waitForTimeout(400);
  await page.locator('[data-bs="one"]').click(); // todos los deals, no uno por nombre
  await page.waitForTimeout(300);
  const all = await count();
  await pick("margin", "yes");
  const yes = await count();
  await pick("margin", "no");
  const no = await count();
  assert.ok(yes > 0 && no > 0, `con margen ${yes}, sin margen ${no}`);
  assert.equal(yes + no, all, "con margen + sin margen debe dar el total");
  assert.equal(await page.locator('[data-bs="margin"][aria-pressed="true"]').innerText(), "Sin");
  await pick("margin", "all");
  assert.equal(await count(), all);
  // Las que tengo: marcar una acción a mano, y Solo / Ocultar
  const mine = await page.locator('#bs-list [data-hoy="cell"]').first().getAttribute("data-s"); // un nombre que sí tiene deals
  await page.locator('[data-bs="names"]').click();
  await page.locator('[data-bs="mode"][data-v="tengo"]').click();
  await page.locator(`[data-bs="name"][data-v="${mine}"]`).click();
  await page.waitForTimeout(300);
  await page.locator('[data-bs="names"]').click();
  await pick("tengo", "only");
  const only = await count();
  await pick("tengo", "hide");
  const hidden = await count();
  assert.ok(only > 0 && hidden > 0 && only + hidden === all, `solo ${only}, ocultar ${hidden}, total ${all}`);
  await pick("tengo", "all");
  assert.match(await page.locator(".fhead").innerText(), /(\d+|ninguno) activos?/);
  assert.deepEqual(page.errors, []);
  await page.close();
});

test("privacidad: la app no pide nada fuera de este servidor y las fuentes son propias", { skip }, async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 800 } });
  const outside = [];
  page.on("request", (r) => {
    const url = new URL(r.url());
    if (!["localhost", "127.0.0.1"].includes(url.hostname) && url.protocol.startsWith("http")) outside.push(r.url());
  });
  await page.goto(BASE);
  await page.waitForSelector(".hoy-grid, .stats");
  for (const tab of ["Buscador", "Avisos", "Reglas", "Hoy"]) await goTab(page, tab);
  await page.evaluate(() => document.fonts.ready);
  assert.deepEqual(outside, [], "peticiones a otros sitios");
  const fonts = await page.evaluate(() => [document.fonts.check('500 16px "IBM Plex Sans"'), document.fonts.check('500 16px "Newsreader"'), [...document.fonts].filter((f) => f.status === "loaded").length]);
  assert.ok(fonts[0] && fonts[1] && fonts[2] >= 2, `fuentes propias sin cargar: ${fonts}`);
  await page.close();
});

test("privacidad: el servidor de ejemplo rechaza otros nombres de host y orígenes", { skip }, async () => {
  // `fetch` no deja cambiar la cabecera Host: se usa http a mano
  const call = (headers, method = "GET", body) =>
    new Promise((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port: PORT, path: "/api/config", method, headers }, (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode));
      });
      req.on("error", reject);
      req.end(body);
    });
  assert.equal(await call({ Host: "evil.example.com" }), 403, "otro nombre de host");
  assert.equal(await call({ Host: `localhost:${PORT}`, Origin: "https://evil.example.com", "Content-Type": "application/json" }, "POST", "{}"), 403, "origen de otra página");
  assert.equal(await call({ Host: `localhost:${PORT}` }), 200);
});

test("Buscador sin resultados: dice qué filtro quitar y cuántos saldrían", { skip }, async () => {
  const page = await open(390);
  await goTab(page, "Buscador");
  await page.fill("#bs-q", "zzzz");
  await page.waitForTimeout(300);
  const empty = page.locator("#bs-list .empty");
  assert.match(await empty.innerText(), /Ningún deal con estos filtros/);
  // con la búsqueda sin resultados, quitar solo la búsqueda es la única salida que devuelve algo
  const first = empty.locator('[data-bs="drop"]').first();
  assert.match(await first.innerText(), /Quitar la búsqueda · saldrían \d+/);
  const promised = Number((await first.innerText()).match(/saldrían (\d+)/)[1]);
  await first.click();
  await page.waitForTimeout(400);
  assert.equal(await page.locator("#bs-q").inputValue(), "");
  assert.equal(await page.locator("#bs-list .empty").count(), 0);
  const shown = Number((await page.locator("#bs-bar").innerText()).match(/(\d+) de \d+ deals?/)[1]);
  assert.equal(shown, promised, "el número prometido debe ser el que sale");
  // y con un filtro de menos, el botón de quitar todos sigue ahí
  await page.fill("#bs-q", "zzzz");
  await page.waitForTimeout(300);
  assert.equal(await page.locator('#bs-list [data-bs="reset"]').count(), 1);
  assert.deepEqual(page.errors, []);
  await page.close();
});

test("Buscador: ayuda en las etiquetas y combinaciones de filtros guardadas", { skip }, async () => {
  const page = await open(390);
  await goTab(page, "Buscador");
  // ayuda: el "?" de la cabecera abre la explicación de Nivel, Margen y Las que tengo
  await page.locator('[data-bs="help"]').click();
  const panel = await page.locator(".fi-help-panel").innerText();
  assert.match(panel, /Nivel\s+0 = la rentab\. esperada no es positiva/);
  assert.match(panel, /Margen\s+Con = lo que queda/);
  assert.match(panel, /Las que tengo\s+Acciones con un deal abierto/);
  await page.locator('[data-bs="help"]').click();
  assert.equal(await page.locator(".fi-help-panel").count(), 0);
  await page.locator('[data-bs="filters-open"]').click();
  // guardar una combinación: Con margen, nivel 5
  await page.locator('[data-bs="margin"][data-v="yes"]').click();
  await page.locator('[data-bs="lv"][data-v="3"]').click();
  await page.locator('[data-bs="lv"][data-v="4"]').click();
  await page.locator('.fi-field[data-v="preset"]').click();
  await page.fill('.bs-save input[name="n"]', "Estricta");
  await page.locator('.bs-save button[type="submit"]').click();
  await page.waitForTimeout(300);
  assert.equal(await page.locator('[data-bs="preset"]').count(), 1);
  // cambiar los filtros y volver a la combinación
  await page.locator('[data-bs="margin"][data-v="all"]').click();
  await page.locator('[data-bs="lv"][data-v="3"]').click();
  assert.equal(await page.locator('[data-bs="preset"][aria-pressed="true"]').count(), 0);
  await page.locator('[data-bs="preset"]').click();
  await page.waitForTimeout(300);
  assert.equal(await page.locator('[data-bs="margin"][aria-pressed="true"]').innerText(), "Con");
  assert.equal(await page.locator('[data-bs="lv"][aria-pressed="true"]').allInnerTexts().then((t) => t.join("")), "5");
  assert.equal(await page.locator('[data-bs="preset"][aria-pressed="true"]').count(), 1);
  // se recuerda al recargar, y se borra con la ×
  await page.reload();
  await page.waitForSelector("#bs-bar");
  if (!(await page.locator('.fi-field[data-v="preset"]').count())) await page.locator('[data-bs="filters-open"]').click(); // "Más filtros" se recuerda abierto
  if (!(await page.locator('.fi-field[data-v="preset"][aria-expanded="true"]').count())) await page.locator('.fi-field[data-v="preset"]').click();
  assert.equal(await page.locator('[data-bs="preset"]').count(), 1, "la combinación debe sobrevivir a recargar");
  await page.locator('[data-bs="preset-del"]').click();
  assert.equal(await page.locator('[data-bs="preset"]').count(), 0);
  assert.deepEqual(page.errors, []);
  await page.close();
});

test("Reglas: copiar mis datos y restaurarlos desde la copia", { skip }, async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 800 } });
  await context.addInitScript(() => {
    if (!localStorage.getItem("centinela.tengo.v1") && !sessionStorage.getItem("copiaProbada")) localStorage.setItem("centinela.tengo.v1", JSON.stringify(["DIA", "SPY"]));
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(BASE);
  await page.waitForSelector(".hoy-grid, .stats");
  await goTab(page, "Reglas");
  await page.locator('[data-act="copia-copiar"]').click();
  const text = await page.locator("#copia").inputValue();
  assert.equal(JSON.parse(text).centinela, 1);
  assert.deepEqual(JSON.parse(text).datos["centinela.tengo.v1"], ["DIA", "SPY"]);
  assert.doesNotMatch(text, /token|github/i, "la copia no debe llevar la llave de GitHub");
  // se pierde y se recupera
  await page.evaluate(() => localStorage.setItem("centinela.tengo.v1", "[]"));
  await page.fill("#restaurar", "esto no es una copia");
  await page.locator('form[data-copia] button[type="submit"]').click();
  assert.match(await page.locator("#copia-seccion .notice.bad").innerText(), /no es una copia/);
  await page.fill("#restaurar", text);
  await page.locator('form[data-copia] button[type="submit"]').click();
  assert.match(await page.locator("#copia-seccion .notice.watch").innerText(), /2 acciones marcadas/);
  await Promise.all([page.waitForNavigation(), page.locator('[data-act="copia-ok"]').click()]);
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem("centinela.tengo.v1"))), ["DIA", "SPY"]);
  assert.deepEqual(errors, []);
  await context.close();
});

test("Reglas: cada regla con número cabe en una fila compacta (título y −/+ en la misma línea)", { skip }, async () => {
  const page = await open(360);
  await goTab(page, "Reglas");
  const rows = await page.$$eval(".field:not(.stack)", (els) =>
    els.map((e) => {
      const t = e.querySelector("b").getBoundingClientRect();
      const s = e.querySelector(".stepper").getBoundingClientRect();
      return { h: Math.round(e.getBoundingClientRect().height), sameLine: Math.abs(t.top + t.height / 2 - (s.top + s.height / 2)) < 30, text: e.innerText.slice(0, 30) };
    }),
  );
  assert.ok(rows.length >= 8);
  for (const r of rows) {
    assert.ok(r.sameLine, `${r.text}: el título y el −/+ no van en la misma línea`);
    assert.ok(r.h < 170, `${r.text}: fila de ${r.h} px`);
  }
  assert.ok(await noOverflow(page));
  await page.close();
});

test("Buscador: filtro de volatilidad (IV alta / IV baja) y la ficha con media de 50 días, 5 sesiones y gráfico", { skip }, async () => {
  const page = await open(390);
  await goTab(page, "Buscador");
  await page.locator('[data-bs="filters-open"]').click();
  for (const l of [0, 1, 2]) await page.locator(`[data-bs="lv"][data-v="${l}"]`).click();
  await page.locator('[data-bs="one"]').click();
  await page.waitForTimeout(300);
  const count = async () => Number((await page.locator("#bs-bar").innerText()).match(/(\d+) de \d+ deals?/)[1]);
  const all = await count();
  await page.locator('[data-bs="vol"][data-v="high"]').click();
  await page.waitForTimeout(300);
  const high = await count();
  await page.locator('[data-bs="vol"][data-v="low"]').click();
  await page.waitForTimeout(300);
  const low = await count();
  assert.ok(high > 0 && high < all, `IV alta ${high} de ${all}`);
  assert.ok(low >= 0 && high + low <= all, `IV alta ${high} + IV baja ${low} no puede pasar de ${all}`);
  await page.locator('[data-bs="vol"][data-v="all"]').click();
  await page.waitForTimeout(300);
  assert.equal(await count(), all);
  // la ficha: gráfico de precio y los dos datos nuevos
  await page.locator('[data-hoy="cell"]').first().click();
  await page.waitForSelector(".sheet");
  await page.locator('[data-hoy="fold"][data-v="vol"]').click();
  assert.equal(await page.locator(".pchart svg").count(), 1);
  assert.match(await page.locator(".pchart svg").getAttribute("aria-label"), /media de 50 días/);
  const text = await page.locator(".sheet").innerText();
  assert.match(text, /Media de 50 días/);
  assert.match(text, /Últimas 5 sesiones/);
  assert.ok(await noOverflow(page));
  assert.deepEqual(page.errors, []);
  await page.close();
});
