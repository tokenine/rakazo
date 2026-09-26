#!/usr/bin/env bash
# Rebrand the user-visible product name across remaining literal surfaces.
#
# Runtime surfaces that read `BRAND_NAME` from `packages/contracts/src/brand.ts`
# are NOT touched by this script — update BRAND_NAME separately.
#
# Usage:   scripts/rebrand-display.sh <NEW_NAME>
# Example: scripts/rebrand-display.sh "Aurora"
#
# Only the capitalized display word "Rakazo" is replaced. Lowercase technical
# identifiers (`@rakazo/*`, `RAKAZO_*`, `dev.rakazo.desktop`, image names,
# compose project names, `persist:rakazo-*`, URL schemes) are intentionally
# untouched — see REBRAND-NOTES.md.
set -Eeuo pipefail

if [[ $# -ne 1 || -z "$1" ]]; then
  echo "Usage: scripts/rebrand-display.sh <NEW_NAME>" >&2
  exit 2
fi
if [[ ! -f packages/contracts/src/brand.ts ]]; then
  echo "Run from the repository root." >&2
  exit 2
fi

NEW_NAME="$1"
OLD_NAME="Rakazo"

TARGETS=(
  "apps/web/index.html"
  "apps/web/src/locales"
  "apps/web/src/pages"
  "apps/web/e2e"
  "apps/mobile/app.json"
  "apps/mobile/app"
  "apps/mobile/lib"
  "apps/desktop/src"
  "apps/desktop/e2e"
  "apps/desktop/package.json"
  "apps/www/src"
  "packages/core/src/self-update.ts"
  "packages/core/src/secrets-guard.ts"
  "README.md"
  "CONTRIBUTING.md"
  "SECURITY.md"
  "docs"
)

for target in "${TARGETS[@]}"; do
  if [[ -e "$target" ]]; then
    # `|| true`: with pipefail, grep exiting 1 on "no remaining matches"
    # (already-rebranded targets) would otherwise abort the whole script.
    (grep -rl "$OLD_NAME" "$target" 2>/dev/null || true) | while read -r file; do
      case "$file" in
        *.po | *.html | *.js | *.ts | *.tsx | *.json | *.md | *.astro)
          # Word-boundary match so compound identifiers (RakazoDesktop,
          # isRakazoHealth) and lowercase technical names (@rakazo/*, RAKAZO_*,
          # persist:rakazo-*) survive; only the standalone display word changes.
          sed -i.bak "s/[[:<:]]$OLD_NAME[[:>:]]/$NEW_NAME/g" "$file" && rm -f "$file.bak"
          echo "rebranded: $file"
          ;;
      esac
    done
  fi
done

# Icon/asset file paths keep pointing at the existing artwork until the logo
# itself is swapped (assets live under packages/ui-tokens/assets/).
for cfg in apps/desktop/package.json apps/mobile/app.json; do
  if [[ -f "$cfg" ]]; then
    sed -i.bak "s|assets/$NEW_NAME.icon|assets/$OLD_NAME.icon|g" "$cfg" && rm -f "$cfg.bak"
  fi
done

echo "Done. Now update BRAND_NAME in packages/contracts/src/brand.ts, swap logo"
echo "assets (packages/ui-tokens/assets/, apps/www/public/brand/), then run:"
echo "  pnpm --filter @rakazo/web exec lingui extract && pnpm typecheck && pnpm test"
