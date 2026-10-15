#!/usr/bin/env bash
# Entrega un cambio en una sola orden: comprueba, prueba lo que toca, hace el commit y sube.
#
#   bash scripts/entrega.sh "Mensaje del commit"          lo normal
#   TESTS=todo|motor|ui|nada bash scripts/entrega.sh ...  forzar qué pruebas (si no, según lo cambiado)
#   SIN_SUBIR=1 bash scripts/entrega.sh ...               solo comprobar y hacer el commit
#
# Qué pruebas: scanner/, web/engine.js o test/engine → motor (menos de 1 s); web/ o test/ui → pantallas (~50 s).
# Salida corta: una línea por paso. Si algo falla, enseña solo las líneas del fallo y no hace el commit.
# La línea final de trailer del commit sale de $CLAUDE_SESSION_URL si existe (no va escrita en el repositorio).
set -uo pipefail
cd "$(dirname "$0")/.."
mensaje="${1:?Falta el mensaje del commit}"
rama="$(git rev-parse --abbrev-ref HEAD)"
case "$rama" in main | master) echo "No se entrega desde $rama: crea una rama." >&2; exit 2 ;; esac

paso() { printf '%s\n' "· $*"; }
falla() { printf '✗ %s\n' "$1" >&2; shift; printf '%s\n' "$@" | head -25 >&2; exit 1; }

# 1. Sintaxis
for f in web/*.js scanner/*.mjs test/*.mjs scripts/*.mjs; do
  [ -f "$f" ] || continue
  salida="$(node --check "$f" 2>&1)" || falla "sintaxis de $f" "$salida"
done
paso "sintaxis bien"

# 2. Qué ha cambiado, para elegir las pruebas
cambiados="$( (git diff --name-only HEAD; git ls-files --others --exclude-standard) | sort -u)"
cambiados="$(printf '%s\n' "$cambiados" | grep -v '^config.json$' || true)"
[ -n "$cambiados" ] || { paso "nada que entregar"; exit 0; }
motor=0; ui=0
printf '%s\n' "$cambiados" | grep -qE '^(scanner/|web/engine\.js|test/engine|package\.json)' && motor=1
printf '%s\n' "$cambiados" | grep -qE '^(web/|test/ui|test/make-fixtures)' && ui=1
case "${TESTS:-auto}" in todo) motor=1; ui=1 ;; motor) motor=1; ui=0 ;; ui) motor=0; ui=1 ;; nada) motor=0; ui=0 ;; esac

# 3. Pruebas
if [ "$motor" = 1 ]; then
  salida="$(npm run -s test:motor 2>&1)"; res=$?
  [ $res = 0 ] || falla "pruebas del motor" "$(printf '%s\n' "$salida" | grep -E '^not ok|^# (pass|fail)|error:' )"
  paso "motor: $(printf '%s\n' "$salida" | grep -E '^# pass' | tr -d '#') pruebas"
fi
if [ "$ui" = 1 ]; then
  salida="$(node --test test/ui.test.mjs 2>&1)"; res=$?
  git checkout -q -- config.json 2>/dev/null || true
  [ $res = 0 ] || falla "pruebas de pantalla" "$(printf '%s\n' "$salida" | grep -E '^not ok|^# (pass|fail)|error:|expected|actual' )"
  paso "pantallas: $(printf '%s\n' "$salida" | grep -E '^# (pass|skipped)' | tr -d '#' | tr '\n' ' ')"
fi
[ "$motor$ui" = 00 ] && paso "sin pruebas (nada de motor ni de pantallas ha cambiado)"

# 4. Commit
git checkout -q -- config.json 2>/dev/null || true # el modo ordenador la reescribe con las reglas reales: nunca al repositorio
git add -A
[ -n "${CLAUDE_SESSION_URL:-}" ] && mensaje="$mensaje

Claude-Session: $CLAUDE_SESSION_URL"
git commit -q -m "$mensaje" || falla "commit" "$(git status --short)"
paso "commit $(git rev-parse --short HEAD)"
[ "${SIN_SUBIR:-}" = 1 ] && exit 0

# 5. Subir. Se refresca la referencia remota de la rama (la causa del aviso falso de "commits sin subir")
#    y se sube con "lease" sobre lo que había: así rama reiniciada desde main no da error y nada ajeno se pisa.
git config --get-all remote.origin.fetch | grep -qF "refs/remotes/origin/$rama" || git config --add remote.origin.fetch "+refs/heads/$rama:refs/remotes/origin/$rama"
git fetch -q origin "+refs/heads/$rama:refs/remotes/origin/$rama" 2>/dev/null || true
remoto="$(git rev-parse -q --verify "refs/remotes/origin/$rama" || true)"
lease="--force-with-lease=$rama${remoto:+:$remoto}"
for espera in 0 2 4 8 16; do
  sleep "$espera"
  if git push -q -u origin "$rama" "$lease" 2>/dev/null; then
    git fetch -q origin "+refs/heads/$rama:refs/remotes/origin/$rama" 2>/dev/null || true
    git config "branch.$rama.remote" origin; git config "branch.$rama.merge" "refs/heads/$rama"
    paso "subido a $rama ($(git rev-list --count "origin/$rama..HEAD" 2>/dev/null || echo ?) sin subir)"
    exit 0
  fi
done
falla "subida" "No se pudo subir a $rama (¿otro cambio en el remoto?)"
