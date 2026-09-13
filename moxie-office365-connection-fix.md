# Moxie — Office 365 / Fueld Connection Fix Report

## Problem

When connecting the Office 365 account `daniel@moxiebrokerage.com` to fueld, the user sees a **"Need admin approval"** screen from Microsoft, with the "moxie" app shown as **"unverified"**.

## Root Cause

The "Fueld — moxie" app registration in Azure Entra ID had a **`servicePrincipalLockConfiguration`** enabled (`allProperties: true`, `isEnabled: true`). This feature locks the service principal in every tenant where the multi-tenant app is used — including `moxiebrokerage.com` (daniel's home tenant). The lock **prevents admin consent from being granted** in the user's tenant, so the "Need admin approval" prompt persists.

This configuration was **not present** on the working "Fueld — riviera-marine" and "Fueld — channeltx" apps, which is why those connections succeed.

### Side-by-side comparison (moxie vs channeltx — the closest match, both multi-tenant)

| Field | Channeltx (works) | Moxie (was broken) | Moxie (after fix) |
|-------|-------------------|--------------------|-------------------|
| servicePrincipalLockConfiguration | `null` | `{allProperties:true, isEnabled:true}` | `null` ✅ |
| signInAudience | AzureADMultipleOrgs | AzureADMultipleOrgs | AzureADMultipleOrgs |
| requiredResourceAccess | MS Graph: User.Read + email | MS Graph: User.Read + email | MS Graph: User.Read + email |
| implicitGrantSettings | false / false | false / false | false / false |
| redirectUri | channeltx.fueld.app/... | moxie.fueld.app/... | moxie.fueld.app/... |
| oauth2PermissionGrants | AllPrincipals: User.Read | AllPrincipals: User.Read | AllPrincipals: User.Read |
| verifiedPublisher | none (unverified) | none (unverified) | none (unverified) |

## Fix Applied

### Step 1 — Remove service principal lock (DONE)

Removed the `servicePrincipalLockConfiguration` from the "Fueld — moxie" app registration so it matches the working channeltx/riviera apps.

```bash
az rest --method PATCH \
  --url "https://graph.microsoft.com/v1.0/applications/4cbdba19-9702-4358-b9f6-bb78396991a5" \
  --body '{"servicePrincipalLockConfiguration": null}'
```

**Verified:** moxie's `servicePrincipalLockConfiguration` is now `null`, matching channeltx.

### Step 2 — Grant admin consent in the moxiebrokerage.com tenant (ACTION NEEDED)

Admin consent must be granted by an **admin of the moxiebrokerage.com tenant** (daniel's organization). This cannot be done from the fueld/adminfueld side because the app is multi-tenant and consent is per-tenant.

**Option A — Admin consent URL (recommended):**

Have a moxiebrokerage.com Global Admin visit this URL and sign in:

```
https://login.microsoftonline.com/common/adminconsent?client_id=c16e8906-d834-4ad5-889d-e8bd56827670&redirect_uri=https%3A%2F%2Fmoxie.fueld.app%2Fapi%2Fauth%2Fmicrosoft%2Fcallback
```

**Option B — From the fueld app:**

1. Have daniel retry connecting Office 365 to fueld
2. When the "Need admin approval" screen appears, click **"Have an admin account? Sign in with that account"**
3. Sign in with a moxiebrokerage.com admin account
4. Grant consent

With the service principal lock now removed, the admin consent will be properly written and all moxiebrokerage.com users will be able to connect without seeing the admin approval prompt.

## Verification

After step 2 is completed, have daniel retry connecting Office 365 to fueld. The connection should succeed without the "Need admin approval" message.