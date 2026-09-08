#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════
#  Fueld manual ship script — build, package, upload, deploy.
#
#  Usage:
#    bash deploy/ship.sh <instance> [--skip-build] [--web-only] [--yes]
#
#  <instance>     one of deploy/instances/<name>.env (e.g. staging, moxie,
#                 channeltx, riviera-marine)
#  --skip-build   reuse the existing artifacts from the previous build
#  --web-only     package + upload the frontend only (deploy.sh promotes it
#                 without touching the API)
#  --yes          skip the confirmation prompt
#
#  What it does:
#    1. builds the API binary + web bundle (unless --skip-build)
#    2. packages tars + build-info.json + MANIFEST.sha256 (checksums)
#    3. uploads to the instance VPS via ssh/scp (uses your ssh config)
#    4. applies the idempotent document_type enum fix if missing
#    5. runs deploy.sh remotely (checksums verified server-side first)
# ═══════════════════════════════════════════════════════════════════════
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
log() { echo -e "${GREEN}▶${NC} $1"; }
warn() { echo -e "${YELLOW}⚠${NC} $1"; }
err() { echo -e "${RED}✖${NC} $1"; }

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTANCE=""
SKIP_BUILD=false
WEB_ONLY=false
ASSUME_YES=false

for arg in "$@"; do
  case "$arg" in
    --skip-build) SKIP_BUILD=true ;;
    --web-only) WEB_ONLY=true ;;
    --yes) ASSUME_YES=true ;;
    -*) err "Unknown option: $arg"; exit 1 ;;
    *) INSTANCE="$arg" ;;
  esac
done

if [ -z "$INSTANCE" ]; then
  echo "Usage: bash deploy/ship.sh <instance> [--skip-build] [--web-only] [--yes]"
  echo "Instances:"; ls "$REPO_ROOT/deploy/instances/"*.env | xargs -n1 basename | sed 's/\.env//; s/^/  - /'
  exit 1
fi

ENV_FILE="$REPO_ROOT/deploy/instances/$INSTANCE.env"
if [ ! -f "$ENV_FILE" ]; then
  err "Instance config not found: $ENV_FILE"
  exit 1
fi
# shellcheck disable=SC1090
source "$ENV_FILE"
: "${VPS_HOST:?VPS_HOST missing in $ENV_FILE}"
: "${VPS_USER:?VPS_USER missing in $ENV_FILE}"
: "${APP_DIR:=/opt/fueld}"

OUT="/tmp/fueld-ship-$$"
mkdir -p "$OUT"
trap 'rm -rf "$OUT"' EXIT

cd "$REPO_ROOT"

# ─── 1. Build ─────────────────────────────────────────────────────────
if [ "$SKIP_BUILD" = false ]; then
  log "Building API binary (bun-linux-x64)…"
  (cd apps/api && bun build src/index.ts --compile --minify --target=bun-linux-x64 --outfile app-release)

  log "Building web bundle…"
  (cd apps/web && bunx ng build --configuration production)
else
  warn "Skipping build (--skip-build) — using existing artifacts"
fi

# ─── 2. Package ───────────────────────────────────────────────────────
log "Packaging payloads…"
gzip -9 -c apps/api/app-release > "$OUT/app-release.gz"
# The Angular builder nests browser/ under outputPath; deploy.sh expects the
# tarball to CONTAIN browser/ (it flattens double-nesting defensively).
COPYFILE_DISABLE=1 tar -C apps/web/dist/web/browser -czf "$OUT/web-browser.tar.gz" .
COPYFILE_DISABLE=1 tar -C apps/api/drizzle -czf "$OUT/drizzle.tar.gz" .

APP_VERSION=$(cat VERSION)
GIT_SHA=$(git rev-parse HEAD)
DEPLOY_VERSION="${APP_VERSION}+deploy.manual.sha.$(git rev-parse --short HEAD)"
APP_VERSION="$APP_VERSION" GIT_SHA="$GIT_SHA" GIT_BRANCH="$(git rev-parse --abbrev-ref HEAD)" \
  DEPLOY_VERSION="$DEPLOY_VERSION" bun run build:meta
cp build-info.json "$OUT/build-info.json"

