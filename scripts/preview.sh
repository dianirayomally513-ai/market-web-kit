#!/usr/bin/env bash
# Local preview — serve kit root so shared/css resolves for all sites
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SITE="${1:-ph-howto-sample}"
PORT="${PORT:-4173}"
DIR="$ROOT/sites/$SITE"

if [[ ! -d "$DIR" ]]; then
  echo "Site not found: $DIR"
  echo "Available:"
  ls -1 "$ROOT/sites"
  exit 1
fi

cd "$ROOT"
if [[ ! -d node_modules/serve ]]; then
  echo "Installing serve..."
  npm install --no-fund --no-audit
fi

URL="http://127.0.0.1:${PORT}/sites/${SITE}/"
echo "Preview: ${URL}"
echo "Kit root: $ROOT  |  Ctrl+C to stop"
exec npx --yes serve "$ROOT" -l "tcp://127.0.0.1:${PORT}" --no-clipboard
