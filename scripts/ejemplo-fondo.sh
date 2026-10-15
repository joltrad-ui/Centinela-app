#!/usr/bin/env bash
# Deja la app de ejemplo corriendo en http://localhost:8080 (con cadenas inventadas), solo si no lo está ya.
# Escribe lo que cambie la app en config.local.json (git lo ignora). Espera hasta que responda.
set -uo pipefail
cd "$(dirname "$0")/.."
puerto="${PUERTO:-8080}"
if curl -s -o /dev/null -m 2 "http://localhost:$puerto/api/ping"; then echo "ya está en http://localhost:$puerto"; exit 0; fi
nohup npm run -s ejemplo > "${TMPDIR:-/tmp}/centinela-ejemplo.log" 2>&1 &
for _ in $(seq 1 60); do
  if curl -s -o /dev/null -m 2 "http://localhost:$puerto/api/ping"; then echo "arrancada en http://localhost:$puerto"; exit 0; fi
  sleep 1
done
echo "no arrancó; mira ${TMPDIR:-/tmp}/centinela-ejemplo.log" >&2
exit 1
