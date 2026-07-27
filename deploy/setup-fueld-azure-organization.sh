#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════
#  Fueld Azure AD Organization — App Registration Setup
# ═══════════════════════════════════════════════════════════════════════
#
#  Creates separate Microsoft Entra ID app registrations for each Fueld
#  tenant within a dedicated Azure AD organization.
#
#  PREREQUISITE: You must first create the Azure AD tenant manually.
#  See STEP 0 below for instructions.
#
#  Usage:
#    chmod +x deploy/setup-fueld-azure-organization.sh
#    ./deploy/setup-fueld-azure-organization.sh <tenant-id>
# ═══════════════════════════════════════════════════════════════════════

set -euo pipefail

# ── Configuration ──────────────────────────────────────────────────────
FUELD_ORG_NAME="fueld"

# Tenants to create apps for
# Format: "tenant-name:domain"
# The script is idempotent — it skips tenants whose app registration
# already exists, so it is safe to re-run after adding new entries.
TENANTS=(
  "riviera-marine:riviera-marine.fueld.app"
  "channeltx:channeltx.fueld.app"
  "moxie:moxie.fueld.app"
)

# Microsoft Graph API IDs
GRAPH_API_ID="00000003-0000-0000-c000-000000000000"
USER_READ_PERMISSION="e1fe6dd8-ba31-4d61-89e7-88639da4683d"   # User.Read
MAIL_SEND_PERMISSION="e383f46e-2787-4529-8551-86ec2b8b75c4"   # Mail.Send

