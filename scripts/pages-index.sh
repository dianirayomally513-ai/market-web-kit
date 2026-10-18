#!/usr/bin/env bash
# Generate dist/index.html listing every built site (for GitHub Pages root)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST="$ROOT/dist"
{
echo '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>market-web-kit sites</title><style>body{font-family:system-ui,sans-serif;max-width:640px;margin:3rem auto;padding:0 1rem}a{display:block;padding:.6rem 0}</style></head><body><h1>Sites</h1>'
for d in "$DIST"/*/; do n=$(basename "$d"); echo "<a href=\"$n/\">$n</a>"; done
echo '</body></html>'
} > "$DIST/index.html"
touch "$DIST/.nojekyll"
echo "Built: dist/index.html"
