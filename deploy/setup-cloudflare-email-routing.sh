#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════
#  Cloudflare Email Routing — Catch-All Setup for fueld.app
# ═══════════════════════════════════════════════════════════════════════
#
#  Sets up a catch-all email routing rule that forwards all emails
#  sent to any address @fueld.app to patrick@pereira.dk
#
#  Prerequisites:
#    - Cloudflare API token with Zone:Read and Email Routing Rules:Edit
#    - fueld.app domain managed in Cloudflare
#
#  Usage:
#    export CF_API_TOKEN="your_token_here"
#    ./deploy/setup-cloudflare-email-routing.sh
# ═══════════════════════════════════════════════════════════════════════

set -euo pipefail

# ── Configuration ──────────────────────────────────────────────────────
DOMAIN="fueld.app"
DESTINATION_EMAIL="patrick@pereira.dk"
CATCH_ALL_PATTERN="*"

# ── Validate API token ───────────────────────────────────────────────
if [ -z "${CF_API_TOKEN:-}" ]; then
  echo "❌ CF_API_TOKEN environment variable is required"
  echo ""
  echo "   Get your token from: https://dash.cloudflare.com/profile/api-tokens"
  echo "   Required permissions: Zone:Read, Email Routing Rules:Edit"
  echo ""
  echo "   Then run:"
  echo "     export CF_API_TOKEN=your_token"
  echo "     $0"
  echo ""
  exit 1
fi

echo ""
echo "═══════════════════════════════════════════════════════════════════════"
echo "  Cloudflare Email Routing Setup — ${DOMAIN}"
echo "═══════════════════════════════════════════════════════════════════════"
echo ""

# ── Step 1: Get Zone ID ────────────────────────────────────────────
echo "→ Step 1/4: Looking up zone ID for ${DOMAIN}..."

