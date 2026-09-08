#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════
#  Fueld Blue-Green Deploy Script
#  Run on VPS by GitHub Actions, or manually after uploading a payload.
#
#  Payload (in $APP_DIR/staging/):
#    app-release.gz      optional — API binary (skips slot ops when absent)
#    web-browser.tar.gz  optional — frontend build
#    drizzle.tar.gz      optional — migration files (applied only together
#                                   with the binary — the API runs them on
#                                   startup; applying DB changes without the
#                                   matching binary can break the running one)
#    build-info.json     optional — build metadata
#    MANIFEST.sha256     optional — sha256sum -c checksums for the payload
#
#  Modes:
#    binary + web  → full blue/green deploy
#    binary only   → blue/green deploy (backend only)
#    web only      → frontend promotion only (no slot ops, no nginx switch)
# ═══════════════════════════════════════════════════════════════════════
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/fueld}"
APP_LLM_DIR="${APP_DIR}/llm"
APP_PROMPTS_DIR="${APP_DIR}/prompts"
STAGING="$APP_DIR/staging"
HEALTH_TIMEOUT=15   # seconds to wait for health check
HEALTH_RETRIES=5

# ─── Colors ───────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() { echo -e "${GREEN}▶${NC} $1"; }
warn() { echo -e "${YELLOW}⚠${NC} $1"; }
err() { echo -e "${RED}✖${NC} $1"; }

# ─── 0. Payload checksum verification (before applying anything) ─────
# MANIFEST.sha256 is a `sha256sum -c` file listing every payload file. A
# missing, extra-corrupt, or hash-mismatched file aborts the deploy before
# any payload file is consumed. This is the guard against truncated/mixed-up
# uploads — today's failure mode.
MANIFEST="$STAGING/MANIFEST.sha256"
if [ -f "$MANIFEST" ]; then
  log "Verifying payload checksums against MANIFEST.sha256…"
  if (cd "$STAGING" && sha256sum --quiet -c MANIFEST.sha256 >/dev/null 2>&1); then
    log "Payload verified ✓"
  else
    err "Payload checksum verification FAILED — deploy aborted, nothing applied."
    err "Details:"
    (cd "$STAGING" && sha256sum -c MANIFEST.sha256) || true
    exit 1
  fi
else
  warn "No MANIFEST.sha256 in staging/ — skipping checksum verification (generate one when packaging)"
fi

# ─── Prepare archived deploy payloads ───────────────────────────────
if [ -f "$STAGING/app-release.gz" ]; then
  log "Extracting API binary archive..."
  gzip -dc "$STAGING/app-release.gz" > "$STAGING/app-release"
  chmod +x "$STAGING/app-release"
  rm -f "$STAGING/app-release.gz"
fi

if [ -f "$STAGING/drizzle.tar.gz" ]; then
  log "Extracting migration archive..."
  rm -rf "$STAGING/drizzle"
  mkdir -p "$STAGING/drizzle"
  tar -xzf "$STAGING/drizzle.tar.gz" -C "$STAGING/drizzle"
  rm -f "$STAGING/drizzle.tar.gz"
fi

if [ -f "$STAGING/web-browser.tar.gz" ]; then
  log "Extracting frontend archive..."
  rm -rf "$STAGING/web"
  mkdir -p "$STAGING/web"
  tar -xzf "$STAGING/web-browser.tar.gz" -C "$STAGING/web"
  rm -f "$STAGING/web-browser.tar.gz"
fi

# ─── Detect payload contents ─────────────────────────────────────────
HAS_BINARY=false
HAS_WEB=false
HAS_DRIZZLE=false
[ -f "$STAGING/app-release" ] && HAS_BINARY=true
[ -d "$STAGING/web/browser" ] && HAS_WEB=true
[ -d "$STAGING/drizzle" ] && HAS_DRIZZLE=true

if [ "$HAS_BINARY" = false ] && [ "$HAS_WEB" = false ]; then
  err "Nothing to deploy — staging/ contains no app-release or web payload."
  err "Contents of staging/:"
  ls -la "$STAGING" | head -20
  exit 1
fi

# Migrations travel with the binary (the API applies them on startup).
# Applying DB migrations without the matching binary can break the
# currently-running old binary — so they wait for the next full deploy.
if [ "$HAS_DRIZZLE" = true ] && [ "$HAS_BINARY" = false ]; then
  warn "Migration files present without a new binary — skipping migrations (applied on next full deploy)"
  HAS_DRIZZLE=false
fi

