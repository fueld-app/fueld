## Code Review: Sendt Bunker Booking Indicator Column

### P0
None

### P1
None

### P2

1. **Endpoint placement under `/admin/settings` but not admin-gated** — The new `GET /my-booking-column` endpoint is placed under the `/admin/settings` prefix but does not call `requireAdmin(auth)` (unlike the `PUT /custom-columns` endpoint right below it). While the endpoint only returns a boolean from tenant settings (low sensitivity), the route naming is misleading and inconsistent with the rest of the controller. Consider either:
   - Moving it to a non-admin settings controller (e.g., `/settings/my-booking-column`), or
   - Adding a comment explaining why it's intentionally non-admin.

2. **Race condition on initial load** — `bookingColumnEnabled` is loaded asynchronously in `loadCustomColumns()` (or similar init). The `visibleColumns` computed and `defaultVisibleColumns` both depend on this signal. If a user with saved prefs containing `booking` opens the page before the flag resolves, the cleanup logic in `visibleColumns` will strip `booking` and persist the cleanup — even if the tenant actually has the flag enabled. This could permanently remove the column for Moxie users with slow network. Consider:
   - Blocking the column computation until the flag is loaded (e.g., a `bookingColumnLoaded` signal), or
   - Only running the cleanup after the flag has been successfully fetched.

3. **Error handling silently defaults to hidden** — The `catch` block on the `my-booking-column` fetch defaults to `enabled = false`. If the API call fails transiently (network blip, 500), the column will be hidden for that session. For Moxie (the only tenant with it enabled), this is a UX regression. Consider retrying or falling back to a cached value.

4. **No migration for existing prefs cleanup** — The cleanup logic in `visibleColumns` only runs when the user visits the order list page. If a non-Moxie tenant had `booking` injected into their prefs, the stale pref persists until they happen to open that page. This is acceptable but worth noting — a one-time migration script could clean all affected prefs proactively.

5. **Type safety on tenant settings** — The new field is accessed via `(tenant?.settings as any)?.bookingEmail?.bookingColumnEnabled`. The `TenantSettings` interface was updated, but the cast to `any` bypasses type checking. Consider using a typed accessor or optional chaining with proper types.

### Verdict

**Approve with minor changes.** The change correctly addresses the original issue (feature was pushed to all tenants) and implements proper tenant gating. The P2 items are non-blocking but should be addressed in a follow-up, particularly the race condition (#2) which could cause data loss for the intended tenant (Moxie).

---

## Executor disposition (2026-09-03)

- **P2-2 (race: cleanup before flag loads)**: VALID — fixed. Added bookingColumnLoaded signal; prefs cleanup only runs after a successful flag fetch AND only when the tenant has the feature disabled. Failed fetch → prefs untouched.
- **P2-1 (endpoint under /admin but not admin-gated)**: intentional — mirrors /my-custom-columns (needed by non-admin users to render the list); naming consistent with that sibling endpoint.
- **P2-3 (silent hidden on fetch failure)**: addressed — cleanup skipped on failure; Moxie users with the column already in saved prefs keep it.
- **P2-4 (stale prefs cleanup migration)**: accepted — cleanup runs on first visit to the order list, which is the only place the column existed.
- **P2-5 (any-cast)**: consistent with existing settings code style.
