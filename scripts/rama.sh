#!/usr/bin/env bash
# Publica una parte de la rama gh-pages sin tocar la otra.
#
#   REMOTO=<url del repositorio> bash scripts/rama.sh app web        la app: todo menos data/
#   REMOTO=<url del repositorio> bash scripts/rama.sh datos out/data el barrido: solo data/
#
# La rama lleva siempre un único commit, para que el repositorio no engorde con cada
# barrido. Publicar y barrer pueden coincidir: si el otro ha enviado entre medias, el
# envío se rechaza y se vuelve a montar sobre lo último, sin pisar su parte.
set -euo pipefail

parte="$1"
origen="$(cd "$2" && pwd)"
remoto="${REMOTO:?Falta REMOTO}"
rama="${RAMA:-gh-pages}"
trabajo="$(mktemp -d)"

for intento in 1 2 3 4 5 6; do
  rm -rf "$trabajo/sitio"
  mkdir -p "$trabajo/sitio"
  cd "$trabajo/sitio"
  git init -q -b "$rama"
  base=""
  if git fetch -q --depth=1 "$remoto" "$rama" 2>/dev/null; then
    base="$(git rev-parse FETCH_HEAD)"
    git archive FETCH_HEAD | tar -x
  fi
  if [ "$parte" = app ]; then
    find . -mindepth 1 -maxdepth 1 ! -name .git ! -name data -exec rm -rf {} +
    cp -r "$origen"/. .
    touch .nojekyll
  else
    rm -rf data
    mkdir data
    cp -r "$origen"/. data/
  fi
  git add -A
  git -c user.name="centinela" -c user.email="centinela@users.noreply.github.com" commit -q -m "$([ "$parte" = app ] && echo App || echo Barrido)"
  if git push -q --force-with-lease="$rama:$base" "$remoto" "HEAD:$rama" 2>/dev/null; then
    echo "Publicado ($parte) al intento $intento"
    exit 0
  fi
  echo "Otro trabajo ha publicado entre medias; reintento"
  sleep $((RANDOM % 4 + 2))
done
echo "No se pudo publicar ($parte)" >&2
exit 1
