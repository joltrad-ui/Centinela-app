#!/usr/bin/env bash
# Deja la rama lista para una PR a producción: rebasada sobre main, comprobada y subida.
#
#   bash scripts/produccion.sh              rebasar, probar lo rápido y subir
#   COMPLETO=1 bash scripts/produccion.sh   además, las pruebas de pantalla (si no, las corre GitHub, que ya no publica si fallan)
#   bash scripts/produccion.sh reiniciar    después de fusionar: deja la rama igual que main (solo si no pierde nada)
#
# La PR y la fusión se hacen con las herramientas de GitHub (rebase). Después: bash scripts/esperar-ci.sh pr|main <sha>.
# Por qué rebasar: al fusionar con rebase, main tiene copias nuevas de tus commits y la rama sigue con los viejos; sin rebasar, la PR sale con conflicto.
set -uo pipefail
cd "$(dirname "$0")/.."
rama="$(git rev-parse --abbrev-ref HEAD)"
case "$rama" in main | master) echo "No se hace desde $rama: usa la rama de trabajo." >&2; exit 2 ;; esac
paso() { printf '%s\n' "· $*"; }
falla() { printf '✗ %s\n' "$*" >&2; exit 1; }

git config --get-all remote.origin.fetch | grep -qF "refs/remotes/origin/$rama" || git config --add remote.origin.fetch "+refs/heads/$rama:refs/remotes/origin/$rama"
git fetch -q origin main "+refs/heads/$rama:refs/remotes/origin/$rama" 2>/dev/null || git fetch -q origin main || falla "no se pudo leer GitHub"

if [ "${1:-}" = "reiniciar" ]; then
  [ -z "$(git status --porcelain)" ] || falla "hay cambios sin guardar"
  if git diff --quiet origin/main HEAD; then
    git reset -q --hard origin/main
    paso "rama igual que main ($(git rev-parse --short HEAD))"
    exit 0
  fi
  falla "la rama tiene cosas que main no tiene: no se reinicia"
fi

[ -z "$(git status --porcelain)" ] || falla "hay cambios sin guardar: primero scripts/entrega.sh"
git rebase -q origin/main >/dev/null 2>&1 || { git rebase --abort 2>/dev/null; falla "conflicto al rebasar sobre main: resolverlo a mano"; }
nuevos="$(git rev-list --count origin/main..HEAD)"
[ "$nuevos" -gt 0 ] || { paso "nada que subir: la rama no tiene nada que main no tenga"; exit 0; }
paso "rebasada sobre main: $nuevos commits nuevos"

salida="$(for f in web/*.js scanner/*.mjs test/*.mjs scripts/*.mjs; do [ -f "$f" ] && node --check "$f" 2>&1 || true; done)"
[ -z "$salida" ] || falla "sintaxis: $(printf '%s' "$salida" | head -5)"
salida="$(npm run -s test:motor 2>&1)" || falla "pruebas del motor: $(printf '%s\n' "$salida" | grep -E '^not ok|error:' | head -5)"
paso "motor: $(printf '%s\n' "$salida" | grep -E '^# pass' | tr -d '#')"
if [ "${COMPLETO:-}" = 1 ]; then
  salida="$(node --test test/ui.test.mjs 2>&1)"; res=$?
  git checkout -q -- config.json 2>/dev/null || true; rm -f config.local.json
  [ $res = 0 ] || falla "pruebas de pantalla: $(printf '%s\n' "$salida" | grep -E '^not ok|error:' | head -5)"
  paso "pantallas: $(printf '%s\n' "$salida" | grep -E '^# pass' | tr -d '#')"
fi
git diff --name-only origin/main HEAD | grep -qx 'config.json' && falla "config.json va en los cambios: no debe subirse con datos del dueño"

remoto="$(git rev-parse -q --verify "refs/remotes/origin/$rama" || true)"
git push -q -u origin "$rama" "--force-with-lease=$rama${remoto:+:$remoto}" 2>/dev/null || falla "no se pudo subir la rama"
git fetch -q origin "+refs/heads/$rama:refs/remotes/origin/$rama" 2>/dev/null || true
paso "subida: $(git rev-parse HEAD)"
echo "Siguiente: crear la PR $rama → main, fusionar con rebase (expectedHeadSha = el SHA de arriba) y bash scripts/esperar-ci.sh pr $(git rev-parse --short HEAD)"
