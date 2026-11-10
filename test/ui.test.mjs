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
  run(["test/make-registro-ejemplo.mjs", out]);
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
    for (const tab of ["Hoy", "Buscador", "Avisos", "Mis deals", "Reglas"]) {
      await goTab(page, tab);
      assert.ok(await noOverflow(page), `${tab} desborda a ${width} px`);
    }
    for (const view of ["nube", "barras", "mapa"]) {
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
  for (let i = 0; i < 80 && !(widths.length > 0 && widths.every((w) => w <= 300)); i++) {
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

test("el Buscador: SPY y XSP, uno es \"mismo grupo\" (medido) o \"mismo bloque\"; los de $10 llevan su riesgo a la vista", { skip }, async () => {
  const page = await open(390);
  await goTab(page, "Buscador");
  await page.fill("#bs-q", "S&P");
  let text = "";
  for (let i = 0; i < 40 && !/mismo (bloque|grupo) que/.test(text); i++) {
    await page.waitForTimeout(250);
    text = await page.locator("#bs-list").innerText();
  }
  assert.match(text, /mismo grupo que (SPY|XSP) \(0,\d\d\)/, "los cierres de ejemplo de SPY y XSP se mueven casi igual");
  const rows = await page.$$eval("#bs-list .fi-dr", (els) => els.map((e) => e.innerText));
  for (const row of rows) {
    const width = Number(row.match(/ancho \$(\d+)/)?.[1]);
    if (width >= 1000) assert.match(row, /arriesga más de \$500/);
  }
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
  await page.locator('[data-tab="deals"]').click();
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
  await page.locator('[data-tab="deals"]').click();
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

test("Mis deals: barra de orden, tarjeta compacta que se despliega al tocarla y resumen arriba", { skip }, async () => {
  const page = await open(390);
  await page.evaluate(() => {
    const d = (id, s, days, credit) => ({ id, s, b: "", expiry: new Date(Date.now() + days * 864e5).toISOString().slice(0, 10), short: 100, long: 95, credit, qty: 1, fee: 0, openedAt: Date.now(), level: null, retExp: null, price0: null, closedAt: null, result: null, manual: true });
    localStorage.setItem("centinela.misdeals.v1", JSON.stringify([d("a", "ZZA", 30, 1), d("b", "ZZB", 5, 2), d("c", "ZZC", 12, 0.5)]));
  });
  await page.reload();
  await page.locator('[data-tab="deals"]').click();
  const order = async () => (await page.locator(".dl-sym").allInnerTexts()).join(",");
  await page.locator('[data-hoy="msort"][data-v="dias"]').click();
  assert.equal(await order(), "ZZB,ZZC,ZZA");
  await page.locator('[data-hoy="msort"][data-v="perdida"]').click();
  assert.equal(await order(), "ZZC,ZZA,ZZB", "más pérdida máx. primero");
  const sum = await page.locator(".dl-sum").innerText();
  assert.match(sum, /Abiertos\s*3/);
  assert.match(sum, /Pierdes máx\.\s*\$1\d\d\d/);
  // La tarjeta cerrada mide unos 115 px y no lleva botones; tocarla los enseña, y vuelve a tocar los esconde.
  const card = page.locator(".dl-card").first();
  const h = (await card.boundingBox()).height;
  assert.ok(h > 95 && h < 135, `tarjeta compacta, mide ${h}`);
  assert.equal(await page.locator(".dl-act").count(), 0);
  await card.locator(".dl-main").click();
  assert.equal(await page.locator(".dl-act").count(), 1);
  assert.match(await page.locator(".dl-act").innerText(), /Cerrar deal/);
  await card.locator(".dl-main").click();
  assert.equal(await page.locator(".dl-act").count(), 0);
  // Borrar sigue pidiendo confirmación.
  await card.locator(".dl-main").click();
  await page.locator('[data-hoy="deal-del"]').click();
  assert.match(await page.locator('[data-hoy="deal-del-yes"]').innerText(), /¿Seguro\?/);
  assert.equal(await page.locator(".dl-card").count(), 3);
  assert.deepEqual(page.errors, []);
  await page.close();
});

test("La ficha de un deal apuntado enseña «Tu deal»", { skip }, async () => {
  const page = await open(390);
  await page.locator('button.lv[data-hoy="cell"]:not(.lvh)').first().click();
  assert.equal(await page.locator(".fi-mine").count(), 0, "un deal no apuntado no lleva franja");
  await page.locator('button[data-hoy="fold"][data-v="bro"]').click();
  await page.locator('[data-hoy="form-open"]').click();
  await page.locator('[data-hoy-form="abrir"] button[type=submit]').click();
  await page.locator('[data-tab="deals"]').click();
  await page.locator(".dl-main").first().click();
  await page.locator('[data-hoy="cell"]').first().click();
  const mine = await page.locator(".fi-mine").innerText();
  const boxes = await page.locator(".fi-mine .fi-box").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
  assert.equal(new Set(boxes).size, 1, "las tres cajas de «Tu deal» van en una fila");
  assert.match(mine, /Tu deal/);
  assert.match(mine, /Cobraste/);
  assert.match(mine, /Prob\. al apuntar/);
  assert.deepEqual(page.errors, []);
  await page.close();
});

test("Registro: pestaña entre Mis deals y Reglas, señales, tablas y sin desbordes", { skip }, async () => {
  for (const width of [360, 390]) {
    const page = await open(width);
    const tabs = await page.locator("nav.dock button").allInnerTexts();
    assert.deepEqual(tabs.map((t) => t.replace(/\s+/g, " ").trim()), ["Hoy", "Buscador", "Avisos", "Mis deals", "Registro", "Reglas"]);
    await goTab(page, "Registro");
    await page.waitForSelector(".rg-sig", { timeout: 8000 });
    const text = await page.locator("#app").innerText();
    assert.match(text, /vencimientos? · [\d.]+ deals resueltos · desde el/);
    for (const part of ["Señales", "Por nivel", "Por desacuerdo", "Por grupo"]) assert.match(text, new RegExp(part));
    assert.equal(await page.locator(".rg-sig li").count(), 4);
    assert.equal(await page.locator(".rg-tb .rg-row").count(), 6, "tres niveles y tres tramos de desacuerdo");
    assert.equal(await page.locator(".rg-track .re").count(), 6);
    assert.ok(await page.locator(".rg-sig .rg-dot.r, .rg-sig .rg-dot.g, .rg-sig .rg-dot.a").count() >= 1, "con 3 vencimientos o más las señales se encienden");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, `sin desborde a ${width}`);
    assert.deepEqual(page.errors, []);
    await page.close();
  }
});

test("Reglas: grupos y registro se pueden cambiar", { skip }, async () => {
  const page = await open(390);
  await goTab(page, "Reglas");
  await page.locator('[data-act="reset"]').first().click();
  await page.waitForTimeout(300);
  const field = () => page.locator(".field", { hasText: "Correlación para agrupar" });
  assert.match(await field().innerText(), /0,85/);
  await field().locator('[data-dir="-1"]').click();
  await page.waitForTimeout(300);
  assert.match(await field().innerText(), /0,84/);
  assert.match(await page.locator(".field", { hasText: "Pierden a la vez" }).innerText(), /3 nombres/);
  await page.locator('[data-act="reset"]').first().click();
  assert.deepEqual(page.errors, []);
  await page.close();
});

test("Reglas y Avisos: pasos, interruptores, avisos y restaurar funcionan", { skip }, async () => {
  const page = await open(390);
  await goTab(page, "Reglas");
  await page.locator('[data-act="reset"]').first().click(); // reglas de fábrica, sea cual sea la configuración guardada
  await page.waitForTimeout(300);
  // "hace un momento" pasa a "hace 1 min" si la ejecución cruza un minuto: no es un cambio de reglas.
  const appText = async () => (await page.locator("#app").innerText()).replace(/hace (un momento|\d+ min)/g, "hace _");
  const before = await appText();
  await page.locator("[data-step]").first().click();
  await page.waitForTimeout(300);
  await page.locator("[data-rule-switch]").first().click();
  await page.waitForTimeout(300);
  assert.notEqual(await appText(), before, "los controles de Reglas no cambian nada");
  await page.locator('[data-act="reset"]').first().click();
  await page.waitForTimeout(300);
  assert.equal(await appText(), before, "Restaurar debe volver a las reglas de fábrica");
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
  assert.equal(await page.locator("#hoy-pr-range-val").innerText(), "sin tope");
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
  // Arrancando en el Buscador, los deals salen solos cuando llegan los cierres diarios, sin pasar por Hoy.
  await page.waitForSelector(".fi-dr", { timeout: 10000 });
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

test("Buscador: un deal vencido sin cerrar ya no marca la acción como que la tengo", { skip }, async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 800 } });
  await context.addInitScript(() => {
    const deal = (id, s, expiry) => ({ id, s, b: "", expiry, short: 80, long: 75, credit: 1, qty: 1, fee: 0, openedAt: 1, closedAt: null, result: null });
    localStorage.setItem("centinela.misdeals.v1", JSON.stringify([deal("t1", "TLT", "2020-01-17"), deal("t2", "SPY", "2099-01-15")]));
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(BASE);
  await page.waitForSelector(".hoy-grid, .stats");
  await goTab(page, "Buscador");
  await page.locator('[data-bs="names"]').click();
  assert.equal(await page.locator('[data-bs="name"][data-v="SPY"].mine').count(), 1, "SPY (deal sin vencer) lleva el punto");
  assert.equal(await page.locator('[data-bs="name"][data-v="TLT"].mine').count(), 0, "TLT (deal vencido) no lleva el punto");
  assert.match(await page.locator(".bs-panel").innerText(), /ya la tienes/);
  assert.deepEqual(errors, []);
  await context.close();
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

test("Buscador: UNH llega a $10 de ancho y MRK se queda en $5", { skip }, async () => {
  const page = await open(390);
  await goTab(page, "Buscador");
  await page.locator('[data-bs="filters-open"]').click();
  for (const l of [0, 1, 2]) await page.locator(`[data-bs="lv"][data-v="${l}"]`).click();
  await page.locator('[data-bs="one"]').click();
  const widths = async (q) => {
    await page.fill("#bs-q", q);
    await page.waitForTimeout(400);
    return page.$$eval("#bs-list .fi-dr", (els) => els.map((e) => Number(e.innerText.match(/ancho \$(\d+)/)?.[1])).filter(Boolean));
  };
  const unh = await widths("UnitedHealth");
  assert.ok(unh.length > 0, "UNH sale en el Buscador");
  assert.ok(unh.includes(1000), `UNH con spreads de $10 (${unh})`);
  const mrk = await widths("Merck");
  assert.ok(mrk.length > 0, "MRK sale en el Buscador");
  assert.ok(Math.max(...mrk) <= 500, `MRK como mucho $5 (${mrk})`);
  assert.deepEqual(page.errors, []);
  await page.close();
});

test("Bloques: lo guardado con un grupo que ya no existe pasa a los bloques de sus nombres y Hoy lo avisa", { skip }, async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 800 } });
  await context.addInitScript(() => {
    if (sessionStorage.getItem("bloquesProbados")) return;
    sessionStorage.setItem("bloquesProbados", "1");
    localStorage.setItem("centinela.bloques.v1", JSON.stringify({ members: { "Grupo de VIEJO": ["NVDA", "AMZN"], Metales: ["GLD", "SLV"] }, notice: false }));
    localStorage.setItem("centinela.hoy.v1", JSON.stringify({ held: ["Grupo de VIEJO", "Metales"] }));
    localStorage.setItem("centinela.buscador.v1", JSON.stringify({ blocks: ["Grupo de VIEJO"] }));
    localStorage.setItem("centinela.buscador.guardados.v1", JSON.stringify([{ n: "Viejo", f: { blocks: ["Grupo de VIEJO", "Nada"] } }]));
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(BASE);
  await page.waitForSelector(".hoy-grid, .stats");
  let text = "";
  for (let i = 0; i < 40 && !/Los bloques han cambiado/.test(text); i++) {
    await page.waitForTimeout(250);
    text = await page.locator("main").innerText();
  }
  assert.match(text, /Los bloques han cambiado este mes: revisa Mis bloques/);
  const ls = (key) => page.evaluate((k) => JSON.parse(localStorage.getItem(k)), key);
  assert.deepEqual((await ls("centinela.hoy.v1")).held, ["Tecnología grande", "Metales"]);
  assert.deepEqual((await ls("centinela.buscador.v1")).blocks, ["Tecnología grande"]);
  assert.deepEqual((await ls("centinela.buscador.guardados.v1"))[0].f.blocks, ["Tecnología grande"], "un bloque que no existe se quita");
  // Al abrir Mis bloques, el aviso se va.
  await page.locator('[data-hoy="filters-open"]').click();
  await page.locator('[data-hoy="held-open"]').click();
  await page.waitForTimeout(300);
  assert.equal(await page.locator('[data-hoy="held"][data-v="Tecnología grande"][aria-pressed="true"]').count(), 1);
  assert.doesNotMatch(await page.locator("main").innerText(), /Los bloques han cambiado/);
  // Reglas: el umbral nuevo y la fecha de corte.
  await goTab(page, "Reglas");
  const reglas = await page.locator("main").innerText();
  assert.match(reglas, /Caer juntos para agrupar bloques/);
  assert.match(reglas, /40 %/);
  assert.match(reglas, /Bloques calculados con cierres hasta el \d+ \w+/);
  // La ficha dice en qué bloque cuenta el nombre: medido y suelto, o nuevo en la lista.
  await goTab(page, "Buscador");
  await page.locator('[data-bs="filters-open"]').click();
  await page.locator('[data-bs="reset"]').click(); // quita el filtro de Bloque (Tecnología grande, ya migrado)
  await page.waitForTimeout(300);
  for (const l of [0, 1, 2]) await page.locator(`[data-bs="lv"][data-v="${l}"]`).click();
  const blockLineOf = async (q) => {
    await page.fill("#bs-q", q);
    await page.waitForTimeout(400);
    await page.locator("#bs-list .fi-dr").first().click();
    await page.waitForSelector(".fi-blk");
    const line = await page.locator(".fi-blk").innerText();
    await page.locator(".fi-x").click();
    await page.waitForTimeout(200);
    return line;
  };
  assert.equal(await blockLineOf("NVIDIA"), "Bloque: Tecnología grande (no cae junto a ningún grupo)");
  assert.equal(await blockLineOf("UnitedHealth"), "Bloque: Defensivos (nuevo en la lista: se mide desde el mes que viene)");
  assert.deepEqual(errors, []);
  await context.close();
});

test("Mal año, Sin deals hoy y Días con algún deal: filtro, ficha, regla, motivos y tabla", { skip }, async () => {
  for (const width of [360, 390]) {
    const page = await open(width);
    // Buscador: el filtro "Mal año" parte los deals en Aguanta y No aguanta.
    await goTab(page, "Buscador");
    await page.locator('[data-bs="filters-open"]').click();
    for (const l of [0, 1, 2]) await page.locator(`[data-bs="lv"][data-v="${l}"]`).click();
    await page.locator('[data-bs="one"]').click();
    await page.waitForTimeout(300);
    const count = async () => Number((await page.locator("#bs-bar").innerText()).match(/(\d+) de \d+ deals?/)[1]);
    const all = await count();
    await page.locator('[data-bs="bad"][data-v="yes"]').click();
    await page.waitForTimeout(300);
    const yes = await count();
    await page.locator('[data-bs="bad"][data-v="no"]').click();
    await page.waitForTimeout(300);
    const no = await count();
    assert.ok(yes > 0 && no > 0, `aguantan ${yes}, no aguantan ${no}`);
    assert.equal(yes + no, all, "todos los deals puntuados caen en uno de los dos lados");
    assert.equal((await page.evaluate(() => JSON.parse(localStorage.getItem("centinela.buscador.v1")))).bad, "no", "el filtro se guarda");
    assert.ok(await noOverflow(page));
    // La ficha de uno que no aguanta dice cuánto falta; la de uno que aguanta, cuánto queda.
    await page.locator('[data-hoy="cell"]').first().click();
    await page.waitForSelector("#fi-badyear");
    assert.match(await page.locator("#fi-badyear").innerText(), /En un mal año \(se paga 1,5 veces lo esperado\)\s*faltan \$\d/);
    await page.locator(".fi-x").click();
    await page.locator('[data-bs="bad"][data-v="yes"]').click();
    await page.waitForTimeout(300);
    await page.locator('[data-hoy="cell"]').first().click();
    await page.waitForSelector("#fi-badyear");
    assert.match(await page.locator("#fi-badyear").innerText(), /quedan \$\d/);
    assert.ok(await noOverflow(page));
    await page.locator(".fi-x").click();
    await page.locator('[data-bs="bad"][data-v="all"]').click();
    // "Sin deals hoy": plegada al final; abierta, una fila por nombre con su motivo. No depende de los filtros.
    const head = page.locator('[data-bs="none"]');
    const n = Number((await head.innerText()).match(/Sin deals hoy \((\d+) nombres?\)/)[1]);
    assert.ok(n > 0);
    assert.equal(await page.locator(".bs-none-l li").count(), 0, "plegada de fábrica");
    await head.click();
    await page.waitForTimeout(200);
    const rows = await page.$$eval(".bs-none-l li", (els) => els.map((e) => [e.querySelector("b").innerText, e.querySelector("span").innerText]));
    assert.equal(rows.length, n);
    const reasons = ["sin opciones en el plazo", "ningún strike con la prob. de Reglas", "no llega al cobro mínimo", "horquilla ancha", "no cubre el coste de salir", "rentab. esperada baja"];
    for (const [name, why] of rows) assert.ok(reasons.includes(why), `${name}: ${why}`);
    assert.ok(new Set(rows.map((r) => r[1])).size >= 2, "la muestra enseña más de un motivo");
    await page.locator('[data-bs="lv"][data-v="5"]').click(); // un filtro del Buscador no cambia la lista de nombres sin deals
    await page.waitForTimeout(300);
    assert.equal(await page.locator(".bs-none-l li").count(), n);
    assert.ok(await noOverflow(page));
    // Reglas: el número del mal año, 1,5 de fábrica y de 0,25 en 0,25.
    await goTab(page, "Reglas");
    const field = page.locator('.field:has([data-step="rules.badYearK"])');
    assert.match(await field.innerText(), /Mal año: se paga … veces lo esperado/);
    assert.equal((await field.locator(".stepper span").innerText()).trim(), "1,5 veces");
    await field.locator('[data-dir="1"]').click();
    await page.waitForTimeout(200);
    assert.equal((await page.locator('.field:has([data-step="rules.badYearK"]) .stepper span').innerText()).trim(), "1,75 veces");
    assert.match(await page.locator("main").innerText(), /En 2015, 2018 y 2022 se pagó entre 1,3 y 1,5 veces lo previsto/i);
    await page.locator('.field:has([data-step="rules.badYearK"]) [data-dir="-1"]').click();
    // Registro: la tabla "Días con algún deal", con la nota de las reglas de fábrica.
    await goTab(page, "Registro");
    await page.waitForSelector(".rg-days");
    const days = await page.$$eval(".rg-days li", (els) => els.map((e) => e.innerText.replace(/\s+/g, " ").trim()));
    assert.equal(days.length, 36, "un nombre de la lista por fila");
    for (const d of days) assert.match(d, /^[A-Z]+ \d+ de \d+$/);
    const nums = days.map((d) => Number(d.match(/ (\d+) de/)[1]));
    assert.deepEqual(nums, [...nums].sort((a, b) => a - b), "de menos a más");
    assert.match(await page.locator("main").innerText(), /Con las reglas de fábrica, no con las tuyas/);
    assert.ok(await noOverflow(page));
    assert.deepEqual(page.errors, []);
    await page.close();
  }
});

test("Nombres quitados de la lista: un deal apuntado, un favorito y un nombre apartado que ya no están no rompen nada", { skip }, async () => {
  const page = await open(390);
  await page.evaluate(() => {
    const expiry = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
    localStorage.setItem("centinela.misdeals.v1", JSON.stringify([{ id: "q1", s: "COST", b: "Defensivos", expiry, short: 900, long: 895, credit: 0.6, qty: 1, fee: 1.4, openedAt: Date.now(), level: 4, retExp: 2, price0: 950, closedAt: null, result: null }]));
    const config = JSON.parse(localStorage.getItem("centinela.config.v1") ?? "{}");
    localStorage.setItem("centinela.config.v1", JSON.stringify({ ...config, favorites: ["COST", "SPY"], off: ["FXI", "RTX"] }));
    localStorage.setItem("centinela.tengo.v1", JSON.stringify(["MA"]));
    localStorage.setItem("centinela.hoy.v1", JSON.stringify({ held: ["Consumo discrecional", "Pagos"] }));
  });
  await page.reload();
  await page.waitForSelector(".hoy-grid, .stats");
  // Mis deals: el deal de COST se sigue viendo y se puede cerrar; solo le falta el precio nuevo.
  await page.locator('[data-tab="deals"]').click();
  assert.equal(await page.locator(".dl-card").count(), 1);
  assert.match(await page.locator(".dl-card").innerText(), /COST/);
  await page.locator(".dl-card .dl-main").click();
  assert.match(await page.locator(".dl-act").innerText(), /Cerrar deal/);
  // El resto de pantallas siguen funcionando, y ninguno de los quitados aparece en la lista de acciones.
  for (const tab of ["Hoy", "Buscador", "Avisos", "Registro", "Reglas"]) {
    await goTab(page, tab);
    assert.ok(await noOverflow(page), `${tab} sin desborde`);
  }
  await goTab(page, "Buscador");
  await page.locator('[data-bs="names"]').click();
  const names = await page.locator(".bs-name").allInnerTexts();
  assert.equal(names.length, 36);
  for (const s of ["COST", "LLY", "MA", "M", "NVS", "EQT", "SLB", "BMY", "RTX", "FXI"]) assert.ok(!names.includes(s), `${s} no sale`);
  assert.ok(names.includes("UBER") && names.includes("GDX"));
  assert.match(await page.locator('[data-bs="names"]').innerText(), /36 de 36/, "un nombre apartado que ya no está en la lista no cuenta");
  assert.deepEqual(page.errors, []);
  await page.close();
});

test("El gesto atrás del teléfono cierra la ficha sin salir de la app", { skip }, async () => {
  const page = await open(390);
  const sheets = () => page.locator(".sheet").count();
  const steps = () => page.evaluate(() => window.history.length);
  const base = await steps();
  const cell = page.locator('button.lv[data-hoy="cell"]:not(.lvh)').first();
  // Atrás cierra la ficha y la app sigue en pantalla.
  await cell.click();
  assert.equal(await sheets(), 1);
  await page.goBack();
  assert.equal(await sheets(), 0, "atrás cierra la ficha");
  assert.equal(await page.locator(".dock").count(), 1, "la app sigue abierta");
  // Elegir otro deal dentro de la ficha no añade pasos: un solo atrás la cierra.
  await cell.click();
  await page.locator('.fi-dr[data-hoy="pick"]').nth(1).click();
  await page.locator('.fi-dr[data-hoy="pick"]').nth(0).click();
  assert.equal(await steps(), base + 1, "un solo paso por ficha");
  await page.goBack();
  assert.equal(await sheets(), 0, "un solo atrás basta");
  // Cerrar con la ✕ deshace el paso: no queda un atrás de sobra.
  await cell.click();
  await page.locator('[data-hoy="close"].fi-x').click();
  await page.waitForFunction(() => window.history.state?.ficha !== true);
  assert.equal(await sheets(), 0);
  // Y abrir otra justo después sigue cerrándose con atrás.
  await cell.click();
  await page.locator('[data-hoy="close"].fi-x').click();
  await cell.click();
  await page.waitForFunction(() => window.history.state?.ficha === true);
  assert.equal(await sheets(), 1, "la ficha abierta justo después de cerrar otra no se cierra sola");
  await page.goBack();
  assert.equal(await sheets(), 0);
  assert.deepEqual(page.errors, []);
  await page.close();
});