# Promote the frontend into $APP_DIR/web (shared by both deploy modes).
promote_frontend() {
  # Guard: detect and fix double-nested browser/browser/browser/ directory
  # The expected structure is staging/web/browser/index.html (nginx root = /opt/fueld/web/browser)
  if [ -d "$STAGING/web/browser/browser" ] && [ -f "$STAGING/web/browser/browser/index.html" ] && [ ! -f "$STAGING/web/browser/index.html" ]; then
    warn "Detected double-nested browser/browser/browser/ — flattening..."
    mv "$STAGING/web/browser/browser" "$STAGING/web/browser-flat"
    cp -a "$STAGING/web/browser-flat/"* "$STAGING/web/browser/" 2>/dev/null || true
    rm -rf "$STAGING/web/browser-flat"
    log "Double-nested directory flattened"
  fi

  # Guard: verify index.html exists in browser/ before promoting
  if [ ! -f "$STAGING/web/browser/index.html" ]; then
    err "index.html not found in frontend build — aborting frontend promotion"
    err "Contents of staging/web:"
    ls -la "$STAGING/web/" | head -20
    exit 1
  fi

  rm -rf "$APP_DIR/web"
  mv "$STAGING/web" "$APP_DIR/web"
  log "Frontend deployed"
}

# ─── Web-only deploy: promote frontend, leave slots/nginx untouched ──
if [ "$HAS_BINARY" = false ]; then
  log "Web-only payload detected — promoting frontend (API unchanged, no slot ops)"
  promote_frontend
  rm -rf "$STAGING"
  echo ""
  log "═══════════════════════════════════════════════════════════"
  log "  ✅ Frontend deploy complete (running API untouched)"
  log "═══════════════════════════════════════════════════════════"
  exit 0
fi

# ═══════════════════════════════════════════════════════════════════════
#  Full blue/green deploy (binary present)
# ═══════════════════════════════════════════════════════════════════════

# ─── Determine slots ─────────────────────────────────────────────────
ACTIVE_SLOT=$(cat "$APP_DIR/active-slot" 2>/dev/null || echo "blue")
if [ "$ACTIVE_SLOT" = "blue" ]; then
  NEXT_SLOT="green"
  NEXT_PORT=3001
  ACTIVE_PORT=3000
else
  NEXT_SLOT="blue"
  NEXT_PORT=3000
  ACTIVE_PORT=3001
fi

log "Current active: ${ACTIVE_SLOT} (port ${ACTIVE_PORT})"
log "Deploying to:   ${NEXT_SLOT} (port ${NEXT_PORT})"

# ─── 1. Deploy migration files ───────────────────────────────────────
if [ "$HAS_DRIZZLE" = true ]; then
  log "Updating migration files..."
  rm -rf "$APP_DIR/drizzle"
  mv "$STAGING/drizzle" "$APP_DIR/drizzle"
  log "Migration files updated"
fi

# ─── 2. Deploy backend binary ────────────────────────────────────────
log "Deploying backend binary to ${NEXT_SLOT}..."
mkdir -p "$APP_DIR/$NEXT_SLOT"
mv "$STAGING/app-release" "$APP_DIR/$NEXT_SLOT/app-release"
chmod +x "$APP_DIR/$NEXT_SLOT/app-release"
log "Binary deployed to $APP_DIR/$NEXT_SLOT/"

# ─── 2b. Ensure LLM + prompts directories exist ──────────────────────
mkdir -p "$APP_DIR/llm/bin" "$APP_DIR/llm/models" "$APP_DIR/prompts"
log "LLM + prompts directories ensured"

# ─── 2c. Deploy build metadata ───────────────────────────────────────
if [ -f "$STAGING/build-info.json" ]; then
  mv "$STAGING/build-info.json" "$APP_DIR/build-info.json"
  log "Build metadata deployed"
fi

# Ensure sudoers is up-to-date (always run — covers apt-get, daemon-reload, etc.)
SUDOERS_LINE="deploy ALL=(ALL) NOPASSWD: /bin/systemctl restart fueld-api@*, /bin/systemctl start fueld-api@*, /bin/systemctl stop fueld-api@*, /bin/systemctl reload nginx, /bin/systemctl daemon-reload, /bin/systemctl status fueld-api@*, /bin/systemctl restart fueld-llm, /bin/systemctl start fueld-llm, /bin/systemctl stop fueld-llm, /usr/sbin/nginx -t, /usr/bin/tee, /bin/systemctl reset-failed *, /usr/bin/apt-get"
echo "$SUDOERS_LINE" | sudo tee /etc/sudoers.d/fueld-deploy > /dev/null

# Install PostgreSQL client tools needed for backup/export/restore (idempotent)
if ! command -v pg_dump &>/dev/null || ! command -v psql &>/dev/null; then
  log "Installing PostgreSQL client tools for backup/export/restore..."
  sudo apt-get update -qq || warn "Could not refresh apt package index (continuing)"
  sudo apt-get install -y -qq postgresql-client || warn "Could not install postgresql-client automatically"
fi

# Install PDF text extraction utility needed for Platts parsing (idempotent)
if ! command -v pdftotext &>/dev/null; then
  log "Installing poppler-utils for Platts PDF parsing..."
  sudo apt-get update -qq || warn "Could not refresh apt package index (continuing)"
  sudo apt-get install -y -qq poppler-utils || warn "Could not install poppler-utils automatically"
fi

