# Fueld Azure AD Organization Setup

This guide documents how to create a dedicated Microsoft Entra ID (Azure AD) organization for Fueld and register separate app registrations for each tenant (e.g., riviera-marine, channeltx).

## Architecture

```
┌─────────────────────────────────────────┐
│         Azure AD Tenant: Fueld          │
│         (fueld.onmicrosoft.com)         │
│                                         │
│  ┌─────────────┐    ┌─────────────┐    │
│  │  Fueld —    │    │  Fueld —    │    │
│  │ riviera-    │    │  channeltx  │    │
│  │  marine     │    │             │    │
│  │             │    │             │    │
│  │ • Client ID │    │ • Client ID │    │
│  │ • Secret    │    │ • Secret    │    │
│  │ • Redirect  │    │ • Redirect  │    │
│  │   URI       │    │   URI       │    │
│  └─────────────┘    └─────────────┘    │
│                                         │
│  Shared Tenant ID (GUID)                │
│  Each app has its own credentials       │
│  and redirect URI                       │
└─────────────────────────────────────────┘
```

**Why a dedicated organization?**

- **Isolation**: Each Fueld tenant gets its own app registration with independent credentials
- **Branding**: Users see "Fueld — channeltx" on the Microsoft consent screen
- **Audit trails**: Separate sign-in logs per app in Azure AD
- **Rate limits**: Separate Microsoft Graph API quotas per tenant
- **Rotation**: Revoking/rotating secrets for one tenant doesn't affect others

---

## Prerequisites

