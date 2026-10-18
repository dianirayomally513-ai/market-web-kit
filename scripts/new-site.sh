#!/usr/bin/env bash
# Clone sample into a new site folder
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NAME="${1:-}"

if [[ -z "$NAME" ]]; then
  echo "Usage: npm run new-site -- <site-slug>"
  echo "Example: npm run new-site -- ke-momo-howto"
  exit 1
fi

# slug: lowercase, digits, hyphens
if [[ ! "$NAME" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]]; then
  echo "Slug must be lowercase letters/digits/hyphens only: got '$NAME'"
  exit 1
fi

DEST="$ROOT/sites/$NAME"
if [[ -e "$DEST" ]]; then
  echo "Already exists: $DEST"
  exit 1
fi

cp -a "$ROOT/sites/ph-howto-sample" "$DEST"
# Lighten title markers so you notice placeholders
find "$DEST" -type f \( -name '*.html' -o -name '*.css' \) -print0 | while IFS= read -r -d '' f; do
  sed -i "s/PH How-To Sample/${NAME}/g" "$f"
  sed -i "s/ph-howto-sample/${NAME}/g" "$f"
done

echo "Created sites/${NAME}/"
echo "Edit HTML under sites/${NAME}/ then:"
echo "  npm run preview -- ${NAME}"
echo "  npm run build -- ${NAME}"