# ── Validate input ─────────────────────────────────────────────────────
if [ $# -lt 1 ]; then
  echo ""
  echo "═══════════════════════════════════════════════════════════════════════"
  echo "  ❌ Missing required argument: Azure AD Tenant ID"
  echo "═══════════════════════════════════════════════════════════════════════"
  echo ""
  echo "  Usage: $0 <tenant-id>"
  echo ""
  echo "  Example: $0 12345678-1234-1234-1234-123456789012"
  echo ""
  echo "  ── STEP 0: Create the Azure AD tenant (one-time) ──"
  echo ""
  echo "  Azure AD tenants cannot be created via CLI. Do this manually:"
  echo ""
  echo "  1. Go to https://portal.azure.com"
  echo "  2. Navigate to: Microsoft Entra ID → Manage tenants"
  echo "  3. Click '+ Create' → Microsoft Entra ID"
  echo "  4. Organization name: 'Fueld'"
  echo "  5. Initial domain name: 'fueld' (becomes fueld.onmicrosoft.com)"
  echo "  6. Country/Region: select your region"
  echo "  7. Click Create"
  echo ""
  echo "  8. After creation, go to the new tenant's Overview page"
  echo "  9. Copy the 'Tenant ID' (GUID format)"
  echo " 10. Create a Global Admin user for yourself in the new tenant"
  echo " 11. Log out and log back in to the new tenant"
  echo ""
  echo "  Then run this script with the tenant ID."
  echo ""
  exit 1
fi

TENANT_ID="$1"

echo ""
echo "═══════════════════════════════════════════════════════════════════════"
echo "  Fueld Azure AD Organization — App Registration Setup"
echo "═══════════════════════════════════════════════════════════════════════"
echo ""

# ── Step 1: Verify login to the target tenant ──────────────────────────
echo "→ Step 1/3: Verifying authentication to tenant ${TENANT_ID}..."

CURRENT_TENANT=$(az account show --query tenantId -o tsv 2>/dev/null || true)

if [ "$CURRENT_TENANT" != "$TENANT_ID" ]; then
  echo ""
  echo "   You need to log in to the Fueld tenant first."
  echo ""
  echo "   Run this command:"
  echo "     az login --tenant ${TENANT_ID} --allow-no-subscriptions"
  echo ""
  echo "   Then re-run this script."
  echo ""
  exit 1
fi

echo "   ✓ Authenticated to tenant ${TENANT_ID}"
echo ""

# ── Step 2: Create app registrations for each Fueld tenant ─────────────
echo "→ Step 2/3: Creating app registrations for each Fueld tenant..."
echo ""

mkdir -p deploy/instances
credentials_file="deploy/instances/fueld-azure-apps-credentials.txt"
created_count=0
skipped_count=0

# Only write a fresh credentials file header if the file doesn't already exist.
# This preserves existing credentials from prior runs (idempotency).
if [ ! -f "$credentials_file" ]; then
  cat > "$credentials_file" <<EOF
# Fueld Azure AD App Registrations
# Organization: ${FUELD_ORG_NAME}
# Tenant ID: ${TENANT_ID}
# Generated: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
#
# ⚠️  KEEP THIS FILE SECURE — contains client secrets
#     Do NOT commit to git. This file is gitignored by default.
#
EOF
fi

for tenant_config in "${TENANTS[@]}"; do
  IFS=':' read -r tenant_name domain <<< "$tenant_config"
  redirect_uri="https://${domain}/api/auth/microsoft/callback"
  app_name="Fueld — ${tenant_name}"
  env_var_prefix="${tenant_name//-/_}"

  # ── Idempotency check: skip if this app already exists ──
  existing_app_id=$(az ad app list \
    --filter "displayName eq '${app_name}'" \
    --query '[0].appId' \
    -o tsv 2>/dev/null || true)

  if [ -n "$existing_app_id" ] && [ "$existing_app_id" != "" ]; then
    echo "   ⏭   Skipping ${tenant_name} — app already exists (App ID: ${existing_app_id})"
    echo "      Existing credentials are preserved in ${credentials_file} (from prior run)."
    echo ""
    skipped_count=$((skipped_count + 1))
    continue
  fi

  echo "   Creating app for ${tenant_name} (${domain})..."

  # Create app (multi-tenant so any Microsoft work account can sign in)
  app_json=$(az ad app create \
    --display-name "$app_name" \
    --sign-in-audience AzureADMultipleOrgs \
    --web-redirect-uris "$redirect_uri" \
    --query '{appId: appId, objectId: id}' \
    -o json)

  app_id=$(echo "$app_json" | jq -r '.appId')
  object_id=$(echo "$app_json" | jq -r '.objectId')

  # Add permissions using modern API (requiredResourceAccess)
  az ad app update \
    --id "$app_id" \
    --required-resource-accesses '[{"resourceAppId":"00000003-0000-0000-c000-000000000000","resourceAccess":[{"id":"e1fe6dd8-ba31-4d61-89e7-88639da4683d","type":"Scope"},{"id":"e383f46e-2787-4529-8551-86ec2b8b75c4","type":"Scope"}]}]' \
    --only-show-errors

  # Grant admin consent
  sleep 2
  az ad app permission admin-consent --id "$app_id" --only-show-errors

  # Create client secret (2 year expiry)
  end_date=$(date -v+2y +%Y-%m-%d 2>/dev/null || date -d "+2 years" +%Y-%m-%d)
  secret_json=$(az ad app credential reset \
    --id "$app_id" \
    --display-name "fueld-production" \
    --end-date "$end_date" \
    --query '{keyId: keyId, secret: password}' \
    -o json)

  secret_key_id=$(echo "$secret_json" | jq -r '.keyId')
  secret_value=$(echo "$secret_json" | jq -r '.secret')

  echo "     ✓ App ID:     ${app_id}"
  echo "     ✓ Secret ID:  ${secret_key_id}"
  echo "     ✓ Expires:    ${end_date}"
  echo ""

  # Append to credentials file
  cat >> "$credentials_file" <<EOF
## ${tenant_name} (${domain})
AZURE_APP_ID_${env_var_prefix}=${app_id}
AZURE_CLIENT_SECRET_${env_var_prefix}=${secret_value}
AZURE_TENANT_ID_${env_var_prefix}=${TENANT_ID}
AZURE_REDIRECT_URI_${env_var_prefix}=${redirect_uri}

EOF

  created_count=$((created_count + 1))
done

echo "   ✓ Done — ${created_count} created, ${skipped_count} already existed (skipped)"
echo ""

# ── Step 3: Summary ────────────────────────────────────────────────────
echo "═══════════════════════════════════════════════════════════════════════"
echo "  ✅ Fueld Azure AD Organization Setup Complete"
echo "═══════════════════════════════════════════════════════════════════════"
echo ""
echo "  Organization: ${FUELD_ORG_NAME}"
echo "  Tenant ID:    ${TENANT_ID}"
echo "  Created:      ${created_count} new app(s)"
echo "  Skipped:      ${skipped_count} existing app(s)"
echo ""
if [ "$created_count" -gt 0 ]; then
  echo "  Credentials saved to: ${credentials_file}"
  echo ""
fi
echo "  ── Next steps ──"
echo ""
echo "  1. (Optional) Add a custom domain:"
echo "     https://portal.azure.com → Microsoft Entra ID → Custom domain names"
echo "     Add fueld.app and verify ownership via DNS"
echo ""
if [ "$created_count" -gt 0 ]; then
echo "  2. For each NEWLY created Fueld tenant, enter credentials in Admin → Integrations:"
else
echo "  2. No new apps were created — all tenants already exist."
echo "     If you need to update credentials, see the rotation section in the docs."
fi
for tenant_config in "${TENANTS[@]}"; do
  IFS=':' read -r tenant_name domain <<< "$tenant_config"
  echo "     • ${tenant_name}: https://${domain}"
done
echo ""
echo "  3. In each tenant's Admin → Security:"
echo "     - Set SSO Provider to 'Microsoft Entra ID (Azure AD)'"
echo "     - Enable SSO"
echo "     - (Optional) Configure approved email domains"
echo ""
echo "  4. Test: Log out and click 'Sign in with Microsoft'"
echo ""
echo "═══════════════════════════════════════════════════════════════════════"