# Checksum manifest (verified server-side by deploy.sh before applying)
(
  cd "$OUT"
  if [ "$WEB_ONLY" = true ]; then
    sha256sum web-browser.tar.gz build-info.json > MANIFEST.sha256
  else
    sha256sum app-release.gz web-browser.tar.gz drizzle.tar.gz build-info.json > MANIFEST.sha256
  fi
)
log "Manifest:"
sed 's/^/    /' "$OUT/MANIFEST.sha256"

# ─── 3. Confirm ───────────────────────────────────────────────────────
MODE="full (blue/green)"
[ "$WEB_ONLY" = true ] && MODE="frontend-only"
echo ""
echo "Deploy to:  $INSTANCE ($DOMAIN, $VPS_HOST)"
echo "Mode:       $MODE"
echo "Version:    $DEPLOY_VERSION"
if [ "$ASSUME_YES" = false ]; then
  read -r -p "Proceed? [y/N] " answer
  case "$answer" in [yY]|[yY][eE][sS]) ;; *) echo "Aborted."; exit 0 ;; esac
fi

# ─── 4. Upload ────────────────────────────────────────────────────────
log "Uploading payload to $VPS_HOST…"
ssh "$VPS_USER@$VPS_HOST" "mkdir -p $APP_DIR/staging"
if [ "$WEB_ONLY" = true ]; then
  # Frontend-only: do NOT upload the binary — deploy.sh promotes the web
  # payload without touching the running API.
  scp -q "$OUT/web-browser.tar.gz" "$VPS_USER@$VPS_HOST:$APP_DIR/staging/web-browser.tar.gz"
  scp -q "$OUT/build-info.json"  "$VPS_USER@$VPS_HOST:$APP_DIR/staging/build-info.json"
else
  scp -q "$OUT/app-release.gz"   "$VPS_USER@$VPS_HOST:$APP_DIR/staging/app-release.gz"
  scp -q "$OUT/web-browser.tar.gz" "$VPS_USER@$VPS_HOST:$APP_DIR/staging/web-browser.tar.gz"
  scp -q "$OUT/drizzle.tar.gz"   "$VPS_USER@$VPS_HOST:$APP_DIR/staging/drizzle.tar.gz"
  scp -q "$OUT/build-info.json"  "$VPS_USER@$VPS_HOST:$APP_DIR/staging/build-info.json"
fi
scp -q "$REPO_ROOT/deploy/deploy.sh" "$VPS_USER@$VPS_HOST:$APP_DIR/staging/deploy.sh"
log "Payload uploaded"

# ─── 5. Pre-deploy DB checks ──────────────────────────────────────────
log "Checking document_type enum (broker-confirmation support)…"
ssh "$VPS_USER@$VPS_HOST" "DBURL=\$(grep '^DATABASE_URL' $APP_DIR/.env | cut -d= -f2-); psql \"\$DBURL\" -t -A -c \"select 'BROKER_CONFIRMATION' = any(enum_range(null::document_type));\"" > /tmp/enum-check.$$
if [ "$(cat /tmp/enum-check.$$)" != "true" ]; then
  log "Adding missing BROKER_CONFIRMATION enum value…"
  ssh "$VPS_USER@$VPS_HOST" "DBURL=\$(grep '^DATABASE_URL' $APP_DIR/.env | cut -d= -f2-); psql \"\$DBURL\" -c \"ALTER TYPE document_type ADD VALUE IF NOT EXISTS 'BROKER_CONFIRMATION';\""
  log "Enum fixed ✓"
else
  log "Enum ok ✓"
fi
rm -f /tmp/enum-check.$$

# ─── 6. Deploy ────────────────────────────────────────────────────────
log "Running deploy.sh on $VPS_HOST…"
ssh "$VPS_USER@$VPS_HOST" "APP_DIR='$APP_DIR' bash $APP_DIR/staging/deploy.sh"

# ─── 7. Verify ────────────────────────────────────────────────────────
log "Verifying…"
DOMAIN_URL="https://$DOMAIN"
if [ "$DOMAIN_URL" != "https://" ]; then
  curl -sf -m 10 "$DOMAIN_URL/api/health" | python3 -c 'import sys,json; d=json.load(sys.stdin)["data"]; print("  health:", d["status"], "|", d["deployVersion"])' \
    || warn "Could not verify $DOMAIN_URL/api/health from this machine"
fi
log "Done ✓"