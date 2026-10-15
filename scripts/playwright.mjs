// Cómo encontrar Playwright y Chromium en esta máquina (lo usan las pruebas de pantalla y scripts/ver.mjs).
// Playwright no es una dependencia del proyecto: se usa el que haya (en el proyecto o instalado en global).
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import path from "node:path";

export function findPlaywright() {
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

/** Ruta de un Chromium ya instalado (CHROMIUM_PATH o /opt/pw-browsers/chromium); si no, Playwright usa el suyo. */
export const CHROMIUM = [process.env.CHROMIUM_PATH, "/opt/pw-browsers/chromium"].find((p) => p && existsSync(p));
