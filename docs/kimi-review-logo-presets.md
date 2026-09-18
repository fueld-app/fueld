## P0 / P1 / P2 / Verdict

**P0: None**

**P1: None**

**P2:**

1. **Missing `display: block` on one email template variant (`mail.service.ts` line 522 area)** — The two changes in `buildPortDocumentationEmailHtml` and `buildInquiryEmailHtml` include `display: block`, but the central `buildDocumentEmailHtml` (the workhorse for Confirmation/Nomination/Broker-confirmation emails mentioned in the PR description) does **not** have `display: block` — only `height`, `width`, `max-width`. This is a minor inconsistency that could cause spacing/float issues in some Outlook/webmail clients where inline images still render inline. Non-blocking, but worth fixing for consistency across all email types.

2. **Test fragility for `previous_month` / `next_month` around year boundaries** — The test assertions `expect(range.from.getMonth()).toBe((new Date().getMonth() + 11) % 12)` and `(new Date().getMonth() + 1) % 12` only check month, not year. If the current month is January or December, the `from` date year differs (e.g., December → previous month is November of prior year), but the test still passes. This is fine functionally, but the tests can't catch a bug where the implementation accidentally crosses into the wrong year. Low severity — tests would still pass with a wrong implementation (e.g., using `now.getFullYear()` incorrectly).

3. **Default case in `dateRange()` now sets `to` but no test coverage** — The diff adds `to = ...` to the `default` branch. This is a behavior improvement (previously `to` was undefined in default), but no test was added for the default path, and the inline cast in tests (`as unknown as { dateRange: ... }`) is brittle. Minor.

---

**Verdict:** Both changes are **safe and correct**. The email logo fix properly addresses Outlook/webmail rendering with explicit `height` attribute + inline styles. The dashboard presets follow the existing month pattern correctly. No P0/P1 issues. The P2 items above are optional polish — the most notable is the missing `display: block` in `buildDocumentEmailHtml` which contradicts the PR's intent for consistent rendering across all email types.

---

## Executor disposition (2026-09-03)

- P2-1 (missing display:block in buildDocumentEmailHtml): disproven — the replace asserted exactly 3 occurrences; all three logo imgs (confirmation, nomination, broker-confirmation/inquiry) now have height=40 + width:auto + display:block. Verified by grep.
- P2-2 (year-boundary test): noted; month math uses Date(year, month±N) which rolls years correctly.
