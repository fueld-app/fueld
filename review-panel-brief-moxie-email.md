# Review request: Moxie email-send failure diagnosis + 2 small fixes

## Context
Production instance "moxie" (moxie.fueld.app, VPS 31.70.94.96) reported a failed email send on order 20260828-000097 at ~17:17 UTC on 2026-09-04. User saw toast: "Failed to send email. Check SMTP settings in Admin → Settings → Integrations, or re-link your Microsoft 365 account if it has expired."

## Evidence gathered (from prod VPS + DB + code)
- The toast comes from `apps/web/src/app/features/trading/pages/order-detail/services/order-communication.service.ts` `onSendEmail()` error callback — it is generic and shown on ANY HTTP error; the server's actual error message was discarded.
- M365/Graph sending is healthy: successful sends via channel GRAPH same day at 15:09 UTC (Bunker Booking from frederik@ to marlowfleet.com) and 6+ more over the past week. Sender has a valid `microsoft_refresh_token`.
- NO `FAILED` row in `email_log` for the order, and NO console output in journalctl at 17:17 UTC. `sendDocumentEmail()` writes a FAILED log row before re-throwing, so the request never reached the mail code.
- API deploy was at 13:21 UTC (well before), service stayed up (WS auth 17:15, disconnect 17:18).
- At 18:06 UTC the user manually flipped the "Sendt Bunker Booking" indicator (manual toggle for emails sent outside Fueld) — suggesting he sent it manually afterwards.
- Conclusion: most likely an Elysia body-validation 422 (schema requires `format: 'email'` for every To/CC/BCC address; validation fails BEFORE the handler, hence no logs), or one of the early 400 gates in `documents.controller.ts` (e.g. "Select an invoicing company first"). In all cases the frontend hid the real message.

## Changes made (the diff under review)

### Fix 1 — apps/web .../order-communication.service.ts
Surface the server's real error message in the toast; fall back to the generic SMTP/M365 text only when the server gave nothing:

```ts
error: (err: HttpErrorResponse) => {
  emailModal?.done();
  // Prefer the server's specific message (e.g. "Select a bank account first",
  // "Additional attachments are only supported for invoice emails", or a
  // 422 body-validation error). Only fall back to the generic SMTP/M365 hint
  // when the server gave us nothing (network failure / gateway error).
  const serverMessage: string | undefined =
    err?.error?.message ??
    (typeof err?.error === 'string' ? err.error : undefined);
  showToast(
    'error',
    serverMessage ??
      'Failed to send email. Check SMTP settings in Admin → Settings → Integrations, or re-link your Microsoft 365 account if it has expired.',
  );
},
```
(Import updated to add `type HttpErrorResponse`.)

### Fix 2 — apps/api/src/index.ts (createApp)
Global onError to log every 4xx/5xx so validation failures leave a trace:

```ts
const app = new Elysia()
  .onError({ as: 'global' }, ({ request, code, error, set }) => {
    // Log 4xx/5xx so client-visible failures leave a server-side trace.
    // Validation (422) failures otherwise happen before the handler runs and
    // are completely invisible in journalctl.
    const status = typeof set.status === 'number' ? set.status : 500;
    if (status >= 400) {
      console.error(
        `[HTTP ${status}] ${request.method} ${new URL(request.url).pathname} code=${code}`,
        error instanceof Error ? error.message : error,
      );
    }
  })
  .use(...)
```

Both compile: `tsc --noEmit` error count identical before/after (32 pre-existing errors, none new).

## Questions for the panel
1. Do you agree with the diagnosis (422 body-validation / early-400 gate most likely; SMTP/M365 ruled out)? Any alternative explanation consistent with "no email_log row + no console output"?
2. Any issues with the two fixes? (correctness, security — e.g. leaking server error text to end users, log noise/PII, Elysia onError semantics — does `set.status` reflect the final status at that point? Should we derive status differently?)
3. Should the 422/validation messages be user-friendly (raw Elysia validation JSON can be ugly/technical)? Is showing raw `err.error.message` acceptable?
4. Anything else you'd check on the prod VPS to confirm the root cause?

Relevant files you may read:
- apps/web/src/app/features/trading/pages/order-detail/services/order-communication.service.ts
- apps/api/src/modules/documents/documents.controller.ts (send-email handler ~line 545-760)
- apps/api/src/modules/documents/mail.service.ts (sendDocumentEmail ~line 214)
- apps/api/src/index.ts (createApp ~line 375+)
- moxie-office365-connection-fix.md (earlier related incident)