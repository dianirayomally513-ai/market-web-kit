#!/usr/bin/env bash
# Copy one or all sites into dist/ for static deploy
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SITE="${1:-}"
DIST="$ROOT/dist"

mkdir -p "$DIST"

copy_site() {
  local name="$1"
  local src="$ROOT/sites/$name"
  local dest="$DIST/$name"
  if [[ ! -d "$src" ]]; then
    echo "Skip missing: $name"
    return 1
  fi
  rm -rf "$dest"
  mkdir -p "$dest"
  # Copy site files
  cp -a "$src"/. "$dest"/
  # Resolve shared CSS: rewrite @import and embed a copy of shared assets
  mkdir -p "$dest/_shared/css"
  if [[ -d "$ROOT/shared/css" ]]; then
    cp -a "$ROOT/shared/css"/. "$dest/_shared/css"/
  fi
  # Fix relative import in site CSS (../../../shared/css/base.css → ../_shared/css/base.css)
  if [[ -f "$dest/css/style.css" ]]; then
    sed -i 's|@import url("../../../shared/css/base.css");|@import url("../_shared/css/base.css");|g' "$dest/css/style.css"
  fi
  echo "Built: dist/$name"
}

if [[ -n "$SITE" ]]; then
  copy_site "$SITE"
else
  for d in "$ROOT/sites"/*; do
    [[ -d "$d" ]] || continue
    copy_site "$(basename "$d")"
  done
fi

echo "Done. Deploy contents of dist/<site-name>/ (or whole dist/)."
