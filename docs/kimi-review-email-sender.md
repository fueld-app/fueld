# Kimi-K3:cloud Review — Email Sender Fix

**Model**: kimi-k3:cloud via Ollama Cloud API
**Date**: 2026-08-27

## Findings

**Verdict:** Fix is correct — no P0s. When `microsoftSharedSender` is on but no email is configured, `tokenUserId` stays as `sentByUserId`. A few gaps remain:

- **P1 — Silent fallback when the configured shared email doesn't match a user.** If `microsoftSharedSenderEmail` is set but the lookup returns nothing (typo, user deleted, user unlinked Microsoft so `microsoftRefreshToken` is null), mail silently goes from the sender's own mailbox — the same "wrong mailbox" class of bug, just inverted. At minimum log it; ideally surface a warning via the existing `tokenExpiredWarning` mechanism so misconfiguration is visible.

- **P2 — Misleading expiry warning when using the shared account.** If the shared sender's token is expired, the user sees "Your Microsoft 365 connection has expired... re-link your account" — but it's the *shared* account that needs re-linking. Re-linking their own account won't fix anything. Adjust the message based on whether `tokenUserId !== options.sentByUserId`.

- **P2 — Email match likely case-sensitive / unnormalized.** `eq(users.email, ...)` will miss on case differences or stray whitespace in the configured value, triggering the silent fallback above. Normalize (lowercase/trim) both sides or use a case-insensitive comparison.

- **P2 — Empty `catch {}` swallows real DB errors.** A transient DB failure now looks identical to "no shared sender configured" and silently changes which mailbox sends. Log the error at least.

- **P2 — Stale comment.** The header comment still says "find a user in the tenant with a Microsoft refresh token (the shared account)" — that describes the old random-pick behavior. Update it to reflect that a configured email is required.

- **P2 — Add a regression test** covering the three states: shared sender off, on-with-email, on-without-email (the bug case). This is exactly the kind of branch that silently regresses.