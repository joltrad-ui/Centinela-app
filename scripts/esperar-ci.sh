#!/usr/bin/env bash
# Espera a que terminen las comprobaciones de GitHub y dice el resultado en una línea.
#
#   bash scripts/esperar-ci.sh pr <sha>     las pruebas de una PR (pruebas.yml) sobre ese commit de la rama
#   bash scripts/esperar-ci.sh main <sha>   "Publicar" (pruebas y publicación) sobre ese commit de main, tras fusionar
#
# <sha> puede ser corto (7 caracteres o más); sin él, el de HEAD. Código de salida: 0 bien, 1 falló, 2 tiempo agotado.
# El repositorio es público: no hace falta clave (con GITHUB_TOKEN en el entorno, se usa, para no toparse con el límite).
set -uo pipefail
cd "$(dirname "$0")/.."
modo="${1:?Uso: esperar-ci.sh pr|main [sha]}"
sha="${2:-$(git rev-parse HEAD)}"
sha="${sha:0:40}"
repo="$(git remote get-url origin | sed -E 's#^(https?://)?([^@/]*@)?github\.com[:/]##; s#\.git$##')"
case "$modo" in
  pr) flujo="pruebas.yml"; evento="pull_request" ;;
  main) flujo="publicar.yml"; evento="push" ;;
  *) echo "Modo desconocido: $modo (pr o main)" >&2; exit 2 ;;
esac
api() { curl -s -m 15 ${GITHUB_TOKEN:+-H "Authorization: Bearer $GITHUB_TOKEN"} "https://api.github.com/repos/$repo/$1"; }

salida="$(python3 - "$repo" "$flujo" "$evento" "$sha" "$modo" <<'PY'
import json, os, subprocess, sys, time, urllib.request
repo, flujo, evento, sha, modo = sys.argv[1:6]
head = {"Authorization": f"Bearer {os.environ['GITHUB_TOKEN']}"} if os.environ.get("GITHUB_TOKEN") else {}
def get(path):
    req = urllib.request.Request(f"https://api.github.com/repos/{repo}/{path}", headers=head)
    try:
        return json.load(urllib.request.urlopen(req, timeout=15))
    except Exception as e:
        return {"error": str(e)}
fin = time.time() + 600
primera = time.time()
run = None
while time.time() < fin:
    d = get(f"actions/workflows/{flujo}/runs?event={evento}&per_page=20")
    runs = [r for r in d.get("workflow_runs", []) if r["head_sha"].startswith(sha[:7]) or sha.startswith(r["head_sha"][:7])]
    if runs:
        run = runs[0]
        if run["status"] == "completed":
            break
    elif modo == "main" and time.time() - primera > 45:
        print("0|Publicar no se activó: ese cambio no toca web/ (nada que publicar).")
        sys.exit(0)
    time.sleep(10)
if not run or run["status"] != "completed":
    print("2|Tiempo agotado esperando " + flujo + " sobre " + sha[:7] + ".")
    sys.exit(0)
jobs = get(f"actions/runs/{run['id']}/jobs").get("jobs", [])
detalle = ", ".join(f"{j['name']} {j['conclusion']}" for j in jobs)
ok = run["conclusion"] == "success"
print(f"{0 if ok else 1}|{flujo} sobre {sha[:7]}: {run['conclusion']} ({detalle}) {run['html_url']}")
PY
)"
codigo="${salida%%|*}"; echo "${salida#*|}"; exit "$codigo"
