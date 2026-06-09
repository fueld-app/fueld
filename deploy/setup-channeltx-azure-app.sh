#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════
#  Azure AD App Registration Setup — ChannelTx Fueld
# ═══════════════════════════════════════════════════════════════════════
#
#  Creates a dedicated Microsoft Entra ID app registration for the
#  channeltx.fueld.app tenant with all required permissions.
#
#  Prerequisites:
#    - az CLI installed and logged in (az login)
#    - You have Application Administrator or Global Administrator role
#
#  Usage:
#    chmod +x deploy/setup-channeltx-azure-app.sh
#    ./deploy/setup-channeltx-azure-app.sh
# ═══════════════════════════════════════════════════════════════════════

set -euo pipefail

# ── Configuration ──────────────────────────────────────────────────────
TENANT_NAME="channeltx"
DOMAIN="channeltx.fueld.app"
REDIRECT_URI="https://${DOMAIN}/api/auth/microsoft/callback"
APP_DISPLAY_NAME="Fueld — ${TENANT_NAME}"
SECRET_DISPLAY_NAME="fueld-production"
SECRET_EXPIRY_YEARS=2

# Microsoft Graph API IDs
GRAPH_API_ID="00000003-0000-0000-c000-000000000000"
USER_READ_PERMISSION="e1fe6dd8-ba31-4d61-89e7-88639da4683d"   # User.Read
MAIL_SEND_PERMISSION="e383f46e-2787-4529-8551-86ec2b8b75c4"   # Mail.Send

echo ""
echo "═══════════════════════════════════════════════════════════════════════"
echo "  Creating Azure AD App Registration for ${TENANT_NAME}"
echo "═══════════════════════════════════════════════════════════════════════"
echo ""

# ── 1. Create the app registration ───────────────────────────────────
echo "→ Step 1/5: Creating app registration..."
APP_JSON=$(az ad app create \
  --display-name "$APP_DISPLAY_NAME" \
  --sign-in-audience AzureADMyOrg \
  --web-redirect-uris "$REDIRECT_URI" \
  --enable-id-token-issuance true \
  --enable-access-token-issuance true \
  --query '{appId: appId, objectId: id, publisherDomain: publisherDomain}' \
  -o json)

APP_ID=$(echo "$APP_JSON" | jq -r '.appId')
OBJECT_ID=$(echo "$APP_JSON" | jq -r '.objectId')
PUBLISHER_DOMAIN=$(echo "$APP_JSON" | jq -r '.publisherDomain')

echo "   ✓ App created"
echo "   App ID (Client ID):     $APP_ID"
echo "   Object ID:              $OBJECT_ID"
echo "   Publisher Domain:       $PUBLISHER_DOMAIN"
echo ""

# ── 2. Add Microsoft Graph API permissions ───────────────────────────
echo "→ Step 2/5: Adding Microsoft Graph API permissions..."

# User.Read (openid + profile + sign-in)
az ad app permission add \
  --id "$APP_ID" \
  --api "$GRAPH_API_ID" \
  --api-permissions "${USER_READ_PERMISSION}=Scope" \
  --only-show-errors

echo "   ✓ User.Read (openid + profile)"

# Mail.Send (send email via Microsoft Graph)
az ad app permission add \
  --id "$APP_ID" \
  --api "$GRAPH_API_ID" \
  --api-permissions "${MAIL_SEND_PERMISSION}=Scope" \
  --only-show-errors

echo "   ✓ Mail.Send"
echo ""

# ── 3. Grant admin consent ───────────────────────────────────────────
echo "→ Step 3/5: Granting admin consent..."
echo "   (This requires Global Admin or Application Admin role)"

# Wait a moment for permissions to propagate
sleep 2

az ad app permission admin-consent \
  --id "$APP_ID" \
  --only-show-errors

echo "   ✓ Admin consent granted"
echo ""

# ── 4. Create client secret ──────────────────────────────────────────
echo "→ Step 4/5: Creating client secret..."

END_DATE=$(date -v+${SECRET_EXPIRY_YEARS}y +%Y-%m-%d 2>/dev/null || date -d "+${SECRET_EXPIRY_YEARS} years" +%Y-%m-%d)

SECRET_JSON=$(az ad app credential reset \
  --id "$APP_ID" \
  --display-name "$SECRET_DISPLAY_NAME" \
  --end-date "$END_DATE" \
  --query '{keyId: keyId, secret: password}' \
  -o json)

SECRET_KEY_ID=$(echo "$SECRET_JSON" | jq -r '.keyId')
SECRET_VALUE=$(echo "$SECRET_JSON" | jq -r '.secret')

echo "   ✓ Client secret created"
echo "   Secret Key ID:  $SECRET_KEY_ID"
echo "   Expires:        $END_DATE"
echo ""

# ── 5. Get tenant ID ─────────────────────────────────────────────────
echo "→ Step 5/5: Retrieving Azure AD tenant ID..."

AZURE_TENANT_ID=$(az account show --query tenantId -o tsv)

echo "   ✓ Tenant ID: $AZURE_TENANT_ID"
echo ""

# ── Summary ──────────────────────────────────────────────────────────
echo "═══════════════════════════════════════════════════════════════════════"
echo "  ✅ Azure AD App Registration Complete"
echo "═══════════════════════════════════════════════════════════════════════"
echo ""
echo "  App Name:           $APP_DISPLAY_NAME"
echo "  App ID (Client ID): $APP_ID"
echo "  Tenant ID:          $AZURE_TENANT_ID"
echo "  Redirect URI:       $REDIRECT_URI"
echo ""
echo "  ── Enter these in Fueld Admin → Integrations ──"
echo ""
echo "  Client ID:     $APP_ID"
echo "  Client Secret: $SECRET_VALUE"
echo "  Tenant ID:     $AZURE_TENANT_ID"
echo ""
echo "  ⚠️  IMPORTANT: The client secret is shown ONLY ONCE."
echo "     Save it in your password manager immediately."
echo "     If lost, run: az ad app credential reset --id $APP_ID"
echo ""
echo "  ── Next steps ──"
echo ""
echo "  1. Log in to https://$DOMAIN as an admin"
echo "  2. Go to Admin → Integrations → Microsoft 365 / Entra ID"
echo "  3. Enter the Client ID, Client Secret, and Tenant ID above"
echo "  4. Go to Admin → Security → SSO Provider"
echo "  5. Select 'Microsoft Entra ID (Azure AD)' and enable SSO"
echo "  6. (Optional) Set approved email domains"
echo "  7. Test: log out and click 'Sign in with Microsoft'"
echo ""
echo "═══════════════════════════════════════════════════════════════════════"

# ── Save to file for reference ───────────────────────────────────────
OUTPUT_FILE="deploy/instances/channeltx-azure-credentials.txt"
mkdir -p "$(dirname "$OUTPUT_FILE")"

cat > "$OUTPUT_FILE" <<EOF
# Fueld Azure AD Credentials — ChannelTx
# Generated: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
# App Name: $APP_DISPLAY_NAME
#
# ⚠️  KEEP THIS FILE SECURE — contains client secret
#
AZURE_APP_ID=$APP_ID
AZURE_TENANT_ID=$AZURE_TENANT_ID
AZURE_CLIENT_SECRET=$SECRET_VALUE
AZURE_REDIRECT_URI=$REDIRECT_URI
EOF

echo "  📄 Credentials saved to: $OUTPUT_FILE"
echo "     (gitignored — do not commit to repo)"
echo ""