ZONE_RESPONSE=$(curl -s -X GET \
  "https://api.cloudflare.com/client/v4/zones?name=${DOMAIN}" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json")

ZONE_ID=$(echo "$ZONE_RESPONSE" | jq -r '.result[0].id // empty')
ZONE_STATUS=$(echo "$ZONE_RESPONSE" | jq -r '.result[0].status // empty')

if [ -z "$ZONE_ID" ] || [ "$ZONE_ID" = "null" ]; then
  echo ""
  echo "❌ Could not find zone for ${DOMAIN}"
  echo ""
  echo "   Possible issues:"
  echo "   - Domain is not in this Cloudflare account"
  echo "   - API token doesn't have Zone:Read permission"
  echo "   - Token is for a different account"
  echo ""
  echo "   API response:"
  echo "$ZONE_RESPONSE" | jq '.'
  echo ""
  exit 1
fi

echo "   ✓ Zone ID: ${ZONE_ID}"
echo "   ✓ Zone status: ${ZONE_STATUS}"
echo ""

# ── Step 2: Check Email Routing status ─────────────────────────────
echo "→ Step 2/4: Checking Email Routing status..."

ROUTING_STATUS=$(curl -s -X GET \
  "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/email/routing" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json")

ROUTING_ENABLED=$(echo "$ROUTING_STATUS" | jq -r '.result.enabled // false')
ROUTING_STATUS_TEXT=$(echo "$ROUTING_STATUS" | jq -r '.result.status // "unknown"')

echo "   Current status: ${ROUTING_STATUS_TEXT}"
echo "   Enabled: ${ROUTING_ENABLED}"
echo ""

# Enable email routing if not already enabled
if [ "$ROUTING_ENABLED" != "true" ]; then
  echo "   → Enabling Email Routing..."
  
  ENABLE_RESPONSE=$(curl -s -X POST \
    "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/email/routing/enable" \
    -H "Authorization: Bearer ${CF_API_TOKEN}" \
    -H "Content-Type: application/json")
  
  if echo "$ENABLE_RESPONSE" | jq -e '.success' > /dev/null 2>&1; then
    echo "   ✓ Email Routing enabled"
  else
    echo "   ⚠️  Could not enable automatically. You may need to do this in the dashboard:"
    echo "      https://dash.cloudflare.com → ${DOMAIN} → Email → Email Routing"
    echo ""
    echo "   API response:"
    echo "$ENABLE_RESPONSE" | jq '.'
    echo ""
  fi
  echo ""
fi

# ── Step 3: Create destination address ─────────────────────────────
echo "→ Step 3/4: Setting up destination address ${DESTINATION_EMAIL}..."

# Check if destination already exists
DESTINATIONS=$(curl -s -X GET \
  "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/email/routing/addresses" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json")

DEST_EXISTS=$(echo "$DESTINATIONS" | jq -r --arg email "$DESTINATION_EMAIL" \
  '.result[] | select(.email == $email) | .id' 2>/dev/null || true)

if [ -n "$DEST_EXISTS" ] && [ "$DEST_EXISTS" != "null" ]; then
  echo "   ✓ Destination address already exists: ${DESTINATION_EMAIL}"
else
  echo "   → Creating destination address..."
  
  CREATE_DEST=$(curl -s -X POST \
    "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/email/routing/addresses" \
    -H "Authorization: Bearer ${CF_API_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "{
      \"email\": \"${DESTINATION_EMAIL}\"
    }")
  
  if echo "$CREATE_DEST" | jq -e '.success' > /dev/null 2>&1; then
    echo "   ✓ Destination address created: ${DESTINATION_EMAIL}"
    echo ""
    echo "   ⚠️  IMPORTANT: Check ${DESTINATION_EMAIL} for a verification email"
    echo "      from Cloudflare and click the verification link."
    echo "      The catch-all won't work until the address is verified."
  else
    echo "   ⚠️  Could not create destination address"
    echo ""
    echo "   API response:"
    echo "$CREATE_DEST" | jq '.'
    echo ""
  fi
fi

echo ""

# ── Step 4: Create catch-all routing rule ──────────────────────────
echo "→ Step 4/4: Creating catch-all routing rule..."

# Check if catch-all rule already exists
RULES=$(curl -s -X GET \
  "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/email/routing/rules" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json")

CATCH_ALL_EXISTS=$(echo "$RULES" | jq -r \
  '.result[] | select(.matchers[0].type == "all") | .id' 2>/dev/null || true)

if [ -n "$CATCH_ALL_EXISTS" ] && [ "$CATCH_ALL_EXISTS" != "null" ]; then
  echo "   ℹ️  Catch-all rule already exists (ID: ${CATCH_ALL_EXISTS})"
  echo ""
  echo "   Updating to forward to ${DESTINATION_EMAIL}..."
  
  UPDATE_RULE=$(curl -s -X PUT \
    "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/email/routing/rules/${CATCH_ALL_EXISTS}" \
    -H "Authorization: Bearer ${CF_API_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "{
      \"name\": \"Catch-all to ${DESTINATION_EMAIL}\",
      \"enabled\": true,
      \"matchers\": [
        {
          \"type\": \"all\"
        }
      ],
      \"actions\": [
        {
          \"type\": \"forward\",
          \"value\": [\"${DESTINATION_EMAIL}\"]
        }
      ]
    }")
  
  if echo "$UPDATE_RULE" | jq -e '.success' > /dev/null 2>&1; then
    echo "   ✓ Catch-all rule updated"
  else
    echo "   ⚠️  Could not update rule"
    echo ""
    echo "   API response:"
    echo "$UPDATE_RULE" | jq '.'
  fi
else
  echo "   → Creating new catch-all rule..."
  
  CREATE_RULE=$(curl -s -X POST \
    "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/email/routing/rules" \
    -H "Authorization: Bearer ${CF_API_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "{
      \"name\": \"Catch-all to ${DESTINATION_EMAIL}\",
      \"enabled\": true,
      \"matchers\": [
        {
          \"type\": \"all\"
        }
      ],
      \"actions\": [
        {
          \"type\": \"forward\",
          \"value\": [\"${DESTINATION_EMAIL}\"]
        }
      ]
    }")
  
  if echo "$CREATE_RULE" | jq -e '.success' > /dev/null 2>&1; then
    echo "   ✓ Catch-all rule created"
  else
    echo "   ⚠️  Could not create rule"
    echo ""
    echo "   API response:"
    echo "$CREATE_RULE" | jq '.'
  fi
fi

echo ""

# ── Summary ──────────────────────────────────────────────────────────
echo "═══════════════════════════════════════════════════════════════════════"
echo "  ✅ Email Routing Setup Complete"
echo "═══════════════════════════════════════════════════════════════════════"
echo ""
echo "  Domain:           ${DOMAIN}"
echo "  Catch-all:        *@${DOMAIN}"
echo "  Forwards to:      ${DESTINATION_EMAIL}"
echo ""
echo "  ── Important ──"
echo ""
echo "  1. Check ${DESTINATION_EMAIL} for a Cloudflare verification email"
echo "     and click the verification link."
echo ""
echo "  2. Verify DNS records exist in Cloudflare:"
echo "     https://dash.cloudflare.com → ${DOMAIN} → DNS → Records"
echo ""
echo "     Required records (should be auto-created):"
echo "     • MX: route1.mx.cloudflare.net (priority 1)"
echo "     • MX: route2.mx.cloudflare.net (priority 2)"
echo "     • MX: route3.mx.cloudflare.net (priority 3)"
echo "     • TXT: v=spf1 include:_spf.mx.cloudflare.net ~all"
echo ""
echo "  3. Test by sending an email to test@${DOMAIN}"
echo ""
echo "  ── Manage in Dashboard ──"
echo ""
echo "  https://dash.cloudflare.com → ${DOMAIN} → Email → Email Routing → Routes"
echo ""
echo "═══════════════════════════════════════════════════════════════════════"
