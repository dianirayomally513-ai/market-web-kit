#!/usr/bin/env bash
# Default entry: preview sample site
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec bash "$ROOT/scripts/preview.sh" "${1:-ph-howto-sample}"
