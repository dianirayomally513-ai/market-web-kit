#!/usr/bin/env bash
# One-command deploy: build all sites -> push dist/ to gh-pages branch (GitHub Pages)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
bash scripts/build.sh
bash scripts/pages-index.sh
REMOTE=$(git remote get-url origin)
TMP=$(mktemp -d)
cp -a dist/. "$TMP"/
cd "$TMP"
git init -q -b gh-pages
git config user.name "$(git -C "$ROOT" config user.name)"
git config user.email "$(git -C "$ROOT" config user.email)"
git add -A && git commit -qm "deploy $(date '+%F %T')"
git push -qf "$REMOTE" gh-pages
rm -rf "$TMP"
echo "Deployed. Live in ~1 min: https://$(gh api user -q .login).github.io/$(basename -s .git "$REMOTE")/"