- [Azure CLI](https://docs.microsoft.com/en-us/cli/azure/install-azure-cli) installed (`az --version`)
- A Microsoft account with rights to create Azure AD tenants
- An Azure subscription (free tier is sufficient)

---

## Step 0: Create the Azure AD Tenant (One-Time)

> ⚠️ Azure AD tenants **cannot** be created via CLI. This step must be done in the Azure Portal.

1. Go to [https://portal.azure.com](https://portal.azure.com)
2. Navigate to: **Microsoft Entra ID** → **Manage tenants**
3. Click **+ Create** → **Microsoft Entra ID**
4. Fill in:
   - **Organization name**: `Fueld`
   - **Initial domain name**: `fueld` (becomes `fueld.onmicrosoft.com`)
   - **Country/Region**: your region
5. Click **Create** (takes ~1 minute)
6. Go to the new tenant's **Overview** page
7. Copy the **Tenant ID** (GUID format, e.g., `12345678-1234-1234-1234-123456789012`)

### Create a Global Admin user

1. In the new Fueld tenant, go to **Users** → **New user** → **Create new user**
2. Create yourself as a **Global Administrator**
3. Log out and log back in to the new tenant at [https://portal.azure.com](https://portal.azure.com)

---

## Step 1: Run the Setup Script

The script `deploy/setup-fueld-azure-organization.sh` creates app registrations for all configured tenants.

### Authenticate to the new tenant

```bash
az login --tenant <tenant-id-from-step-0> --allow-no-subscriptions
```

This opens a browser window. Sign in with the Global Admin account you created in the new tenant.

### Run the script

```bash
cd /path/to/fueld
./deploy/setup-fueld-azure-organization.sh <tenant-id-from-step-0>
```

Example:
```bash
./deploy/setup-fueld-azure-organization.sh 12345678-1234-1234-1234-123456789012
```

### What the script does

For each tenant configured in the script (`riviera-marine`, `channeltx`, etc.):

1. **Creates an app registration** with display name `Fueld — <tenant-name>`
2. **Configures the redirect URI** as `https://<domain>/api/auth/microsoft/callback`
3. **Adds Microsoft Graph API permissions**:
   - `User.Read` — for SSO login (openid + profile)
   - `Mail.Send` — for sending emails via Microsoft Graph
4. **Grants admin consent** for the permissions
5. **Creates a client secret** with 2-year expiry
6. **Saves all credentials** to `deploy/instances/fueld-azure-apps-credentials.txt`

### Script output

```
═══════════════════════════════════════════════════════════════════════
  ✅ Fueld Azure AD Organization Setup Complete
═══════════════════════════════════════════════════════════════════════

  Organization: fueld
  Tenant ID:    12345678-1234-1234-1234-123456789012

  Credentials saved to: deploy/instances/fueld-azure-apps-credentials.txt

  ── Next steps ──

  1. (Optional) Add a custom domain:
     https://portal.azure.com → Microsoft Entra ID → Custom domain names
     Add fueld.app and verify ownership via DNS

  2. For each Fueld tenant, enter credentials in Admin → Integrations:
     • riviera-marine: https://riviera-marine.fueld.app
     • channeltx: https://channeltx.fueld.app

  3. In each tenant's Admin → Security:
     - Set SSO Provider to 'Microsoft Entra ID (Azure AD)'
     - Enable SSO
     - (Optional) Configure approved email domains

  4. Test: Log out and click 'Sign in with Microsoft'
```

---

## Step 2: Configure Each Fueld Tenant

### Admin → Integrations → Microsoft 365 / Entra ID

For each tenant, enter the credentials from the script output:

| Field | Value |
|-------|-------|
| **Client ID** | From script output (e.g., `AZURE_APP_ID_channeltx`) |
| **Client Secret** | From script output (e.g., `AZURE_CLIENT_SECRET_channeltx`) |
| **Tenant ID** | The shared tenant ID from Step 0 |

### Admin → Security → SSO Provider

| Setting | Value |
|---------|-------|
| **SSO Provider** | `Microsoft Entra ID (Azure AD)` |
| **SSO Enabled** | Toggle ON |
| **Force Microsoft email match** | ON (recommended) — prevents users from connecting personal Outlook accounts |
| **Approved email domains** | Add your organization's domain(s), e.g., `channeltx.com` |

### Test the integration

1. Log out of the Fueld tenant
2. You should see a **"Sign in with Microsoft"** button on the login page
3. Click it, authenticate with your Microsoft work account
4. You should land back on the Fueld dashboard, logged in

---

## Adding a New Tenant

To add a new Fueld tenant (e.g., `moxie`):

### 1. Update the script

Edit `deploy/setup-fueld-azure-organization.sh` and add the new tenant to the `TENANTS` array:

```bash
TENANTS=(
  "riviera-marine:riviera-marine.fueld.app"
  "channeltx:channeltx.fueld.app"
  "moxie:moxie.fueld.app"          # ← add this line
)
```

### 2. Re-run the script

```bash
az login --tenant <tenant-id> --allow-no-subscriptions
./deploy/setup-fueld-azure-organization.sh <tenant-id>
```

The script is idempotent — it will create the new app without affecting existing ones.

### 3. Configure the new tenant in Fueld

Follow Step 2 above for the new tenant.

---

## Troubleshooting

### "It looks like the application has been removed or is configured to use an incorrect application identifier"

This error occurs when the Azure tenant does not have the Microsoft Graph service principal pre-provisioned (common in new/free tenants). The `az ad app permission add` command uses an older API that fails in this case.

**Fix**: Use the Azure Portal to create the app registration manually:

1. Go to [https://portal.azure.com](https://portal.azure.com) → **Microsoft Entra ID** → **App registrations** → **+ New registration**
2. **Name**: `Fueld — <tenant-name>`
3. **Supported account types**: `Accounts in this organizational directory only`
4. **Redirect URI**: `Web` → `https://<domain>/api/auth/microsoft/callback`
5. Click **Register**
6. Go to **API permissions** → **+ Add a permission** → **Microsoft Graph** → **Delegated permissions**
7. Add: `openid`, `profile`, `User.Read`, `Mail.Send`
8. Click **Grant admin consent for [tenant]**
9. Go to **Certificates & secrets** → **+ New client secret** → 24 months
10. Copy the secret value immediately

### Mail.Send not visible in Azure Portal API permissions list

The Azure Portal UI sometimes fails to render `Mail.Send` in the permissions list even when it is correctly configured via API.

**Verify via CLI**:
```bash
az ad app show --id <app-id> --query 'requiredResourceAccess' -o json
```

You should see both permission GUIDs:
- `e1fe6dd8-ba31-4d61-89e7-88639da4683d` → User.Read
- `e383f46e-2787-4529-8551-86ec2b8b75c4` → Mail.Send

If both GUIDs are present, the permission is configured correctly and the portal UI is just not rendering it. You can proceed safely.

### "AADSTS700082: The refresh token has expired"

Your Azure CLI session has expired. Re-authenticate:

```bash
az login --tenant <tenant-id> --allow-no-subscriptions
```

### "Insufficient privileges to complete the operation"

You need **Application Administrator** or **Global Administrator** role in the target Azure AD tenant. Ask your IT admin to grant you this role or run the script for you.

### "Admin consent is required"

After creating the app, you must grant admin consent for the Microsoft Graph permissions:

```bash
az ad app permission admin-consent --id <app-id>
```

Or in the portal: **App registrations** → **API permissions** → **Grant admin consent for [tenant]**.

### "Invalid client secret" or "AADSTS7000215"

The client secret may have expired or been deleted. Rotate it (see Rotating Secrets above).

### "The reply URL does not match"

The redirect URI in the Azure app must exactly match what Fueld generates. Verify:

```bash
az ad app show --id <app-id> --query "web.redirectUris"
```

It should return:
```json
[
  "https://channeltx.fueld.app/api/auth/microsoft/callback"
]
```

If it doesn't match, update it:

```bash
az ad app update --id <app-id> --web-redirect-uris "https://channeltx.fueld.app/api/auth/microsoft/callback"
```

### Users can't sign in — "User account does not exist"

The app is configured for **single-tenant** (`AzureADMyOrg`). Only users in the same Azure AD tenant can sign in. If you need to allow external users (e.g., customers with their own Microsoft 365), change the sign-in audience:

```bash
az ad app update --id <app-id> --sign-in-audience AzureADMultipleOrgs
```

> ⚠️ This allows any Microsoft work account to sign in. Use approved email domains in Fueld Admin → Security to restrict access.

---

## Credentials File

The script saves all credentials to:

```
deploy/instances/fueld-azure-apps-credentials.txt
```

Example contents:

```
# Fueld Azure AD App Registrations
# Organization: fueld
# Tenant ID: 12345678-1234-1234-1234-123456789012
# Generated: 2026-06-09T14:30:00Z
#
# ⚠️  KEEP THIS FILE SECURE — contains client secrets
#     Do NOT commit to git.

## riviera-marine (riviera-marine.fueld.app)
AZURE_APP_ID_riviera_marine=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa
AZURE_CLIENT_SECRET_riviera_marine=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
AZURE_TENANT_ID_riviera_marine=12345678-1234-1234-1234-123456789012
AZURE_REDIRECT_URI_riviera_marine=https://riviera-marine.fueld.app/api/auth/microsoft/callback

## channeltx (channeltx.fueld.app)
AZURE_APP_ID_channeltx=bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb
AZURE_CLIENT_SECRET_channeltx=yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy
AZURE_TENANT_ID_channeltx=12345678-1234-1234-1234-123456789012
AZURE_REDIRECT_URI_channeltx=https://channeltx.fueld.app/api/auth/microsoft/callback
```

> 🔒 **Security**: This file is gitignored by convention. Do not commit it to the repository. Store it in a password manager or secure vault.

---

## Rotating Secrets

If a client secret is compromised or expires:

### Option A: Rotate via Azure CLI

```bash
az login --tenant <tenant-id>

# List existing secrets
az ad app credential list --id <app-id>

# Create new secret
az ad app credential reset \
  --id <app-id> \
  --display-name "fueld-production-rotated" \
  --end-date "2028-06-09"

# Delete old secret (optional, after confirming new one works)
az ad app credential delete \
  --id <app-id> \
  --key-id <old-key-id>
```

### Option B: Rotate via Azure Portal

1. Go to [https://portal.azure.com](https://portal.azure.com)
2. Navigate to: **Microsoft Entra ID** → **App registrations** → find your app
3. Go to **Certificates & secrets** → **Client secrets** → **New client secret**
4. Copy the new secret value
5. Update it in Fueld Admin → Integrations
6. (Optional) Delete the old secret

---

## Troubleshooting

### "AADSTS700082: The refresh token has expired"

Your Azure CLI session has expired. Re-authenticate:

```bash
az login --tenant <tenant-id> --allow-no-subscriptions
```

### "Insufficient privileges to complete the operation"

You need **Application Administrator** or **Global Administrator** role in the target Azure AD tenant. Ask your IT admin to grant you this role or run the script for you.

### "Admin consent is required"

After creating the app, you must grant admin consent for the Microsoft Graph permissions:

```bash
az ad app permission admin-consent --id <app-id>
```

Or in the portal: **App registrations** → **API permissions** → **Grant admin consent for [tenant]**.

### "Invalid client secret" or "AADSTS7000215"

The client secret may have expired or been deleted. Rotate it (see Rotating Secrets above).

### "The reply URL does not match"

The redirect URI in the Azure app must exactly match what Fueld generates. Verify:

```bash
az ad app show --id <app-id> --query "web.redirectUris"
```

It should return:
```json
[
  "https://channeltx.fueld.app/api/auth/microsoft/callback"
]
```

If it doesn't match, update it:

```bash
az ad app update --id <app-id> --web-redirect-uris "https://channeltx.fueld.app/api/auth/microsoft/callback"
```

### Users can't sign in — "User account does not exist"

The app is configured for **single-tenant** (`AzureADMyOrg`). Only users in the same Azure AD tenant can sign in. If you need to allow external users (e.g., customers with their own Microsoft 365), change the sign-in audience:

```bash
az ad app update --id <app-id> --sign-in-audience AzureADMultipleOrgs
```

> ⚠️ This allows any Microsoft work account to sign in. Use approved email domains in Fueld Admin → Security to restrict access.

---

## Security Best Practices

1. **Use a dedicated Azure AD tenant** — Don't mix Fueld apps with your production corporate tenant
2. **Rotate secrets annually** — Even though they have 2-year expiry, rotate proactively
3. **Store credentials securely** — Use a password manager, not the credentials file
4. **Enable force email match** — Prevents users from linking personal Microsoft accounts
5. **Configure approved email domains** — Restricts which Microsoft accounts can connect
6. **Monitor sign-in logs** — Azure AD → Monitoring → Sign-ins
7. **Review app registrations quarterly** — Remove unused apps and secrets

---

## Related Files

| File | Purpose |
|------|---------|
| `deploy/setup-fueld-azure-organization.sh` | Creates app registrations for all tenants |
| `deploy/setup-channeltx-azure-app.sh` | Legacy single-tenant script (deprecated) |
| `deploy/instances/fueld-azure-apps-credentials.txt` | Generated credentials (gitignored) |
| `apps/api/src/modules/auth/microsoft-oauth.service.ts` | Backend OAuth implementation |
| `apps/api/src/modules/admin/integrations.service.ts` | Credential storage (encrypted) |
| `apps/web/src/app/features/admin/pages/integrations/` | Admin UI for entering credentials |
| `apps/web/src/app/features/admin/pages/security/` | Admin UI for SSO settings |

---

## References

- [Microsoft Entra ID documentation](https://learn.microsoft.com/en-us/entra/identity/)
- [Azure CLI app registration commands](https://learn.microsoft.com/en-us/cli/azure/ad/app)
- [Microsoft Graph permissions reference](https://learn.microsoft.com/en-us/graph/permissions-reference)
- [OAuth 2.0 authorization code flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow)
