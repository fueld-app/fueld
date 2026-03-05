#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════
#  Fueld Blue-Green Deploy Script
#  Run on VPS by GitHub Actions: bash deploy.sh
# ═══════════════════════════════════════════════════════════════════════
set -euo pipefail

APP_DIR="/opt/fueld"
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

# ─── 1. Deploy frontend ──────────────────────────────────────────────
if [ -d "$APP_DIR/staging/web" ]; then
  log "Deploying frontend..."
  rm -rf "$APP_DIR/web"
  mv "$APP_DIR/staging/web" "$APP_DIR/web"
  log "Frontend deployed"
fi

# ─── 2. Deploy migration files ───────────────────────────────────────
if [ -d "$APP_DIR/staging/drizzle" ]; then
  log "Updating migration files..."
  rm -rf "$APP_DIR/drizzle"
  mv "$APP_DIR/staging/drizzle" "$APP_DIR/drizzle"
  log "Migration files updated"
fi

# ─── 3. Deploy backend binary ────────────────────────────────────────
if [ -f "$APP_DIR/staging/app-release" ]; then
  log "Deploying backend binary to ${NEXT_SLOT}..."
  mkdir -p "$APP_DIR/$NEXT_SLOT"
  mv "$APP_DIR/staging/app-release" "$APP_DIR/$NEXT_SLOT/app-release"
  chmod +x "$APP_DIR/$NEXT_SLOT/app-release"
  log "Binary deployed to $APP_DIR/$NEXT_SLOT/"
else
  err "No binary found at $APP_DIR/staging/app-release"
  exit 1
fi

# ─── 3b. Ensure LLM directories exist ─────────────────────────────────
mkdir -p "$APP_DIR/llm/bin" "$APP_DIR/llm/models"
log "LLM directories ensured"

# ─── 3c. Patch systemd unit if ReadWritePaths is missing /opt/fueld/llm ─
UNIT_FILE="/etc/systemd/system/fueld-api@.service"
if [ -f "$UNIT_FILE" ] && ! grep -q '/opt/fueld/llm' "$UNIT_FILE"; then
  log "Patching systemd unit to add /opt/fueld/llm to ReadWritePaths..."

  # Ensure sudoers allows daemon-reload (sudo tee is already allowed generically)
  log "Ensuring sudoers allows daemon-reload..."
  echo "deploy ALL=(ALL) NOPASSWD: /bin/systemctl restart fueld-api@*, /bin/systemctl start fueld-api@*, /bin/systemctl stop fueld-api@*, /bin/systemctl reload nginx, /bin/systemctl daemon-reload, /bin/systemctl status fueld-api@*, /bin/systemctl restart fueld-llm, /bin/systemctl start fueld-llm, /bin/systemctl stop fueld-llm, /usr/sbin/nginx -t, /usr/bin/tee, /bin/systemctl reset-failed *" | sudo tee /etc/sudoers.d/fueld-deploy > /dev/null

  # Patch the unit file (read into variable first to avoid read/write race on same file)
  PATCHED=$(sed 's|ReadWritePaths=\(.*\)/tmp|ReadWritePaths=\1/opt/fueld/llm /tmp|' "$UNIT_FILE")
  echo "$PATCHED" | sudo tee "$UNIT_FILE" > /dev/null
  sudo systemctl daemon-reload
  log "Systemd unit patched and reloaded"
fi

# ─── 4. Start new slot ───────────────────────────────────────────────
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

# ─── 5. Health check new slot ────────────────────────────────────────
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
rm -rf "$APP_DIR/staging"

echo ""
log "═══════════════════════════════════════════════════════════"
log "  ✅ Deploy complete! Active: ${NEXT_SLOT} (port ${NEXT_PORT})"
log "═══════════════════════════════════════════════════════════"
