#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════
#  Fueld Instance Version Checker
#  Queries /health on all known instances and prints a version table
# ═══════════════════════════════════════════════════════════════════════
set -euo pipefail

# ─── Instance definitions ─────────────────────────────────────────────
# Format: "NAME|DOMAIN"
INSTANCES=(
  "staging|staging.fueld.app"
  "riviera-marine|riviera-marine.fueld.app"
  "channeltx|channeltx.fueld.app"
)

# ─── Colors ───────────────────────────────────────────────────────────
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# ─── Print header ───────────────────────────────────────────────────────
printf "${BOLD}%-18s %-22s %-14s %-30s %-10s %-20s${NC}\n" \
  "Instance" "Deploy Version" "App Version" "Git SHA" "Status" "Built"
echo "─────────────────────────────────────────────────────────────────────────────────────────────────────────"

# ─── Query each instance ──────────────────────────────────────────────
for entry in "${INSTANCES[@]}"; do
  IFS='|' read -r name domain <<< "$entry"

  # Fetch health endpoint with timeout
  response=$(curl -sf --max-time 10 "https://${domain}/api/health" 2>/dev/null) || {
    printf "${RED}%-18s %-22s %-14s %-30s %-10s %-20s${NC}\n" \
      "$name" "—" "—" "—" "❌ DOWN" "—"
    continue
  }

  # Extract fields using jq (fallback to "?" if missing)
  appVersion=$(echo "$response" | jq -r '.appVersion // "?"')
  deployVersion=$(echo "$response" | jq -r '.deployVersion // "?"')
  gitSha=$(echo "$response" | jq -r '.gitSha // "?"')
  buildTime=$(echo "$response" | jq -r '.buildTime // "?"')
  status=$(echo "$response" | jq -r '.status // "?"')

  # Truncate SHA to 7 chars
  shortSha="${gitSha:0:7}"

  # Format build time (ISO → readable)
  if [[ "$buildTime" != "?" && "$buildTime" != "null" ]]; then
    readableTime=$(date -d "$buildTime" '+%Y-%m-%d %H:%M' 2>/dev/null || echo "$buildTime")
  else
    readableTime="?"
  fi

  # Color status
  if [[ "$status" == "ok" ]]; then
    statusCol="${GREEN}✅ OK${NC}"
  else
    statusCol="${YELLOW}⚠️  ${status}${NC}"
  fi

  printf "%-18s %-22s %-14s %-30s %-10b %-20s\n" \
    "$name" "$deployVersion" "$appVersion" "$shortSha" "$statusCol" "$readableTime"
done

echo "─────────────────────────────────────────────────────────────────────────────────────────────────────────"
echo ""
echo "Tip: Run with --json for raw output:  curl -s https://<domain>/api/health | jq ."