# Install build tools needed for 'build from source' (idempotent)
if ! command -v cmake &>/dev/null || ! command -v g++ &>/dev/null; then
  log "Installing cmake, g++, make for LLM build-from-source..."
  sudo apt-get install -y -qq cmake g++ make || warn "Could not install build tools (non-fatal)"
fi

# ─── 2d. Patch systemd unit ReadWritePaths if missing dirs ───────────
UNIT_FILE="/etc/systemd/system/fueld-api@.service"
NEED_RELOAD=false
if [ -f "$UNIT_FILE" ]; then
  if ! grep -q "$APP_LLM_DIR" "$UNIT_FILE"; then
    log "Patching systemd unit to add ${APP_LLM_DIR} to ReadWritePaths..."
    PATCHED=$(sed "s|ReadWritePaths=\\(.*\\)/tmp|ReadWritePaths=\\1${APP_LLM_DIR} /tmp|" "$UNIT_FILE")
    echo "$PATCHED" | sudo tee "$UNIT_FILE" > /dev/null
    NEED_RELOAD=true
  fi
  if ! grep -q "$APP_PROMPTS_DIR" "$UNIT_FILE"; then
    log "Patching systemd unit to add ${APP_PROMPTS_DIR} to ReadWritePaths..."
    PATCHED=$(sed "s|ReadWritePaths=\\(.*\\)/tmp|ReadWritePaths=\\1${APP_PROMPTS_DIR} /tmp|" "$UNIT_FILE")
    echo "$PATCHED" | sudo tee "$UNIT_FILE" > /dev/null
    NEED_RELOAD=true
  fi
  if [ "$NEED_RELOAD" = true ]; then
    sudo systemctl daemon-reload
    log "Systemd unit patched and reloaded"
  fi
fi

# ─── 3. Start new slot ───────────────────────────────────────────────
log "Starting fueld-api@${NEXT_SLOT}..."
sudo systemctl stop "fueld-api@${NEXT_SLOT}" 2>/dev/null || true
sudo systemctl reset-failed "fueld-api@${NEXT_SLOT}" 2>/dev/null || true
sudo systemctl start "fueld-api@${NEXT_SLOT}"
sleep 2

if ! systemctl is-active --quiet "fueld-api@${NEXT_SLOT}"; then
  err "${NEXT_SLOT} failed to start"
  systemctl status "fueld-api@${NEXT_SLOT}" --no-pager || true
  echo "--- journalctl output ---"
  journalctl -u "fueld-api@${NEXT_SLOT}" -n 50 --no-pager || true
  exit 1
fi

# ─── 4. Health check new slot ────────────────────────────────────────
log "Health checking ${NEXT_SLOT} on port ${NEXT_PORT}..."
HEALTHY=false
for i in $(seq 1 $HEALTH_RETRIES); do
  if curl -sf "http://127.0.0.1:${NEXT_PORT}/health" > /dev/null 2>&1; then
    HEALTHY=true
    break
  fi
  warn "Attempt $i/$HEALTH_RETRIES failed, retrying in 2s..."
  sleep 2
done

if [ "$HEALTHY" = false ]; then
  err "Health check failed for ${NEXT_SLOT}! Rolling back..."
  journalctl -u "fueld-api@${NEXT_SLOT}" -n 80 --no-pager || true
  sudo systemctl stop "fueld-api@${NEXT_SLOT}" 2>/dev/null || true
  err "Deploy aborted. Active slot (${ACTIVE_SLOT}) unchanged."
  exit 1
fi

log "Health check passed ✓"

# ─── 5. Promote frontend after API health passes ─────────────────────
if [ "$HAS_WEB" = true ]; then
  log "Promoting frontend after healthy API start..."
  promote_frontend
fi

# ─── 6. Switch nginx upstream ────────────────────────────────────────
log "Switching nginx upstream to port ${NEXT_PORT}..."
sudo tee /etc/nginx/conf.d/fueld-upstream.conf >/dev/null <<EOF
upstream fueld_api {
    server 127.0.0.1:${NEXT_PORT};
}
EOF
sudo nginx -t && sudo systemctl reload nginx
log "Nginx switched to ${NEXT_SLOT}"

# ─── 7. Update active slot ───────────────────────────────────────────
echo "$NEXT_SLOT" > "$APP_DIR/active-slot"
log "Active slot updated to ${NEXT_SLOT}"

# ─── 8. Stop old slot ────────────────────────────────────────────────
log "Stopping old slot (${ACTIVE_SLOT})..."
sudo systemctl stop "fueld-api@${ACTIVE_SLOT}" 2>/dev/null || true
log "Old slot stopped"

# ─── 9. Cleanup staging ──────────────────────────────────────────────
rm -rf "$STAGING"

echo ""
log "═══════════════════════════════════════════════════════════"
log "  ✅ Deploy complete! Active: ${NEXT_SLOT} (port ${NEXT_PORT})"
log "═══════════════════════════════════════════════════════════"